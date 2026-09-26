import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  newCodeVerifier,
  openState,
  pkceChallenge,
  sealState,
  verifyIdToken,
} from "../src/sso.js";
import { MemoryUserStore } from "../src/users.js";

const SECRET = "test-ticket-secret-32-chars-long!!";

describe("OAuth state envelope", () => {
  test("round-trips sealed state", () => {
    const sealed = sealState(SECRET, {
      nonce: "n1",
      next: "/board?room=x",
      verifier: "v1",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    expect(openState(SECRET, sealed)).toMatchObject({
      nonce: "n1",
      next: "/board?room=x",
      verifier: "v1",
    });
  });

  test("rejects tampered and expired states", () => {
    const sealed = sealState(SECRET, {
      nonce: "n1",
      next: "/board",
      verifier: "v1",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    expect(openState(SECRET, `${sealed}tampered`)).toBeNull();
    expect(openState("wrong-secret-32-chars-long-!!!!!!", sealed)).toBeNull();
    const stale = sealState(SECRET, {
      nonce: "n1",
      next: "/board",
      verifier: "v1",
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    expect(openState(SECRET, stale)).toBeNull();
  });

  test("PKCE challenge is a URL-safe SHA-256", () => {
    // Pinned against an independent SHA-256 implementation.
    expect(pkceChallenge("Eunoia-test-verifier-0123456789abcdef")).toBe(
      "dehvSSm75EVHg2ml8lyb5ftuY4ea4vV7d7o2gUC7EDA",
    );
    expect(pkceChallenge("a")).not.toBe(pkceChallenge("b"));
    expect(newCodeVerifier()).toHaveLength(43);
  });
});

describe("ID token verification", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as {
    kty: string;
    n: string;
    e: string;
  };
  const JWKS_URI = "https://issuer.test/.well-known/jwks.json";
  const OIDC = {
    issuer: "https://issuer.test",
    clientId: "client_test",
    clientSecret: "secret",
    redirectUrl: "http://localhost:3001/api/auth/sso/callback",
  };
  const DISCOVERY = { jwks_uri: JWKS_URI, issuer: OIDC.issuer };

  let originalFetch: typeof fetch;
  const jwksPayload = { keys: [{ ...jwk, kid: "k1", use: "sig" }] };

  function signJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }),
      "utf8",
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${body}`);
    return `${header}.${body}.${signer.sign(privateKey, "base64url")}`;
  }

  function validClaims(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: OIDC.issuer,
      aud: OIDC.clientId,
      exp: now + 3600,
      iat: now,
      sub: "google-sub-1",
      email: "sso@example.com",
      email_verified: true,
      name: "SSO User",
      ...overrides,
    };
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(jwksPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("accepts a valid Google-style token", async () => {
    const identity = await verifyIdToken(OIDC, DISCOVERY, signJwt(validClaims()));
    expect(identity).toMatchObject({
      subject: "google-sub-1",
      email: "sso@example.com",
      name: "SSO User",
    });
  });

  test("rejects wrong audience, expiry, and unverified email", async () => {
    await expect(
      verifyIdToken(OIDC, DISCOVERY, signJwt(validClaims({ aud: "other" }))),
    ).rejects.toThrow();
    await expect(
      verifyIdToken(
        OIDC,
        DISCOVERY,
        signJwt(validClaims({ exp: Math.floor(Date.now() / 1000) - 100 })),
      ),
    ).rejects.toThrow();
    await expect(
      verifyIdToken(
        OIDC,
        DISCOVERY,
        signJwt(validClaims({ email_verified: false })),
      ),
    ).rejects.toThrow();
  });

  test("rejects tampered payloads", async () => {
    const token = signJwt(validClaims());
    const [header, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify(validClaims({ sub: "attacker", email: "a@b.c" })),
      "utf8",
    ).toString("base64url");
    await expect(
      verifyIdToken(OIDC, DISCOVERY, `${header}.${forged}.${sig}`),
    ).rejects.toThrow();
  });
});

describe("OAuth user linking", () => {
  test("links same-email accounts and reuses subjects", async () => {
    const store = new MemoryUserStore();
    const passwordUser = await store.createUser({
      email: "link@example.com",
      passwordHash: "hash",
    });
    const linked = await store.findOrCreateOAuthUser({
      provider: "https://issuer.test",
      subject: "sub-9",
      email: "link@example.com",
      name: "Linked",
    });
    expect(linked.id).toBe(passwordUser!.id);
    const again = await store.findOrCreateOAuthUser({
      provider: "https://issuer.test",
      subject: "sub-9",
      email: "changed@example.com",
      name: null,
    });
    expect(again.id).toBe(passwordUser!.id);
  });

  test("creates fresh users for unknown subjects", async () => {
    const store = new MemoryUserStore();
    const created = await store.findOrCreateOAuthUser({
      provider: "https://issuer.test",
      subject: "sub-new",
      email: "newbie@example.com",
      name: "Newbie",
    });
    expect(created.email).toBe("newbie@example.com");
    expect(created.tier).toBe("COMMUNITY");
  });
});
