import {
  createHash,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import type { Config } from "./config.js";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
};

export function oidcConfig(config: Config): OidcConfig | undefined {
  if (
    !config.oidcIssuer ||
    !config.oidcClientId ||
    !config.oidcClientSecret ||
    !config.oidcRedirectUrl
  )
    return undefined;
  return {
    issuer: config.oidcIssuer.replace(/\/+$/, ""),
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
    redirectUrl: config.oidcRedirectUrl,
  };
}

export type OidcIdentity = {
  subject: string;
  email: string;
  name?: string | null;
};

type JwksKey = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
};

type CachedJwks = {
  keys: JwksKey[];
  fetchedAt: number;
};

const jwksCache = new Map<string, CachedJwks>();
const JWKS_TTL_MS = 5 * 60_000;

/** PKCE S256 challenge for the authorize redirect. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function newCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export async function discoveryDocument(issuer: string): Promise<{
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}> {
  const response = await fetch(
    `${issuer}/.well-known/openid-configuration`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok)
    throw new Error(`OIDC discovery failed (${response.status})`);
  const document = (await response.json()) as {
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
    jwks_uri?: unknown;
    issuer?: unknown;
  };
  if (
    typeof document.authorization_endpoint !== "string" ||
    typeof document.token_endpoint !== "string" ||
    typeof document.jwks_uri !== "string" ||
    typeof document.issuer !== "string"
  )
    throw new Error("OIDC discovery document is malformed");
  return document as {
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
    issuer: string;
  };
}

function jwkToKeyObject(key: JwksKey): KeyObject {
  // Node imports RSA JWKs natively — no hand-rolled DER, no new deps.
  if (key.kty !== "RSA" || !key.n || !key.e)
    throw new Error("Unsupported JWK key type");
  return createPublicKey({
    key: { kty: "RSA", n: key.n, e: key.e },
    format: "jwk",
  });
}

async function signingKey(
  jwksUri: string,
  kid: string | undefined,
): Promise<KeyObject> {
  const cached = jwksCache.get(jwksUri);
  let keys = cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS
    ? cached.keys
    : null;
  if (!keys) {
    const response = await fetch(jwksUri, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`JWKS fetch failed (${response.status})`);
    const document = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(document.keys))
      throw new Error("JWKS document is malformed");
    keys = document.keys as JwksKey[];
    jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
  }
  const match = kid
    ? keys.find((key) => key.kid === kid)
    : keys[0];
  if (!match) {
    // Key rotation: drop the cache once and retry before giving up.
    jwksCache.delete(jwksUri);
    throw new Error("Signing key not found (cache cleared, retry)");
  }
  return jwkToKeyObject(match);
}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

/**
 * Verifies a Google-style RS256 ID token: signature, issuer, audience,
 * expiry. Throws on any mismatch.
 */
export async function verifyIdToken(
  oidc: OidcConfig,
  discovery: { jwks_uri: string; issuer: string },
  idToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<OidcIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(
    base64UrlDecode(headerB64).toString("utf8"),
  ) as { alg?: unknown; kid?: unknown };
  if (header.alg !== "RS256") throw new Error("Unexpected ID token alg");
  const keyObject = await signingKey(
    discovery.jwks_uri,
    typeof header.kid === "string" ? header.kid : undefined,
  );
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(sigB64);
  if (!verifier.verify(keyObject, signature))
    throw new Error("Invalid ID token signature");
  const payload = JSON.parse(
    base64UrlDecode(payloadB64).toString("utf8"),
  ) as {
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };
  if (payload.iss !== discovery.issuer && payload.iss !== oidc.issuer)
    throw new Error("ID token issuer mismatch");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(oidc.clientId))
    throw new Error("ID token audience mismatch");
  if (typeof payload.exp !== "number" || payload.exp + 30 <= nowSec)
    throw new Error("ID token expired");
  if (typeof payload.sub !== "string" || !payload.sub)
    throw new Error("ID token has no subject");
  if (typeof payload.email !== "string" || !payload.email)
    throw new Error("ID token has no email");
  // Unverified emails must not link password accounts (account-takeover
  // vector); providers like Google always set this for verified mails.
  if (payload.email_verified === false)
    throw new Error("ID token email is not verified");
  return {
    subject: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

export async function exchangeCode(
  oidc: OidcConfig,
  discovery: { token_endpoint: string },
  code: string,
  codeVerifier: string,
): Promise<{ idToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: oidc.redirectUrl,
    client_id: oidc.clientId,
    client_secret: oidc.clientSecret,
    code_verifier: codeVerifier,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Token exchange failed (${response.status})`);
  const data = (await response.json()) as { id_token?: unknown };
  if (typeof data.id_token !== "string" || !data.id_token)
    throw new Error("Token endpoint returned no ID token");
  return { idToken: data.id_token };
}

/** Signed, stateless OAuth state: binds next + PKCE verifier + expiry. */
export function sealState(
  secret: string,
  state: { nonce: string; next: string; verifier: string; exp: number },
): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString(
    "base64url",
  );
  const sig = hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export function openState(
  secret: string,
  sealed: string,
  nowSec = Math.floor(Date.now() / 1000),
): { nonce: string; next: string; verifier: string } | null {
  const [payload, sig] = sealed.split(".");
  if (!payload || !sig) return null;
  const expected = hmacSign(secret, payload);
  const actual = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (
    actual.length !== expectedBuf.length ||
    !timingSafeEqual(actual, expectedBuf)
  )
    return null;
  try {
    const state = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { nonce?: unknown; next?: unknown; verifier?: unknown; exp?: unknown };
    if (
      typeof state.nonce !== "string" ||
      typeof state.next !== "string" ||
      typeof state.verifier !== "string" ||
      typeof state.exp !== "number" ||
      state.exp <= nowSec
    )
      return null;
    return { nonce: state.nonce, next: state.next, verifier: state.verifier };
  } catch {
    return null;
  }
}

function hmacSign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
