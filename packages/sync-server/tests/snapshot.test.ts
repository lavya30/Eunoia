import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { loadRoomDoc, MemorySnapshotStore } from '../src/RoomLoader.js';
import { SnapshotWorker } from '../src/SnapshotWorker.js';

describe('snapshot persistence', () => {
  test('round-trips a compressed Y.Doc snapshot through the store', async () => {
    const store = new MemorySnapshotStore();
    const doc = new Y.Doc();
    doc.getMap('canvas').set('element', { type: 'rectangle', x: 20, y: 30 });
    const worker = new SnapshotWorker('snapshot-room', store, 0);
    worker.schedule(doc);
    await worker.flush(doc);

    const restored = await loadRoomDoc('snapshot-room', store);
    expect(restored.getMap('canvas').get('element')).toEqual({
      type: 'rectangle',
      x: 20,
      y: 30,
    });
    expect(store.snapshots.get('snapshot-room')?.data.length).toBeGreaterThan(
      0,
    );
  });
});
