import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  D2_COMPILER_URL: z.string().url().optional(),
  SNAPSHOT_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2000),
  ROOM_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(300000),
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
    nodeEnv: parsed.NODE_ENV,
  };
}
