import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { RoomMetadata } from "./RoomLoader.js";

const SCRYPT_KEYLEN = 32;
const MIN_PASSWORD_LENGTH = 8;

export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}

/** scrypt hash in `scrypt$<saltHex>$<hashHex>` format. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

function b64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function b64urlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function sign(secret: string, payload: string): Buffer {
  return scryptSync(secret, payload, SCRYPT_KEYLEN);
}

/**
 * Stateless room ticket: `v1.<roomB64>.<expiryEpochSec>.<passVer>.<sigB64url>`.
 * Verified without storage; room binding prevents cross-room reuse and the
 * password version binds the ticket to the current password — rotation or
 * removal invalidates previously minted tickets. Exactly 5 dot-separated
 * parts are accepted; anything else is rejected.
 */
export function issueTicket(
  secret: string,
  roomId: string,
  passwordVersion: number,
  ttlSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): { ticket: string; expiresIn: number } {
  const expiry = nowSec + ttlSec;
  const payload = `${b64urlEncode(roomId)}.${expiry}.${passwordVersion}`;
  const sig = sign(secret, payload).toString("base64url");
  return { ticket: `v1.${payload}.${sig}`, expiresIn: ttlSec };
}

/**
 * Returns the ticket's password version when authentic, unexpired, and
 * room-bound. Callers compare it against the room's current version.
 */
export function verifyTicket(
  secret: string,
  ticket: string,
  roomId: string,
  nowSec = Math.floor(Date.now() / 1000),
): number | null {
  const parts = ticket.split(".");
  if (parts.length !== 5) return null;
  const [version, roomB64, expiryRaw, verRaw, sigB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== "v1" || !roomB64 || !expiryRaw || !verRaw || !sigB64)
    return null;
  if (b64urlDecode(roomB64) !== roomId) return null;
  const expiry = Number(expiryRaw);
  if (!Number.isInteger(expiry) || expiry <= nowSec) return null;
  const passVer = Number(verRaw);
  if (!Number.isInteger(passVer) || passVer < 0) return null;
  const expected = sign(secret, `${roomB64}.${expiryRaw}.${verRaw}`);
  const actual = Buffer.from(sigB64, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  return passVer;
}

export type RoomAccess =
  | { status: "ok"; room: RoomMetadata }
  | { status: "missing" }
  | { status: "locked" };

/**
 * Gate for every room-scoped endpoint and the sync socket. Open rooms pass
 * through; locked rooms require a ticket issued by the unlock endpoint.
 * Missing rooms report 'missing' (callers map to 404) so locked rooms are
 * indistinguishable from absent ones without a ticket.
 *
 * Both the header and query tickets are tried: callers may carry a user
 * session in `Authorization` with the room ticket as `?ticket=`, and the
 * first verifiable, current-version ticket wins.
 */
export async function authorizeRoom(
  manager: {
    getRoomMetadata(roomId: string): Promise<RoomMetadata | null>;
    getPasswordVersion(roomId: string): Promise<number | null>;
  },
  roomId: string,
  ticket: string | undefined,
  queryTicket: string | undefined,
  secret: string,
): Promise<RoomAccess> {
  const room = await manager.getRoomMetadata(roomId);
  if (!room) return { status: "missing" };
  if (!room.hasPassword) return { status: "ok", room };
  const current = await manager.getPasswordVersion(roomId);
  if (current === null) return { status: "missing" };
  for (const candidate of [ticket, queryTicket]) {
    if (!candidate) continue;
    if (verifyTicket(secret, candidate, roomId) === current)
      return { status: "ok", room };
  }
  return { status: "locked" };
}

export function extractTicket(
  headers: Record<string, string | undefined>,
  query: Record<string, unknown>,
): string | undefined {
  const authorization = headers["authorization"];
  if (typeof authorization === "string") {
    const parts = authorization.trim().split(/\s+/);
    if (
      parts.length === 2 &&
      parts[0]?.toLowerCase() === "bearer" &&
      parts[1]
    )
      return parts[1];
  }
  const param = query["ticket"];
  return typeof param === "string" && param ? param : undefined;
}
