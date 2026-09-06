import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { createSyncServer, type SyncServer } from '../src/index.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';

describe('WebSocket Yjs sync', () => {
  let app: SyncServer;
  let address: string;

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
    const serverAddress = app.server.address();
    if (!serverAddress || typeof serverAddress === 'string')
      throw new Error('Server did not bind');
    address = `ws://127.0.0.1:${serverAddress.port}/sync/echo-room`;
  });

  afterEach(async () => {
    await app.close();
  });

  test('relays a Yjs mutation from client A to client B', async () => {
    const [clientA, clientB] = await Promise.all([
      open(address),
      open(address),
    ]);
    const received = new Promise<Uint8Array>((resolve) => {
      clientB.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const bytes = new Uint8Array(data as Buffer);
        const decoder = decoding.createDecoder(bytes);
        if (
          decoding.readVarUint(decoder) === 0 &&
          decoding.readVarUint(decoder) === 2
        )
          resolve(bytes);
      });
    });
    const docA = new Y.Doc();
    docA.getMap('canvas').set('title', 'Synced');
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(docA));
    clientA.send(encoding.toUint8Array(encoder));

    const message = await Promise.race([
      received,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sync timeout')), 1000),
      ),
    ]);
    const decoder = decoding.createDecoder(message);
    expect(decoding.readVarUint(decoder)).toBe(0);
    const docB = new Y.Doc();
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, reply, docB, 'test');
    expect(docB.getMap('canvas').get('title')).toBe('Synced');
    clientA.close();
    clientB.close();
  });
});

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}
