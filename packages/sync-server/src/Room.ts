import { decompressSync } from 'fflate';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';
import * as Yjs from 'yjs';
import type { StoredSnapshot } from './RoomLoader.js';
import type { RedisTelemetry } from './redis.js';
import type { SnapshotWorker } from './SnapshotWorker.js';
import type { CursorTelemetry, RoomClient } from './types.js';
import { WS_MESSAGE_AWARENESS, WS_MESSAGE_SYNC } from './types.js';

/**
 * Close code sent to peers when their room is restored from a snapshot.
 * Clients hold newer state that would otherwise resurrect undone changes,
 * so they must reload and resync from the restored snapshot.
 */
export const RESTORE_CLOSE_CODE = 4100;
export const RESTORE_CLOSE_REASON = 'Snapshot restored; reload to resync';

export class Room {
  awareness: awarenessProtocol.Awareness;
  private _doc: Y.Doc;
  private readonly clients = new Map<string, RoomClient>();
  private readonly unsubscribeRedis: Promise<() => Promise<void>>;

  constructor(
    readonly id: string,
    doc: Y.Doc,
    private readonly snapshotWorker: SnapshotWorker,
    private readonly telemetry?: RedisTelemetry,
  ) {
    this._doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.attach();
    this.unsubscribeRedis = this.telemetry
      ? this.telemetry.subscribe(id, this.handleRedisCursor)
      : Promise.resolve(async () => undefined);
  }

  get doc(): Y.Doc {
    return this._doc;
  }

  private attach(): void {
    this._doc.on('update', this.handleDocUpdate);
    this.awareness.on('update', this.handleAwarenessUpdate);
  }

  private readonly handleDocUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    this.snapshotWorker.schedule(this._doc);
    if (origin && this.isClient(origin))
      this.broadcastSyncUpdate(update, origin as RoomClient);
  };

  private readonly handleAwarenessUpdate = (
    {
      added,
      updated,
      removed,
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const changed = added.concat(updated, removed);
    if (!changed.length || origin === 'redis') return;
    const update = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      changed,
    );
    this.broadcastAwareness(
      update,
      origin instanceof Object ? (origin as RoomClient) : undefined,
    );
  };

  private readonly handleRedisCursor = (cursor: CursorTelemetry): void => {
    this.broadcastCursor(cursor);
  };

  /**
   * Roll the live document back to a historical snapshot. The pre-restore
   * state is flushed first so it stays recoverable from history, then
   * connected peers are dropped — they hold newer updates that CRDT merge
   * would otherwise resurrect. Peers reconnect and resync from scratch.
   */
  async restoreSnapshot(snapshot: StoredSnapshot): Promise<void> {
    await this.snapshotWorker.forceFlush(this._doc);
    const oldDoc = this._doc;
    oldDoc.off('update', this.handleDocUpdate);
    this.awareness.off('update', this.handleAwarenessUpdate);
    this.awareness.destroy();

    const doc = new Yjs.Doc();
    Yjs.applyUpdate(doc, decompressSync(snapshot.data), 'snapshot-restore');
    this._doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.attach();
    oldDoc.destroy();
    this.snapshotWorker.schedule(doc);

    for (const client of this.clients.values())
      client.socket.close(RESTORE_CLOSE_CODE, RESTORE_CLOSE_REASON);
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }

  addClient(client: RoomClient): void {
    this.clients.set(client.id, client);
    client.send(this.createSyncStep1());
    const states = [...this.awareness.getStates().keys()];
    if (states.length)
      client.send(
        this.createAwarenessMessage(
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, states),
        ),
      );
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  handleBinaryMessage(data: Uint8Array, client: RoomClient): void {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === WS_MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, client);
      if (encoding.length(encoder) > 1)
        client.send(encoding.toUint8Array(encoder));
      return;
    }
    if (messageType === WS_MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        client,
      );
    }
  }

  handleCursor(cursor: CursorTelemetry, source: RoomClient): void {
    this.broadcastCursor(cursor, source);
    void this.telemetry?.publish(this.id, cursor);
  }

  async dispose(): Promise<void> {
    (await this.unsubscribeRedis)();
    for (const client of this.clients.values())
      client.socket.close(1001, 'Server shutting down');
    this.clients.clear();
    this.awareness.destroy();
    await this.snapshotWorker.dispose(this.doc);
    this.doc.destroy();
  }

  private isClient(value: unknown): value is RoomClient {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'send' in value
    );
  }

  private createSyncStep1(): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    return encoding.toUint8Array(encoder);
  }

  private createAwarenessMessage(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  private broadcastSyncUpdate(update: Uint8Array, except?: RoomClient): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const client of this.clients.values())
      if (client !== except) client.send(message);
  }

  private broadcastAwareness(update: Uint8Array, except?: RoomClient): void {
    const message = this.createAwarenessMessage(update);
    for (const client of this.clients.values())
      if (client !== except) client.send(message);
  }

  private broadcastCursor(cursor: CursorTelemetry, except?: RoomClient): void {
    const message = JSON.stringify(cursor);
    for (const client of this.clients.values())
      if (client !== except && client.id !== cursor.clientId)
        client.send(message);
  }
}
