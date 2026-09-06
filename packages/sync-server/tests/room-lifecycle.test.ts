import { describe, expect, test } from 'bun:test';
import { createSyncServer } from '../src/index.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';

describe('room lifecycle', () => {
  test('unloads an idle room after its final client disconnects', async () => {
    const store = new MemorySnapshotStore();
    const app = createSyncServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        snapshotDebounceMs: 1,
        roomIdleTimeoutMs: 5,
        d2CommunityNodeLimit: 30,
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
      },
      store,
    );
    const room = await app.manager.getOrCreate('lifecycle-room');
    expect(room.id).toBe('lifecycle-room');
    expect(app.manager.activeRoomCount).toBe(1);
    app.manager.release('lifecycle-room');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.manager.activeRoomCount).toBe(0);
    await app.close();
  });
});
