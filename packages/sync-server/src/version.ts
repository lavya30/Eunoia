import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime version for /health and /readyz. Reads the package version next
 * to the source tree (`src/..`) or the built layout (`dist/..`); falls
 * back to APP_VERSION, then "dev". Never throws — health endpoints must
 * not depend on release plumbing.
 */
export function appVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      resolve(here, '..', 'package.json'),
      resolve(here, '..', '..', 'package.json'),
    ]) {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
        version?: unknown;
      };
      if (typeof parsed.version === 'string' && parsed.version.trim())
        return parsed.version.trim();
    }
  } catch {
    // Fall through to the dev fallback.
  }
  return 'dev';
}
