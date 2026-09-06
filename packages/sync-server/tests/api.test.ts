import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  assertEngineAllowed,
  assertNodeCountAllowed,
  TierUpgradeError,
} from '../src/d2-compiler.js';
import { createSyncServer, type SyncServer } from '../src/index.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';

describe('HTTP API', () => {
  let app: SyncServer;
  let baseUrl: string;

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
      },
      new MemorySnapshotStore(),
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

  test('creates rooms and returns a development D2 placeholder', async () => {
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Architecture' }),
    });
    expect(roomResponse.status).toBe(201);
    const room = (await roomResponse.json()) as { id: string; name: string };
    expect(room.name).toBe('Architecture');

    const compileResponse = await fetch(`${baseUrl}/api/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'a -> b' }),
    });
    expect(compileResponse.status).toBe(200);
    expect((await compileResponse.json()).placeholder).toBe(true);
  });

  test('rejects Pro-only engines for Community callers', async () => {
    for (const engine of ['elk', 'tala']) {
      const response = await fetch(`${baseUrl}/api/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'a -> b', engine }),
      });
      expect(response.status).toBe(403);
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload.code).toBe('TIER_UPGRADE_REQUIRED');
    }
  });

  test('ignores a client-asserted Pro tier without a room', async () => {
    const response = await fetch(`${baseUrl}/api/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'a -> b', engine: 'tala', tier: 'PRO' }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      'TIER_UPGRADE_REQUIRED',
    );
  });

  test('rejects unknown engines and rooms', async () => {
    const badEngine = await fetch(`${baseUrl}/api/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'a -> b', engine: 'graphviz' }),
    });
    expect(badEngine.status).toBe(400);
    expect(((await badEngine.json()) as Record<string, unknown>).code).toBe(
      'INVALID_ENGINE',
    );

    const missingRoom = await fetch(`${baseUrl}/api/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'a -> b', roomId: 'no-such-room' }),
    });
    expect(missingRoom.status).toBe(404);
  });

  test('resolves the tier from the room for Pro compiles', async () => {
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pro diagrams', tier: 'PRO' }),
    });
    expect(roomResponse.status).toBe(201);
    const room = (await roomResponse.json()) as { id: string };

    const compileResponse = await fetch(`${baseUrl}/api/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'a -> b',
        engine: 'elk',
        roomId: room.id,
      }),
    });
    expect(compileResponse.status).toBe(200);
    const payload = (await compileResponse.json()) as {
      engine: string;
      placeholder: boolean;
    };
    expect(payload.engine).toBe('elk');
    expect(payload.placeholder).toBe(true);
  });
});

describe('D2 tier limits', () => {
  test('allows dagre on every tier and elk/tala on Pro and Enterprise', () => {
    expect(() => assertEngineAllowed('dagre', 'COMMUNITY')).not.toThrow();
    expect(() => assertEngineAllowed('elk', 'PRO')).not.toThrow();
    expect(() => assertEngineAllowed('tala', 'ENTERPRISE')).not.toThrow();
    expect(() => assertEngineAllowed('elk', 'COMMUNITY')).toThrow(
      TierUpgradeError,
    );
    expect(() => assertEngineAllowed('tala', 'COMMUNITY')).toThrow(
      TierUpgradeError,
    );
  });

  test('caps Community diagrams at the node limit', () => {
    expect(() => assertNodeCountAllowed(30, 'COMMUNITY', 30)).not.toThrow();
    expect(() => assertNodeCountAllowed(31, 'COMMUNITY', 30)).toThrow(
      TierUpgradeError,
    );
    expect(() => assertNodeCountAllowed(500, 'PRO', 30)).not.toThrow();
    expect(() => assertNodeCountAllowed(500, 'ENTERPRISE', 30)).not.toThrow();
  });
});
