import { decompressSync } from 'fflate';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';
import * as Yjs from 'yjs';
import { BusControlSchema } from './api/schemas.js';
import type { StoredSnapshot } from './RoomLoader.js';
import type { BusMessage, RoomTelemetry } from './redis.js';
import type { SnapshotWorker } from './SnapshotWorker.js';
import type { CursorTelemetry, RoomClient } from './types.js';
import {
  REDIS_ORIGIN,
  WS_MESSAGE_AWARENESS,
  WS_MESSAGE_SYNC,
} from './types.js';

/**
 * Close code sent to peers when their room is restored from a snapshot.
 * Clients hold newer state that would otherwise resurrect undone changes,
 * so they must reload and resync from the restored snapshot.
 */
export const RESTORE_CLOSE_CODE = 4100;
export const RESTORE_CLOSE_REASON = 'Snapshot restored; reload to resync';

/** Presence heartbeat: full awareness republish cadence (also the sweep tick). */
export const PRESENCE_HEARTBEAT_MS = 10_000;
/** Remote presence evicted when no refresh arrives within this window. */
export const PRESENCE_STALE_MS = 30_000;
/** Bound on tracked remote presence ids (per room, per process). */
const MAX_TRACKED_REMOTE_IDS = 10_000;

export interface RoomOptions {
  /** Stable per-process id; replicas filter their own bus messages by it. */
  instanceId?: string;
  /**
   * Load-and-restore hook for cluster-wide snapshot restores, provided by
   * RoomManager (the Room has no snapshot store). Called with the snapshot
   * id from a `control/restore` bus message.
   */
  onRestoreRequest?: (snapshotId: string) => Promise<void>;
}

/**
 * Decode the client ids carried by an encoded awareness update. malformed
 * input yields [] — freshness bookkeeping degrades, nothing breaks.
 */
function awarenessClientIds(update: Uint8Array): number[] {
  try {
    const decoder = decoding.createDecoder(update);
    const len = decoding.readVarUint(decoder);
    if (len > MAX_TRACKED_REMOTE_IDS) return [];
    const ids: number[] = [];
    for (let i = 0; i < len; i++) {
      ids.push(decoding.readVarUint(decoder));
      decoding.readVarUint(decoder);
      decoding.readVarString(decoder);
    }
    return ids;
  } catch {
    return [];
  }
}

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
  /** Last receipt time per remotely-seen awareness clientID (sweep input). */
  private readonly remoteSeen = new Map<number, number>();
  private readonly unsubscribeRedis: Promise<() => Promise<void>>;
  private readonly unsubscribeBus: Promise<() => Promise<void>>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly instanceId: string;
  private readonly onRestoreRequest?: (snapshotId: string) => Promise<void>;

  constructor(
    readonly id: string,
    doc: Y.Doc,
    private readonly snapshotWorker: SnapshotWorker,
    private readonly telemetry?: RoomTelemetry,
    options?: RoomOptions,
  ) {
    this._doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.instanceId = options?.instanceId ?? '';
    this.onRestoreRequest = options?.onRestoreRequest;
    this.attach();
    this.unsubscribeRedis = this.telemetry
      ? this.telemetry.subscribe(id, this.handleRedisCursor)
      : Promise.resolve(async () => undefined);
    this.unsubscribeBus = this.telemetry
      ? this.telemetry.subscribeBus(id, this.handleBusMessage)
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
    if (origin === REDIS_ORIGIN) {
      // Applied from a peer replica: fan out to local sockets so they
      // converge, but never republish — that would loop forever.
      this.broadcastSyncUpdate(update);
      return;
    }
    if (origin && this.isClient(origin)) {
      this.broadcastSyncUpdate(update, origin as RoomClient);
      // Fan out to peer replicas (fire-and-forget: the local broadcast
      // above already served this instance's clients).
      if (this.telemetry && this.instanceId) {
        void this.telemetry
          .publishBus(this.id, 'update', update)
          .catch(() => undefined);
      }
    }
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
    if (!changed.length || origin === REDIS_ORIGIN) return;
    if (origin !== 'server-disconnect' && !this.isLiveClient(origin)) return;
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
    // Fan out to peer replicas. Disconnect removals ("server-disconnect")
    // are published by their own paths (removeClient) or converge via
    // independent sweep timeouts — never here, to avoid double removal.
    if (this.telemetry && this.instanceId && this.isClient(origin)) {
      void this.telemetry
        .publishBus(this.id, 'awareness', update)
        .catch(() => undefined);
    }
  };

  private readonly handleRedisCursor = (cursor: CursorTelemetry): void => {
    this.broadcastCursor(cursor);
  };

  private readonly handleBusMessage = (message: BusMessage): void => {
    // Own messages are filtered by the transport; defense in depth here.
    if (message.from === this.instanceId) return;
    if (message.kind === 'update') {
      this.applyRemoteUpdate(message.data);
      return;
    }
    if (message.kind === 'awareness') {
      this.applyRemoteAwareness(message.data);
      return;
    }
    let control: unknown;
    try {
      control = JSON.parse(Buffer.from(message.data).toString('utf8'));
    } catch {
      return;
    }
    const parsed = BusControlSchema.safeParse(control);
    if (!parsed.success || parsed.data.type !== 'restore') return;
    void this.onRestoreRequest?.(parsed.data.snapshotId)?.catch(
      () => undefined,
    );
  };

  private applyRemoteUpdate(update: Uint8Array): void {
    if (update.byteLength === 0) return;
    try {
      // Origin REDIS_ORIGIN fans out to local sockets via handleDocUpdate
      // without republishing (see the loop guard there).
      Yjs.applyUpdate(this._doc, update, REDIS_ORIGIN);
    } catch {
      // Corrupt remote update: drop it. Snapshots and live clients remain
      // the source of truth; the next handshake heals the gap.
    }
  }

  private applyRemoteAwareness(update: Uint8Array): void {
    if (update.byteLength === 0) return;
    try {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        update,
        REDIS_ORIGIN,
      );
    } catch {
      return;
    }
    // Merging fires handleAwarenessUpdate with origin REDIS_ORIGIN, which
    // deliberately does nothing — fan the raw payload out explicitly.
    const now = Date.now();
    for (const id of awarenessClientIds(update)) {
      this.remoteSeen.set(id, now);
      if (this.remoteSeen.size > MAX_TRACKED_REMOTE_IDS) {
        const oldest = this.remoteSeen.keys().next();
        if (!oldest.done) this.remoteSeen.delete(oldest.value);
      }
    }
    this.broadcastAwareness(update);
  }

  /**
   * Drop remote presence that stopped refreshing. Only ids with no local
   * owner are eligible — locally-owned ids are authoritative regardless of
   * refresh traffic. Peer replicas sweep independently on the same rule, so
   * no removal broadcast is needed for convergence.
   */
  private sweepStalePresence(): void {
    const owned = new Set<number>();
    for (const ids of this.awarenessOwners.values())
      for (const id of ids) owned.add(id);
    const now = Date.now();
    const stale: number[] = [];
    for (const [id, seen] of this.remoteSeen) {
      if (!owned.has(id) && now - seen > PRESENCE_STALE_MS) {
        stale.push(id);
        this.remoteSeen.delete(id);
      }
    }
    if (stale.length > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        stale,
        'server-disconnect',
      );
    }
  }

  private heartbeatTick = (): void => {
    const states = [...this.awareness.getStates().keys()];
    if (states.length > 0 && this.telemetry && this.instanceId) {
      void this.telemetry
        .publishBus(
          this.id,
          'awareness',
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, states),
        )
        .catch(() => undefined);
    }
    this.sweepStalePresence();
  };

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) return;
    // Heartbeats only matter while someone is here to observe presence;
    // the timer stops with the last client (see removeClient/dispose).
    if (this.clients.size === 0) return;
    this.heartbeatTimer = setInterval(
      this.heartbeatTick,
      PRESENCE_HEARTBEAT_MS,
    );
  }

  private maybeStopHeartbeat(): void {
    if (this.clients.size === 0 && this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

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
      Yjs.applyUpdate(doc, decompressSync(snapshot.data), 'snapshot-restore');
    } catch {
      doc.destroy();
      throw new Error('Snapshot data is corrupt and cannot be restored');
    }
    await this.snapshotWorker.forceFlush(this._doc);
    const oldDoc = this._doc;
    oldDoc.off('update', this.handleDocUpdate);
    this.awareness.off('update', this.handleAwarenessUpdate);
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
    // Promptly clear ghosts for the newcomer, then keep the heartbeat
    // running while the room is occupied.
    this.sweepStalePresence();
    this.ensureHeartbeat();
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
    this.maybeStopHeartbeat();
    const owned = this.awarenessOwners.get(clientId);
    if (owned && owned.size > 0) {
      const ids = [...owned];
      this.awarenessOwners.delete(clientId);
      // Fires handleAwarenessUpdate, which broadcasts the removal so peers
      // stop rendering this client's cursor/avatar.
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        ids,
        'server-disconnect',
      );
      // Peer replicas can't observe this disconnect: publish the removal
      // explicitly (meta clocks are retained by removeAwarenessStates, so
      // the removed ids still encode with state null). Replica crashes are
      // covered by the sweep backstop instead.
      if (this.telemetry && this.instanceId) {
        void this.telemetry
          .publishBus(
            this.id,
            'awareness',
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids),
          )
          .catch(() => undefined);
      }
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
    const publish = this.telemetry?.publish(this.id, cursor);
    if (publish) void publish.catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    (await this.unsubscribeRedis)();
    (await this.unsubscribeBus)();
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
