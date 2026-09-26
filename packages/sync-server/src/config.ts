import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  D2_COMPILER_URL: z.string().url().optional(),
  SNAPSHOT_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2000),
  ROOM_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(300000),
  D2_COMMUNITY_NODE_LIMIT: z.coerce.number().int().positive().default(30),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  R2_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_000_000),
  R2_URL_EXPIRES_IN_SEC: z.coerce.number().int().positive().default(900),
  SNAPSHOT_MAX_PER_ROOM: z.coerce.number().int().positive().default(100),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  ROOM_TICKET_SECRET: z.string().min(1).optional(),
  ROOM_TICKET_TTL_SEC: z.coerce.number().int().positive().default(86400),
  USER_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(604800),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  BILLING_SUCCESS_URL: z.string().url().optional(),
  BILLING_CANCEL_URL: z.string().url().optional(),
  BILLING_RETURN_URL: z.string().url().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Config = {
  port: number;
  host: string;
  databaseUrl?: string;
  redisUrl?: string;
  d2CompilerUrl?: string;
  snapshotDebounceMs: number;
  roomIdleTimeoutMs: number;
  d2CommunityNodeLimit: number;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Bucket?: string;
  r2PublicBaseUrl?: string;
  r2MaxUploadBytes: number;
  r2UrlExpiresInSec: number;
  snapshotMaxPerRoom: number;
  snapshotRetentionDays: number;
  roomTicketSecret?: string;
  roomTicketTtlSec: number;
  userTokenTtlSec: number;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePricePro?: string;
  billingSuccessUrl?: string;
  billingCancelUrl?: string;
  billingReturnUrl?: string;
  nodeEnv: "development" | "test" | "production";
};

/**
 * Minimal `.env` loader (no dependency). Node/tsx do not auto-load dotenv
 * files, so bare-metal `bun run dev:sync` (tsx) needs this to pick up
 * `packages/sync-server/.env`. Real environment variables always win; blank
 * values are left for the empty-string normalization in `loadConfig`.
 */
function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
  ];
  for (const path of candidates) {
    let text: string;
    try {
      if (!existsSync(path)) continue;
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const body = trimmed.startsWith("export ")
        ? trimmed.slice("export ".length).trimStart()
        : trimmed;
      const eq = body.indexOf("=");
      if (eq <= 0) continue;
      const key = body.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = body.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      )
        value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Only read dotenv files for the live process environment; explicit env
  // objects (tests, library use) stay hermetic.
  if (env === process.env) loadDotEnv();
  // Treat blank values as unset so that empty assignments in `.env` files
  // (e.g. `ROOM_TICKET_SECRET=`) behave like missing variables instead of
  // failing URL / min-length validation.
  const normalized = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ]),
  );
  const parsed = envSchema.parse(normalized);
  if (parsed.NODE_ENV === "production" && !parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    d2CompilerUrl: parsed.D2_COMPILER_URL,
    snapshotDebounceMs: parsed.SNAPSHOT_DEBOUNCE_MS,
    roomIdleTimeoutMs: parsed.ROOM_IDLE_TIMEOUT_MS,
    d2CommunityNodeLimit: parsed.D2_COMMUNITY_NODE_LIMIT,
    r2AccountId: parsed.R2_ACCOUNT_ID,
    r2AccessKeyId: parsed.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: parsed.R2_SECRET_ACCESS_KEY,
    r2Bucket: parsed.R2_BUCKET,
    r2PublicBaseUrl: parsed.R2_PUBLIC_BASE_URL,
    r2MaxUploadBytes: parsed.R2_MAX_UPLOAD_BYTES,
    r2UrlExpiresInSec: parsed.R2_URL_EXPIRES_IN_SEC,
    snapshotMaxPerRoom: parsed.SNAPSHOT_MAX_PER_ROOM,
    snapshotRetentionDays: parsed.SNAPSHOT_RETENTION_DAYS,
    roomTicketSecret: parsed.ROOM_TICKET_SECRET,
    roomTicketTtlSec: parsed.ROOM_TICKET_TTL_SEC,
    userTokenTtlSec: parsed.USER_TOKEN_TTL_SEC,
    stripeSecretKey: parsed.STRIPE_SECRET_KEY,
    stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
    stripePricePro: parsed.STRIPE_PRICE_PRO,
    billingSuccessUrl: parsed.BILLING_SUCCESS_URL,
    billingCancelUrl: parsed.BILLING_CANCEL_URL,
    billingReturnUrl: parsed.BILLING_RETURN_URL,
    nodeEnv: parsed.NODE_ENV,
  };
}
