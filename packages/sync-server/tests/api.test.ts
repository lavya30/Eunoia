import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  assertEngineAllowed,
  assertNodeCountAllowed,
  TierUpgradeError,
} from '../src/d2-compiler.js';
import { MemoryImageStore, MemoryR2Client } from '../src/images.js';
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
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
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

describe('Room images', () => {
  let app: SyncServer;
  let baseUrl: string;
  let roomId: string;

  const post = (path: string, payload: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
      },
      new MemorySnapshotStore(),
      { imageStore: new MemoryImageStore(), r2: new MemoryR2Client() },
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const roomResponse = await post('/api/rooms', { name: 'Gallery' });
    expect(roomResponse.status).toBe(201);
    roomId = ((await roomResponse.json()) as { id: string }).id;
  });

  afterEach(async () => app.close());

  async function upload(
    contentType = 'image/png',
    kind = 'image',
    size = 1024,
  ) {
    const requestResponse = await post(
      `/api/rooms/${roomId}/images/request-upload`,
      { contentType, kind },
    );
    expect(requestResponse.status).toBe(200);
    const { key } = (await requestResponse.json()) as { key: string };
    expect(key.startsWith(`rooms/${roomId}/`)).toBe(true);
    const confirmResponse = await post(`/api/rooms/${roomId}/images/confirm`, {
      key,
      contentType,
      size,
      kind,
    });
    return { key, confirmResponse };
  }

  test('runs the full upload-confirm-list-url-delete lifecycle', async () => {
    const { key, confirmResponse } = await upload();
    expect(confirmResponse.status).toBe(201);
    const image = (await confirmResponse.json()) as {
      id: string;
      roomId: string;
      key: string;
      url: string;
      contentType: string;
      size: number;
      kind: string;
    };
    expect(image.key).toBe(key);
    expect(image.roomId).toBe(roomId);
    expect(image.contentType).toBe('image/png');
    expect(image.size).toBe(1024);

    const list = await fetch(`${baseUrl}/api/rooms/${roomId}/images`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const url = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images/${image.id}/url`,
    );
    expect(url.status).toBe(200);
    expect(typeof ((await url.json()) as { url: string }).url).toBe('string');

    const remove = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images/${image.id}`,
      { method: 'DELETE' },
    );
    expect(remove.status).toBe(204);

    const afterDelete = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images/${image.id}/url`,
    );
    expect(afterDelete.status).toBe(404);
  });

  test('rejects bad input, foreign keys, duplicates, and oversize uploads', async () => {
    const badType = await post(`/api/rooms/${roomId}/images/request-upload`, {
      contentType: 'text/html',
    });
    expect(badType.status).toBe(400);

    const missingRoom = await post(
      '/api/rooms/no-such-room/images/request-upload',
      { contentType: 'image/png' },
    );
    expect(missingRoom.status).toBe(404);

    const missingObject = await post(`/api/rooms/${roomId}/images/confirm`, {
      key: `rooms/${roomId}/never-uploaded.png`,
      size: 10,
    });
    expect(missingObject.status).toBe(404);

    const { key, confirmResponse } = await upload();
    expect(confirmResponse.status).toBe(201);
    const duplicate = await post(`/api/rooms/${roomId}/images/confirm`, {
      key,
      size: 10,
    });
    expect(duplicate.status).toBe(409);

    const oversize = await upload('image/png', 'image', 11_000_000);
    expect(oversize.confirmResponse.status).toBe(413);
  });

  test('scopes keys to rooms and filters listings by kind', async () => {
    await upload('image/png', 'thumbnail');
    await upload('image/jpeg', 'image');

    const other = await post('/api/rooms', { name: 'Other' });
    const otherId = ((await other.json()) as { id: string }).id;
    const foreign = await post(`/api/rooms/${otherId}/images/request-upload`, {
      contentType: 'image/png',
    });
    const foreignKey = ((await foreign.json()) as { key: string }).key;
    const smuggled = await post(`/api/rooms/${roomId}/images/confirm`, {
      key: foreignKey,
      size: 10,
    });
    expect(smuggled.status).toBe(400);

    const thumbnails = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images?kind=thumbnail`,
    );
    expect(thumbnails.status).toBe(200);
    const items = (await thumbnails.json()) as { kind: string }[];
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe('thumbnail');

    const badKind = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images?kind=document`,
    );
    expect(badKind.status).toBe(400);
  });

  test('returns 503 when R2 is not configured', async () => {
    const bare = createSyncServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
      },
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      bare.server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = bare.server.address();
      if (!address || typeof address === 'string')
        throw new Error('Server did not bind');
      const url = `http://127.0.0.1:${address.port}`;
      const roomResponse = await fetch(`${url}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bare' }),
      });
      const bareRoomId = ((await roomResponse.json()) as { id: string }).id;
      const response = await fetch(
        `${url}/api/rooms/${bareRoomId}/images/request-upload`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contentType: 'image/png' }),
        },
      );
      expect(response.status).toBe(503);
      expect(((await response.json()) as Record<string, unknown>).code).toBe(
        'R2_NOT_CONFIGURED',
      );
    } finally {
      await bare.close();
    }
  });
});
