import { scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 32;

/**
 * Stateless user session token: `u1.<userB64>.<expiryEpochSec>.<sigB64url>`.
 * Same HMAC construction as room tickets but domain-separated by the `u1`
 * version prefix, so room and user tokens are never interchangeable. Signed
 * with the room ticket secret to avoid a second secret to configure.
 */
export function issueUserToken(
  secret: string,
  userId: string,
  ttlSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): { token: string; expiresIn: number } {
  const expiry = nowSec + ttlSec;
  const payload = `${Buffer.from(userId, 'utf8').toString('base64url')}.${expiry}`;
  const sig = sign(secret, payload).toString('base64url');
  return { token: `u1.${payload}.${sig}`, expiresIn: ttlSec };
}

/** Returns the user id when the token is authentic and unexpired. */
export function verifyUserToken(
  secret: string,
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  // Room tickets require exactly 5 dot-parts; user tokens require exactly
  // 4 here so trailing garbage (`u1.a.b.c.evil`) can never validate.
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, userB64, expiryRaw, sigB64] = parts;
  if (version !== 'u1' || !userB64 || !expiryRaw || !sigB64) return null;
  let userId: string;
  try {
    userId = Buffer.from(userB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!userId) return null;
  const expiry = Number(expiryRaw);
  if (!Number.isInteger(expiry) || expiry <= nowSec) return null;
  const expected = sign(secret, `${userB64}.${expiryRaw}`);
  const actual = Buffer.from(sigB64, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  return userId;
}

function sign(secret: string, payload: string): Buffer {
  return scryptSync(secret, payload, SCRYPT_KEYLEN);
}

const RESET_TTL_SEC = 3600;

/**
 * Stateless password-reset token: `pw1.<emailB64>.<expiryEpochSec>.<sigB64url>`.
 * Domain-separated (`pw1`) so session and reset tokens never validate as
 * each other. The server never stores reset state; expiry + signature are
 * the entire check — but always verify the user still exists before
 * applying the new hash.
 */
export function issuePasswordResetToken(
  secret: string,
  email: string,
  nowSec = Math.floor(Date.now() / 1000),
): { token: string; expiresIn: number } {
  const expiry = nowSec + RESET_TTL_SEC;
  const emailB64 = Buffer.from(email.trim().toLowerCase(), 'utf8').toString(
    'base64url',
  );
  const payload = `${emailB64}.${expiry}`;
  const sig = sign(secret, `pw1.${payload}`).toString('base64url');
  return { token: `pw1.${payload}.${sig}`, expiresIn: RESET_TTL_SEC };
}

/** Returns the normalized email when the reset token is valid. */
export function verifyPasswordResetToken(
  secret: string,
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, emailB64, expiryRaw, sigB64] = parts;
  if (version !== 'pw1' || !emailB64 || !expiryRaw || !sigB64) return null;
  let email: string;
  try {
    email = Buffer.from(emailB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email?.includes('@')) return null;
  const expiry = Number(expiryRaw);
  if (!Number.isInteger(expiry) || expiry <= nowSec) return null;
  const expected = sign(secret, `pw1.${emailB64}.${expiryRaw}`);
  let actual: Buffer;
  try {
    actual = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  return email.trim().toLowerCase();
}
