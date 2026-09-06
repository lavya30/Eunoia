import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
});
