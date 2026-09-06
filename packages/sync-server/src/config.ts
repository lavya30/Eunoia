import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
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
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
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
  nodeEnv: 'development' | 'test' | 'production';
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  if (parsed.NODE_ENV === 'production' && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
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
    nodeEnv: parsed.NODE_ENV,
  };
}
