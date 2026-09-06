import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as encoding from 'lib0/encoding';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  assertEngineAllowed,
  assertNodeCountAllowed,
  TierUpgradeError,
} from '../src/d2-compiler.js';
import { MemoryImageStore, MemoryR2Client } from '../src/images.js';
import { createSyncServer, type SyncServer } from '../src/index.js';
import { Room } from '../src/Room.js';
import {
  applyRetention,
  MemorySnapshotStore,
  type StoredSnapshot,
} from '../src/RoomLoader.js';
import {
  hashPassword,
  issueTicket,
  isValidPassword,
  verifyPassword,
  verifyTicket,
} from '../src/room-auth.js';
import { SnapshotWorker } from '../src/SnapshotWorker.js';
import type { RoomClient } from '../src/types.js';

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
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
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
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
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
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
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

describe('Snapshot history', () => {
  let app: SyncServer;
  let baseUrl: string;
  let wsUrl: string;
  let roomId: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
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
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'History' }),
    });
    expect(roomResponse.status).toBe(201);
    roomId = ((await roomResponse.json()) as { id: string }).id;
    wsUrl = `ws://127.0.0.1:${address.port}/sync/${roomId}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
  });

  /** Push a canvas mutation through the sync protocol and await its flush. */
  async function pushUpdate(value: unknown): Promise<WebSocket> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    sockets.push(socket);
    const doc = new Y.Doc();
    doc.getMap('canvas').set('a', value);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    socket.send(encoding.toUint8Array(encoder));
    await new Promise((resolve) => setTimeout(resolve, 60));
    return socket;
  }

  async function list(query = '') {
    const response = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots${query}`,
    );
    return {
      status: response.status,
      items: (await response.json()) as {
        id: string;
        docVersion: string;
        createdAt: string;
        data?: unknown;
      }[],
    };
  }

  test('lists snapshots newest-first without document bytes', async () => {
    expect((await list()).items).toEqual([]);
    await pushUpdate(1);
    const { status, items } = await list();
    expect(status).toBe(200);
    expect(items.length).toBe(1);
    expect(items[0].id).toBeString();
    expect(items[0].docVersion).toBeString();
    expect(items[0].createdAt).toBeString();
    expect(items[0].data).toBeUndefined();
  });

  test('paginates with limit and before', async () => {
    await pushUpdate(1);
    await pushUpdate(2);
    await pushUpdate(3);
    const full = (await list()).items;
    expect(full.length).toBe(3);

    const limited = await list('?limit=2');
    expect(limited.items.length).toBe(2);
    expect(limited.items.map((item) => item.id)).toEqual(
      full.slice(0, 2).map((item) => item.id),
    );

    const older = await list(
      `?before=${encodeURIComponent(full[0].createdAt)}`,
    );
    expect(older.items.map((item) => item.id)).toEqual(
      full.slice(1).map((item) => item.id),
    );

    const badLimit = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots?limit=500`,
    );
    expect(badLimit.status).toBe(400);
    const badBefore = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots?before=not-a-date`,
    );
    expect(badBefore.status).toBe(400);
    const missing = await fetch(`${baseUrl}/api/rooms/no-such-room/snapshots`);
    expect(missing.status).toBe(404);
  });

  test('restores a snapshot, keeps a safety copy, and drops peers', async () => {
    await pushUpdate(1);
    const peer = await pushUpdate(2);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      peer.once('close', (code: number, reason: Buffer) =>
        resolve({ code, reason: reason.toString() }),
      );
    });

    const before = (await list()).items;
    expect(before.length).toBe(2);

    const restore = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots/${before[1].id}/restore`,
      { method: 'POST' },
    );
    expect(restore.status).toBe(200);
    const receipt = (await restore.json()) as {
      restored: string;
      restoredAt: string;
    };
    expect(receipt.restored).toBe(before[1].id);

    // Safety flush of the pre-restore state plus the restored state.
    const after = (await list()).items;
    expect(after.length).toBeGreaterThanOrEqual(3);

    // Peers holding newer state are dropped so they resync from scratch.
    const { code } = await Promise.race([
      closed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('peer was not dropped')), 1000),
      ),
    ]);
    expect(code).toBe(4100);

    const unknown = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots/no-such-id/restore`,
      { method: 'POST' },
    );
    expect(unknown.status).toBe(404);
  });

  test('room content actually rolls back', async () => {
    const store = new MemorySnapshotStore();
    const doc = new Y.Doc();
    doc.getMap('canvas').set('a', 1);
    const worker = new SnapshotWorker('rollback-room', store, 0);
    worker.schedule(doc);
    await worker.flush(doc);

    const room = new Room('rollback-room', doc, worker);
    const [first] = await store.listSnapshots('rollback-room');
    doc.getMap('canvas').set('a', 2);
    worker.schedule(doc);
    await worker.flush(doc);

    const closed: { code: number; reason: string }[] = [];
    const fakeSocket = {
      close: (code: number, reason: string) => closed.push({ code, reason }),
    };
    const client: RoomClient = {
      id: 'peer',
      socket: fakeSocket as unknown as RoomClient['socket'],
      send: () => undefined,
    };
    room.addClient(client);
    await room.restoreSnapshot(first);
    expect(room.doc.getMap('canvas').get('a')).toBe(1);
    expect(closed.length).toBe(1);
    expect(closed[0].code).toBe(4100);
    await room.dispose();
  });
});

describe('Snapshot retention', () => {
  const now = Date.now();
  const snap = (id: string, ageMs: number): StoredSnapshot => ({
    id,
    roomId: 'retention-room',
    docVersion: 'v',
    data: new Uint8Array(),
    createdAt: new Date(now - ageMs),
  });

  test('keeps the newest, the newest-K, and the retention window', () => {
    const day = 86_400_000;
    const snapshots = [
      snap('ancient', 40 * day),
      snap('old', 20 * day),
      snap('mid', 10 * day),
      snap('fresh', day),
      snap('newest', 0),
    ];
    const kept = applyRetention(snapshots, now, {
      maxPerRoom: 2,
      retentionDays: 30,
    }).map((s) => s.id);
    // newest + newest-2 + everything inside 30 days (ancient drops).
    expect(kept.sort()).toEqual(['fresh', 'mid', 'newest', 'old']);
  });

  test('never drops the only snapshot', () => {
    const snapshots = [snap('lonely', 400 * 86_400_000)];
    expect(
      applyRetention(snapshots, now, { maxPerRoom: 1, retentionDays: 1 }),
    ).toEqual(snapshots);
    expect(
      applyRetention([], now, { maxPerRoom: 1, retentionDays: 1 }),
    ).toEqual([]);
  });

  test('memory store prunes on save', async () => {
    const day = 86_400_000;
    const store = new MemorySnapshotStore({ maxPerRoom: 3, retentionDays: 30 });
    const ages = [40 * day, 39 * day, 38 * day, day, 0];
    for (let i = 0; i < ages.length; i++)
      await store.saveSnapshot(snap(`s${i}`, ages[i]));
    const listed = await store.listSnapshots('retention-room');
    expect(listed.map((s) => s.id)).toEqual(['s4', 's3', 's2']);
    expect(await store.getLatestSnapshot('retention-room')).toMatchObject({
      id: 's4',
    });
  });
});

describe('Room passwords', () => {
  let app: SyncServer;
  let baseUrl: string;
  let wsBase: string;
  let lockedId: string;
  let openId: string;
  let ticket: string;

  const post = (path: string, payload: unknown, auth?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(payload),
    });

  const get = (path: string, auth?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });

  function wsConnect(room: string, withTicket?: string): Promise<string> {
    return new Promise((resolve) => {
      const socket = new WebSocket(
        `${wsBase}/sync/${room}${withTicket ? `?ticket=${withTicket}` : ''}`,
      );
      socket.once('open', () => {
        socket.close();
        resolve('open');
      });
      // A non-101 upgrade response emits this instead of 'error'.
      socket.once(
        'unexpected-response',
        (_request: unknown, response: { statusCode: number }) => {
          socket.close();
          resolve(`rejected:${response.statusCode}`);
        },
      );
      socket.once('error', () => resolve('error'));
      socket.once('close', () => resolve('close'));
    });
  }

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
        roomTicketTtlSec: 86400,
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
    wsBase = `ws://127.0.0.1:${address.port}`;

    const locked = await post('/api/rooms', {
      name: 'Locked',
      password: 's3cret-pass',
    });
    expect(locked.status).toBe(201);
    const lockedBody = (await locked.json()) as Record<string, unknown>;
    expect(lockedBody.hasPassword).toBe(true);
    expect(lockedBody.passwordHash).toBeUndefined();
    lockedId = lockedBody.id as string;

    const open = await post('/api/rooms', { name: 'Open' });
    openId = ((await open.json()) as { id: string }).id;

    const unlock = await post(`/api/rooms/${lockedId}/unlock`, {
      password: 's3cret-pass',
    });
    expect(unlock.status).toBe(200);
    ticket = ((await unlock.json()) as { ticket: string }).ticket;
  });

  afterEach(async () => app.close());

  test('rejects short passwords at creation', async () => {
    const response = await post('/api/rooms', {
      name: 'Weak',
      password: 'short',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      'INVALID_PASSWORD',
    );
  });

  test('gates room metadata behind a ticket', async () => {
    expect((await get(`/api/rooms/${lockedId}`)).status).toBe(401);
    const denied = (await (
      await get(`/api/rooms/${lockedId}`)
    ).json()) as Record<string, unknown>;
    expect(denied.code).toBe('ROOM_LOCKED');

    expect((await get(`/api/rooms/${lockedId}`, ticket)).status).toBe(200);
    expect((await get(`/api/rooms/${lockedId}?ticket=${ticket}`)).status).toBe(
      200,
    );
    expect((await get(`/api/rooms/${openId}`)).status).toBe(200);
  });

  test('unlock rejects wrong passwords', async () => {
    const response = await post(`/api/rooms/${lockedId}/unlock`, {
      password: 'wrong-pass',
    });
    expect(response.status).toBe(403);
    const missing = await post('/api/rooms/no-such-room/unlock', {
      password: 's3cret-pass',
    });
    expect(missing.status).toBe(404);
  });

  test('gates compile, images, and snapshots for locked rooms', async () => {
    const compile = await post('/api/compile', {
      source: 'a -> b',
      roomId: lockedId,
    });
    expect(compile.status).toBe(401);

    const authedCompile = await post(
      '/api/compile',
      { source: 'a -> b', roomId: lockedId },
      ticket,
    );
    expect(authedCompile.status).toBe(200);

    const images = await post(`/api/rooms/${lockedId}/images/request-upload`, {
      contentType: 'image/png',
    });
    expect(images.status).toBe(401);

    const snapshots = await get(`/api/rooms/${lockedId}/snapshots`);
    expect(snapshots.status).toBe(401);
    const authedSnapshots = await get(
      `/api/rooms/${lockedId}/snapshots`,
      ticket,
    );
    expect(authedSnapshots.status).toBe(200);
  });

  test('gates the sync socket behind a ticket', async () => {
    expect(await wsConnect(lockedId)).toBe('rejected:401');
    expect(await wsConnect(lockedId, ticket)).toBe('open');
    expect(await wsConnect(openId)).toBe('open');
    expect(await wsConnect(lockedId, 'forged.ticket.here')).toBe(
      'rejected:401',
    );
  });

  test('tickets are room-bound, expiring, and tamper-evident', async () => {
    const secret = 'test-secret';
    const { ticket: issued } = issueTicket(secret, 'room-a', 60, 1_000);
    expect(verifyTicket(secret, issued, 'room-a', 1_030)).toBe(true);
    expect(verifyTicket(secret, issued, 'room-b', 1_030)).toBe(false);
    expect(verifyTicket(secret, issued, 'room-a', 1_061)).toBe(false);
    expect(verifyTicket(secret, `${issued}x`, 'room-a', 1_030)).toBe(false);
    expect(verifyTicket('other-secret', issued, 'room-a', 1_030)).toBe(false);
  });

  test('passwords hash with unique salts and reject malformed hashes', async () => {
    expect(isValidPassword('short')).toBe(false);
    expect(isValidPassword('long-enough')).toBe(true);
    const a = hashPassword('s3cret-pass');
    const b = hashPassword('s3cret-pass');
    expect(a).not.toBe(b);
    expect(verifyPassword('s3cret-pass', a)).toBe(true);
    expect(verifyPassword('wrong-pass', a)).toBe(false);
    expect(verifyPassword('s3cret-pass', 'garbage')).toBe(false);
  });
});
