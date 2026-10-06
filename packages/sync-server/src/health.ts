import { Redis } from 'ioredis';
import type { Config } from './config.js';
import { resolveR2Config } from './images.js';
import { jevLastOutcome } from './jev.js';

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
    jev: DependencyCheck;
  };
};

export type HealthChecks = {
  checkDatabase: () => Promise<DependencyCheck>;
  checkRedis: () => Promise<DependencyCheck>;
  checkCompiler: () => Promise<DependencyCheck>;
  checkImageStorage?: () => Promise<DependencyCheck>;
  checkJev?: () => Promise<DependencyCheck>;
};

const CHECK_TIMEOUT_MS = 2500;

async function withTimeout<T>(
  label: string,
  run: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error(`${label} check timed out`)),
            CHECK_TIMEOUT_MS,
          )),
      ),
    ]);
    return { value, latencyMs: Date.now() - started };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
  r2?: { probe: () => Promise<void> } | null,
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
    checkImageStorage: async () => {
      if (!resolveR2Config(config)) return { status: 'skipped' as const };
      if (!r2)
        return {
          status: 'degraded' as const,
          detail: 'R2 configured but client unavailable',
        };
      try {
        const { latencyMs } = await withTimeout('imageStorage', () =>
          r2.probe(),
        );
        return { status: 'ok' as const, latencyMs };
      } catch (error) {
        // Uploads stay 503 while R2 is unreachable, but sync/persistence
        // keep working — degraded, never down.
        return {
          status: 'degraded' as const,
          detail: error instanceof Error ? error.message : 'unreachable',
        };
      }
    },
    checkJev: async () => jevCheck(config),
  };
}

/** R2 needs no network probe: presence of config decides the check. */
export function imageStorageCheck(config: Config): DependencyCheck {
  return resolveR2Config(config)
    ? { status: 'ok' }
    : { status: 'skipped', detail: 'R2 not configured; image endpoints 503' };
}

/**
 * Jev needs no network probe: a live probe would spend budget on every
 * /readyz poll. Presence of the key decides between ok/skipped, while the
 * last configured round-trip outcome (tracked in jev.ts, sticky until the
 * next success) surfaces recent outages as degraded. Degraded never takes
 * the server out of rotation: fail-open still generates unguarded, and
 * fail-closed surfaces per-request 503s on the AI route itself.
 */
export function jevCheck(config: Config): DependencyCheck {
  if (!config.jevApiKey) {
    return {
      status: 'skipped',
      detail: 'JEV_API_KEY unset; guardrails skipped',
    };
  }
  if (jevLastOutcome() === false) {
    return {
      status: 'degraded',
      detail: 'Jev guardrails failing; see eunoia_jev_evaluations_total',
    };
  }
  return { status: 'ok', detail: 'Jev guardrails enabled' };
}

export function summarizeReadiness(
  database: DependencyCheck,
  redis: DependencyCheck,
  compiler: DependencyCheck,
  imageStorage: DependencyCheck,
  version: string,
  uptimeSec: number,
  jev: DependencyCheck = { status: 'skipped' as const },
): Readiness {
  // Persistence is load-bearing: without it every room is ephemeral, so a
  // configured-but-unreachable database takes the server out of rotation.
  // Redis/compiler failures (including unexpected "error" results from
  // custom check implementations) only ever degrade — sync, persistence,
  // and placeholder compiles keep working without them.
  const degraded =
    redis.status === 'degraded' ||
    redis.status === 'error' ||
    compiler.status === 'degraded' ||
    compiler.status === 'error';
  const status =
    database.status === 'error' ? 'down' : degraded ? 'degraded' : 'ready';
  return {
    status,
    version,
    uptimeSec: Math.floor(uptimeSec),
    checks: { database, redis, compiler, imageStorage, jev },
  };
}
