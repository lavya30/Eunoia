import { decompressSync } from "fflate";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";
import * as Yjs from "yjs";
import type { StoredSnapshot } from "./RoomLoader.js";
import type { RedisTelemetry } from "./redis.js";
import type { SnapshotWorker } from "./SnapshotWorker.js";
import type { CursorTelemetry, RoomClient } from "./types.js";
import { WS_MESSAGE_AWARENESS, WS_MESSAGE_SYNC } from "./types.js";

/**
 * Close code sent to peers when their room is restored from a snapshot.
 * Clients hold newer state that would otherwise resurrect undone changes,
 * so they must reload and resync from the restored snapshot.
 */
export const RESTORE_CLOSE_CODE = 4100;
export const RESTORE_CLOSE_REASON = "Snapshot restored; reload to resync";

export class Room {
  awareness: awarenessProtocol.Awareness;
  private _doc: Y.Doc;
  private readonly clients = new Map<string, RoomClient>();
  /**
   * Increments on every snapshot restore. Messages from sockets that were
   * dropped by a restore carry the old generation and are ignored, so
   * pre-restore writes can't leak back into the restored doc.
   */
  private generation = 0;
  private readonly clientGenerations = new Map<string, number>();
  /** Awareness clientIDs last announced by each socket. Lets disconnects
   *  prune presence instead of leaving ghosts behind. */
  private readonly awarenessOwners = new Map<string, Set<number>>();
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
    this._doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  private readonly handleDocUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    this.snapshotWorker.schedule(this._doc);
    if (origin && this.isClient(origin))
      this.broadcastSyncUpdate(update, origin as RoomClient);
  };

  /**
   * True when the client belongs to the current doc generation. Messages
   * from sockets dropped by a restore (or from unknown senders) are ignored.
   */
  private isLiveClient(value: unknown): value is RoomClient {
    return (
      this.isClient(value) &&
      this.clientGenerations.get(value.id) === this.generation
    );
  }

  private readonly handleAwarenessUpdate = (
    {
      added,
      updated,
      removed,
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const changed = added.concat(updated, removed);
    if (!changed.length || origin === "redis") return;
    if (origin !== "server-disconnect" && !this.isLiveClient(origin)) return;
    if (this.isClient(origin)) {
      let owned = this.awarenessOwners.get(origin.id);
      if (!owned) {
        owned = new Set<number>();
        this.awarenessOwners.set(origin.id, owned);
      }
      for (const clientId of added.concat(updated)) owned.add(clientId);
      for (const clientId of removed) owned.delete(clientId);
      if (owned.size === 0) this.awarenessOwners.delete(origin.id);
    }
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
   * Roll the live document back to one of its snapshots. The snapshot is
   * validated into a fresh doc BEFORE live state is touched, so corrupt
   * data throws without bricking the room. The pre-restore state is flushed
   * first so it stays recoverable from history, then connected peers are
   * dropped — they hold newer updates that CRDT merge would otherwise
   * resurrect. Peers reconnect and resync from scratch.
   */
  async restoreSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const doc = new Yjs.Doc();
    try {
      Yjs.applyUpdate(doc, decompressSync(snapshot.data), "snapshot-restore");
    } catch {
      doc.destroy();
      throw new Error("Snapshot data is corrupt and cannot be restored");
    }
    await this.snapshotWorker.forceFlush(this._doc);
    const oldDoc = this._doc;
    oldDoc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.destroy();
    this._doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.attach();
    oldDoc.destroy();
    this.awarenessOwners.clear();
    this.snapshotWorker.reset();
    // Bump the generation before dropping sockets: any straggler message
    // from a cleared client is ignored from here on.
    this.generation += 1;
    this.clientGenerations.clear();
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
    this.clientGenerations.set(client.id, this.generation);
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
    this.clientGenerations.delete(clientId);
    const owned = this.awarenessOwners.get(clientId);
    if (owned && owned.size > 0) {
      this.awarenessOwners.delete(clientId);
      // Fires handleAwarenessUpdate, which broadcasts the removal so peers
      // stop rendering this client's cursor/avatar.
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [...owned],
        "server-disconnect",
      );
    }
  }

  handleBinaryMessage(data: Uint8Array, client: RoomClient): void {
    if (!this.isLiveClient(client)) return;
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
    if (!this.isLiveClient(source)) return;
    this.broadcastCursor(cursor, source);
    void this.telemetry?.publish(this.id, cursor);
  }

  async dispose(): Promise<void> {
    (await this.unsubscribeRedis)();
    for (const client of this.clients.values())
      client.socket.close(1001, "Server shutting down");
    this.clients.clear();
    this.awareness.destroy();
    await this.snapshotWorker.dispose(this.doc);
    this.doc.destroy();
  }

  private isClient(value: unknown): value is RoomClient {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "send" in value
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
