import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createSyncServer, type SyncServer } from '../src/index.js';
import { groupRoute } from '../src/metrics.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';

function testConfig() {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test' as const,
    snapshotDebounceMs: 10,
    roomIdleTimeoutMs: 10,
    d2CommunityNodeLimit: 30,
    snapshotMaxPerRoom: 100,
    snapshotRetentionDays: 30,
    roomTicketTtlSec: 86400,
    userTokenTtlSec: 604800,
    r2MaxUploadBytes: 10_000_000,
    r2UrlExpiresInSec: 900,
  };
}

describe('health, readiness, and metrics', () => {
  let app: SyncServer;
  let baseUrl: string;

  beforeEach(async () => {
    app = createSyncServer(testConfig(), new MemorySnapshotStore());
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => app.close());

  test('GET /health reports liveness with version and uptime', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      version: string;
      uptimeSec: number;
      activeRooms: number;
    };
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(body.activeRooms).toBe(0);
  });

  test('GET /readyz is ready when optional deps are unconfigured', async () => {
    const response = await fetch(`${baseUrl}/readyz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      version: string;
      checks: Record<string, { status: string }>;
    };
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('skipped');
    expect(body.checks.redis.status).toBe('skipped');
    expect(body.checks.compiler.status).toBe('skipped');
    expect(body.checks.imageStorage.status).toBe('skipped');
  });

  test('GET /metrics exposes Prometheus counters and gauges', async () => {
    await fetch(`${baseUrl}/health`);
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const text = await response.text();
    expect(text).toContain('eunoia_http_requests_total');
    expect(text).toContain('route="GET /health"');
    expect(text).toContain('eunoia_compile_requests_total');
    expect(text).toContain('eunoia_active_rooms 0');
    expect(text).toContain('eunoia_ws_connections');
    expect(text).toContain('eunoia_uptime_seconds');
  });

  test('compile requests are counted by engine and outcome', async () => {
    await fetch(`${baseUrl}/api/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'a -> b' }),
    });
    const text = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(text).toContain(
      'eunoia_compile_requests_total{engine="dagre",outcome="placeholder"} 1',
    );
  });
});

describe('readiness down state', () => {
  let app: SyncServer;
  let baseUrl: string;

  beforeEach(async () => {
    app = createSyncServer(
      testConfig(),
      new MemorySnapshotStore(),
      undefined,
      undefined,
      {
        checkDatabase: async () => ({ status: 'error', detail: 'boom' }),
        checkRedis: async () => ({ status: 'skipped' }),
        checkCompiler: async () => ({ status: 'skipped' }),
      },
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => app.close());

  test('GET /readyz returns 503 when the database check fails', async () => {
    const response = await fetch(`${baseUrl}/readyz`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('down');
  });
});

describe('groupRoute', () => {
  test('collapses ids to templates and groups websocket paths', () => {
    expect(groupRoute('GET', '/health')).toBe('GET /health');
    expect(groupRoute('GET', '/api/rooms/abc')).toBe('GET /api/rooms/:roomId');
    expect(groupRoute('GET', '/api/rooms/abc/images/img-1/bytes')).toBe(
      'GET /api/rooms/:roomId/images/:imageId/bytes',
    );
    expect(groupRoute('POST', '/api/rooms/abc/snapshots/s1/restore')).toBe(
      'POST /api/rooms/:roomId/snapshots/:snapshotId/restore',
    );
    expect(groupRoute('GET', '/sync/abc')).toBe('WS /sync');
    expect(groupRoute('POST', '/api/compile')).toBe('POST /api/compile');
    expect(groupRoute('GET', '/nope')).toBe('OTHER');
  });
});
