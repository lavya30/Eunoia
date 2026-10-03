import { describe, expect, test } from 'bun:test';
import { compressSync } from 'fflate';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { BusEnvelopeSchema } from '../src/api/schemas.js';
import { loadConfig } from '../src/config.js';
import { RESTORE_CLOSE_CODE } from '../src/Room.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';
import { RoomManager } from '../src/RoomManager.js';
import type {
  BusHooks,
  BusKind,
  BusMessage,
  RoomTelemetry,
} from '../src/redis.js';
import type { RoomClient } from '../src/types.js';
import { WS_MESSAGE_AWARENESS } from '../src/types.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

/** In-memory stand-in for Redis pub/sub shared by two replica managers. */
class FakeHub {
  private readonly subs = new Map<string, Set<(raw: string) => void>>();

  subscribe(channel: string, fn: (raw: string) => void): () => void {
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set();
      this.subs.set(channel, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.subs.delete(channel);
    };
  }

  publish(channel: string, raw: string): void {
    for (const fn of [...(this.subs.get(channel) ?? [])]) fn(raw);
  }
}

/**
 * Fake transport mirroring RedisTelemetry's envelope contract (validation +
 * self-filter), so the tests exercise the real Room dispatch paths.
 */
class FakeTelemetry implements RoomTelemetry {
  busSenderId = '';
  busHooks?: BusHooks;
  updatePublishes = 0;

  constructor(private readonly hub: FakeHub) {}

  async subscribe(): Promise<() => Promise<void>> {
    return async () => undefined;
  }

  async publish(): Promise<void> {}

  async close(): Promise<void> {}

  async subscribeBus(
    roomId: string,
    listener: (message: BusMessage) => void,
  ): Promise<() => Promise<void>> {
    const fn = (raw: string) => {
      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch {
        this.busHooks?.onDrop?.('unknown');
        return;
      }
      const result = BusEnvelopeSchema.safeParse(envelope);
      if (!result.success) {
        this.busHooks?.onDrop?.('unknown');
        return;
      }
      const { kind, from, data } = result.data;
      if (from === this.busSenderId) return;
      let bytes: Uint8Array;
      try {
        bytes = Buffer.from(data, 'base64');
      } catch {
        this.busHooks?.onDrop?.(kind);
        return;
      }
      this.busHooks?.onReceive?.(kind, bytes.byteLength);
      listener({ kind, from, data: bytes });
    };
    const unsub = this.hub.subscribe(`bus:${roomId}`, fn);
    return async () => {
      unsub();
    };
  }

  async publishBus(
    roomId: string,
    kind: BusKind,
    data: Uint8Array,
  ): Promise<void> {
    if (kind === 'update') this.updatePublishes += 1;
    this.busHooks?.onPublish?.(kind, data.byteLength);
    this.hub.publish(
      `bus:${roomId}`,
      JSON.stringify({
        v: 1,
        kind,
        from: this.busSenderId,
        data: Buffer.from(data).toString('base64'),
      }),
    );
  }
}

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    SNAPSHOT_DEBOUNCE_MS: '1',
    ROOM_IDLE_TIMEOUT_MS: '50',
  });
}

function fakeClient(id: string) {
  const sent: Array<Uint8Array | string> = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const socket = {
    close: (code: number, reason: string) => {
      closed.push({ code, reason });
    },
  };
  const client: RoomClient = {
    id,
    socket: socket as unknown as RoomClient['socket'],
    send: (data) => {
      sent.push(data);
    },
  };
  return { client, sent, closed };
}

describe('room bus (multi-instance)', () => {
  test('propagates doc updates across replicas without republish loops', async () => {
    const hub = new FakeHub();
    const store = new MemorySnapshotStore();
    const fakeA = new FakeTelemetry(hub);
    const fakeB = new FakeTelemetry(hub);
    const managerA = new RoomManager(testConfig(), store, fakeA);
    const managerB = new RoomManager(testConfig(), store, fakeB);
    const roomA = await managerA.getOrCreate('bus-room');
    const roomB = await managerB.getOrCreate('bus-room');
    const a = fakeClient('a1');
    roomA.addClient(a.client);

    const edit = new Y.Doc();
    edit.getMap('board').set('title', 'from-a');
    Y.applyUpdate(roomA.doc, Y.encodeStateAsUpdate(edit), a.client);
    await tick();

    expect(roomB.doc.getMap('board').get('title')).toBe('from-a');
    // B fanned out locally but never republished: exactly one bus update.
    expect(fakeA.updatePublishes).toBe(1);
    expect(fakeB.updatePublishes).toBe(0);

    // And the reverse direction also converges exactly once.
    const b = fakeClient('b1');
    roomB.addClient(b.client);
    const edit2 = new Y.Doc();
    edit2.getMap('board').set('subtitle', 'from-b');
    Y.applyUpdate(roomB.doc, Y.encodeStateAsUpdate(edit2), b.client);
    await tick();

    expect(roomA.doc.getMap('board').get('subtitle')).toBe('from-b');
    expect(fakeB.updatePublishes).toBe(1);
    expect(fakeA.updatePublishes).toBe(1);

    roomA.removeClient('a1');
    roomB.removeClient('b1');
    await managerA.shutdown();
    await managerB.shutdown();
  });

  test('fans awareness across replicas and prunes on disconnect', async () => {
    const hub = new FakeHub();
    const store = new MemorySnapshotStore();
    const managerA = new RoomManager(
      testConfig(),
      store,
      new FakeTelemetry(hub),
    );
    const managerB = new RoomManager(
      testConfig(),
      store,
      new FakeTelemetry(hub),
    );
    const roomA = await managerA.getOrCreate('presence-room');
    const roomB = await managerB.getOrCreate('presence-room');
    const a = fakeClient('a1');
    roomA.addClient(a.client);
    roomB.addClient(fakeClient('b1').client);

    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    aw.setLocalState({ cursor: { x: 10, y: 20 } });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(aw, [aw.clientID]),
    );
    roomA.handleBinaryMessage(encoding.toUint8Array(encoder), a.client);
    await tick();

    expect([...roomB.awareness.getStates().keys()]).toContain(aw.clientID);

    roomA.removeClient('a1');
    await tick();

    expect(roomB.awareness.getStates().has(aw.clientID)).toBe(false);

    roomB.removeClient('b1');
    await managerA.shutdown();
    await managerB.shutdown();
  });

  test('coordinated restore drops peers on every replica', async () => {
    const hub = new FakeHub();
    const store = new MemorySnapshotStore();
    const managerA = new RoomManager(
      testConfig(),
      store,
      new FakeTelemetry(hub),
    );
    const managerB = new RoomManager(
      testConfig(),
      store,
      new FakeTelemetry(hub),
    );
    const roomA = await managerA.getOrCreate('restore-room');
    const roomB = await managerB.getOrCreate('restore-room');
    const a = fakeClient('a1');
    const b = fakeClient('b1');
    roomA.addClient(a.client);
    roomB.addClient(b.client);

    const snapDoc = new Y.Doc();
    snapDoc.getMap('board').set('restored', true);
    await store.saveSnapshot({
      id: 'snap-1',
      roomId: 'restore-room',
      docVersion: '1',
      data: compressSync(Y.encodeStateAsUpdate(snapDoc)),
      createdAt: new Date(),
    });

    expect(await managerA.restoreRoomSnapshot('restore-room', 'snap-1')).toBe(
      true,
    );
    await tick();

    expect(a.closed.map((c) => c.code)).toContain(RESTORE_CLOSE_CODE);
    expect(b.closed.map((c) => c.code)).toContain(RESTORE_CLOSE_CODE);
    expect(roomB.doc.getMap('board').get('restored')).toBe(true);

    await managerA.shutdown();
    await managerB.shutdown();
  });
});
