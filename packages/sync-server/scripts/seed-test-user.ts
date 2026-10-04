/**
 * Seed a full-access test user (development only — never production or CI).
 *
 * Creates (or finds) a user by email and elevates them to ENTERPRISE, which
 * passes every tier gate: elk/tala engines, the community node cap, room
 * tier ceilings, all export formats, and the top AI quota (2000/mo).
 * Tiers only change via the billing webhook in production; this script
 * writes to the database directly, so it must never run outside dev.
 *
 * Run from `packages/sync-server/`:
 *   bun scripts/seed-test-user.ts [--email=tester@eunoia.dev]
 *     [--password=test12345] [--tier=ENTERPRISE] [--name="Test User"]
 *
 * Then log in at http://localhost:3000/login with the email + password.
 * Note: dev uses an ephemeral ROOM_TICKET_SECRET unless set in `.env`,
 * so session tokens invalidate on every server restart — just log in again.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, isValidPassword } from "../src/room-auth.js";
import type { Tier } from "../src/d2-compiler.js";
import { normalizeEmail, PrismaUserStore } from "../src/users.js";

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  for (const token of process.argv.slice(2)) {
    if (token.startsWith(prefix)) return token.slice(prefix.length);
  }
  return fallback;
}

function fail(message: string): never {
  console.error(`SEED FAIL: ${message}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("refusing to run with NODE_ENV=production (development only)");
}

const databaseUrl = process.env.DATABASE_URL ?? "";
const isLocalDb =
  databaseUrl.startsWith("file:") ||
  /(localhost|127\.0\.0\.1|::1|postgres)/.test(databaseUrl);
if (!isLocalDb && !process.argv.includes("--allow-remote")) {
  fail(
    `DATABASE_URL does not look local (${databaseUrl.split("@").pop() ?? "unset"}). ` +
      "Refusing to seed a possibly-shared database without --allow-remote.",
  );
}

const email = arg("email", "tester@eunoia.dev") as string;
const password = arg("password", "test12345") as string;
const name = arg("name", "Test User") as string;
const tierRaw = (arg("tier", "ENTERPRISE") as string).toUpperCase();
if (!isValidPassword(password)) {
  fail("password must be at least 8 characters");
}
if (tierRaw !== "COMMUNITY" && tierRaw !== "PRO" && tierRaw !== "ENTERPRISE") {
  fail(`unknown tier "${tierRaw}" (expected COMMUNITY, PRO, or ENTERPRISE)`);
}
const tier = tierRaw as Tier;

const prisma = new PrismaClient();
const users = new PrismaUserStore(prisma);

try {
  const normalized = normalizeEmail(email);
  let user = await users.findByEmail(normalized);
  if (!user) {
    user = await users.createUser({
      email: normalized,
      name,
      passwordHash: hashPassword(password),
    });
    if (!user) fail(`email already taken: ${normalized}`);
    console.log(`created user ${normalized}`);
  } else {
    console.log(`found existing user ${normalized} (id=${user.id})`);
  }
  const elevated = await users.updateTier((user as { id: string }).id, tier);
  if (!elevated) fail(`user vanished after lookup: ${normalized}`);
  console.log(
    `RESULT ${JSON.stringify({ seed: "test-user", email: elevated.email, id: elevated.id, tier: elevated.tier, pass: true })}`,
  );
  console.log(`done. Log in at http://localhost:3000/login as ${email}.`);
} finally {
  await prisma.$disconnect();
}
