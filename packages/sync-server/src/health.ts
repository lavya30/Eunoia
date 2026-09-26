import { Redis } from 'ioredis';
import type { Config } from './config.js';
import { resolveR2Config } from './images.js';

export type CheckStatus = 'ok' | 'skipped' | 'degraded' | 'error';

export type DependencyCheck = {
  status: CheckStatus;
  /** Milliseconds the check took. Absent when skipped. */
  latencyMs?: number;
  /** Human-readable detail for the status page. */
  detail?: string;
};

export type Readiness = {
  status: 'ready' | 'degraded' | 'down';
  version: string;
  uptimeSec: number;
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
    compiler: DependencyCheck;
    imageStorage: DependencyCheck;
  };
};

export type HealthChecks = {
  checkDatabase: () => Promise<DependencyCheck>;
  checkRedis: () => Promise<DependencyCheck>;
  checkCompiler: () => Promise<DependencyCheck>;
};

const CHECK_TIMEOUT_MS = 2500;

async function withTimeout<T>(
  label: string,
  run: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const started = Date.now();
  const value = await Promise.race([
    run(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} check timed out`)),
        CHECK_TIMEOUT_MS,
      ),
    ),
  ]);
  return { value, latencyMs: Date.now() - started };
}

function compilerHealthUrl(compilerUrl: string): string {
  const url = new URL(compilerUrl);
  if (/\/compile\/?$/.test(url.pathname))
    url.pathname = url.pathname.replace(/\/compile\/?$/, '/healthz');
  else if (!url.pathname.includes('healthz')) url.pathname = '/healthz';
  return url.toString();
}

/**
 * Default dependency checks built from server config. `prisma` is the live
 * client when DATABASE_URL is set (undefined in dev/test memory mode).
 * Every check is bounded by CHECK_TIMEOUT_MS and never throws — failures
 * are reported as check results so /readyz always answers.
 */
export function defaultHealthChecks(
  config: Config,
  prisma: { $queryRaw: unknown } | undefined,
): HealthChecks {
  return {
    checkDatabase: async () => {
      if (!config.databaseUrl) return { status: 'skipped' as const };
      if (!prisma)
        return { status: 'error' as const, detail: 'client unavailable' };
      try {
        const { latencyMs } = await withTimeout(
          'database',
          () =>
            (prisma.$queryRaw as (
              query: unknown,
            ) => Promise<unknown>)`SELECT 1`,
        );
        return { status: 'ok' as const, latencyMs };
      } catch (error) {
        return {
          status: 'error' as const,
          detail: error instanceof Error ? error.message : 'query failed',
        };
      }
    },
    checkRedis: async () => {
      if (!config.redisUrl) return { status: 'skipped' as const };
      const client = new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: CHECK_TIMEOUT_MS,
      });
      try {
        const { latencyMs } = await withTimeout('redis', () => client.ping());
        return { status: 'ok' as const, latencyMs };
      } catch (error) {
        return {
          // Cursor telemetry degrades gracefully without Redis — sync
          // itself never depends on it — so this is degraded, not down.
          status: 'degraded' as const,
          detail: error instanceof Error ? error.message : 'ping failed',
        };
      } finally {
        await client.quit().catch(() => undefined);
      }
    },
    checkCompiler: async () => {
      if (!config.d2CompilerUrl) return { status: 'skipped' as const };
      try {
        const { value, latencyMs } = await withTimeout('compiler', () =>
          fetch(compilerHealthUrl(config.d2CompilerUrl as string), {
            signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          }),
        );
        if (!value.ok)
          return {
            status: 'degraded' as const,
            detail: `healthz answered ${value.status}`,
          };
        return { status: 'ok' as const, latencyMs };
      } catch (error) {
        // Placeholder layouts keep /api/compile answering in dev; in
        // production the compile path surfaces the failure itself.
        return {
          status: 'degraded' as const,
          detail: error instanceof Error ? error.message : 'unreachable',
        };
      }
    },
  };
}

/** R2 needs no network probe: presence of config decides the check. */
export function imageStorageCheck(config: Config): DependencyCheck {
  return resolveR2Config(config)
    ? { status: 'ok' }
    : { status: 'skipped', detail: 'R2 not configured; image endpoints 503' };
}

export function summarizeReadiness(
  database: DependencyCheck,
  redis: DependencyCheck,
  compiler: DependencyCheck,
  imageStorage: DependencyCheck,
  version: string,
  uptimeSec: number,
): Readiness {
  // Persistence is load-bearing: without it every room is ephemeral, so a
  // configured-but-unreachable database takes the server out of rotation.
  const status =
    database.status === 'error'
      ? 'down'
      : redis.status === 'degraded' || compiler.status === 'degraded'
        ? 'degraded'
        : 'ready';
  return {
    status,
    version,
    uptimeSec: Math.floor(uptimeSec),
    checks: { database, redis, compiler, imageStorage },
  };
}
