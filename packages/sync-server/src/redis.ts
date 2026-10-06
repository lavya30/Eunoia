import { Redis } from 'ioredis';
import { BusEnvelopeSchema, CursorTelemetrySchema } from './api/schemas.js';
import type { CursorTelemetry } from './types.js';

export type CursorListener = (cursor: CursorTelemetry) => void;

export type BusKind = 'update' | 'awareness' | 'control';

export interface BusMessage {
  kind: BusKind;
  /** Instance id of the publishing replica (own messages are filtered). */
  from: string;
  data: Uint8Array;
}

export interface BusHooks {
  onPublish?: (kind: BusKind, bytes: number) => void;
  onReceive?: (kind: BusKind, bytes: number) => void;
  onDrop?: (kind: BusKind | 'unknown') => void;
}

/**
 * Transport for cross-instance room fan-out. Implemented by RedisTelemetry
 * (Redis pub/sub) and by an in-memory fake in tests. Cursor telemetry keeps
 * its own channel for backwards compatibility; doc updates, awareness, and
 * control messages share one `bus:{roomId}` channel per room with the kind
 * carried in the envelope.
 */
export interface RoomBus {
  subscribeBus(
    roomId: string,
    listener: (message: BusMessage) => void,
  ): Promise<() => Promise<void>>;
  publishBus(roomId: string, kind: BusKind, data: Uint8Array): Promise<void>;
}

/** Full per-room transport surface a Room needs: cursor channel + bus. */
export interface RoomTelemetry extends RoomBus {
  subscribe(
    roomId: string,
    listener: CursorListener,
  ): Promise<() => Promise<void>>;
  publish(roomId: string, cursor: CursorTelemetry): Promise<void>;
  close(): Promise<void>;
  /**
   * Sender id / hooks honored by RedisTelemetry; plain fakes may ignore
   * them (the bus still works, minus self-filtering and metrics).
   */
  busSenderId?: string;
  busHooks?: BusHooks;
}

function busChannel(roomId: string): string {
  return `bus:${roomId}`;
}

/** Optional Redis transport. Sync remains fully functional when REDIS_URL is unset. */
export class RedisTelemetry implements RoomTelemetry {
  private readonly publisher?: Redis;
  private readonly subscriber?: Redis;
  private readonly listeners = new Map<string, Set<CursorListener>>();
  private readonly busListeners = new Map<
    string,
    Set<(message: BusMessage) => void>
  >();

  constructor(url?: string) {
    if (!url) return;
    this.publisher = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.subscriber = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.subscriber.on('message', (channel, message) => {
      if (channel.startsWith('bus:')) {
        this.handleBusMessage(channel.slice('bus:'.length), message);
        return;
      }
      const roomId = channel.slice('cursor:'.length);
      // Cross-instance data is untrusted: a rogue or outdated producer must
      // not be able to inject malformed cursors into live rooms.
      try {
        const parsed = CursorTelemetrySchema.safeParse(JSON.parse(message));
        if (!parsed.success) return;
        // The originating server stamps clientId before publishing; a
        // payload without one is unattributable and must not fan out.
        // Missing timestamps are filled with receipt time (same rule as
        // the local WebSocket path in WebSocketHandler).
        if (typeof parsed.data.clientId !== 'string') return;
        const cursor: CursorTelemetry = {
          ...parsed.data,
          clientId: parsed.data.clientId,
          timestamp: parsed.data.timestamp ?? Date.now(),
        };
        for (const listener of this.listeners.get(roomId) ?? [])
          listener(cursor);
      } catch {
        // Ignore malformed telemetry from other producers.
      }
    });
  }

  async subscribe(
    roomId: string,
    listener: CursorListener,
  ): Promise<() => Promise<void>> {
    if (!this.subscriber) return async () => undefined;
    const listeners = this.listeners.get(roomId) ?? new Set<CursorListener>();
    listeners.add(listener);
    this.listeners.set(roomId, listeners);
    try {
      await this.subscriber.connect();
    } catch {
      // ioredis may already be connected, or Redis may be temporarily unavailable.
    }
    await this.subscriber.subscribe(`cursor:${roomId}`).catch(() => undefined);
    return async () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(roomId);
        await this.subscriber
          ?.unsubscribe(`cursor:${roomId}`)
          .catch(() => undefined);
      }
    };
  }

  async publish(roomId: string, cursor: CursorTelemetry): Promise<void> {
    if (!this.publisher) return;
    try {
      await this.publisher.connect();
    } catch {
      // ioredis may already be connected, or Redis may be temporarily unavailable.
    }
    await this.publisher
      .publish(`cursor:${roomId}`, JSON.stringify(cursor))
      .catch(() => undefined);
  }

  async subscribeBus(
    roomId: string,
    listener: (message: BusMessage) => void,
  ): Promise<() => Promise<void>> {
    if (!this.subscriber) return async () => undefined;
    const listeners =
      this.busListeners.get(roomId) ?? new Set<(message: BusMessage) => void>();
    listeners.add(listener);
    this.busListeners.set(roomId, listeners);
    try {
      await this.subscriber.connect();
    } catch {
      // ioredis may already be connected, or Redis may be temporarily unavailable.
    }
    await this.subscriber.subscribe(busChannel(roomId)).catch(() => undefined);
    return async () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.busListeners.delete(roomId);
        await this.subscriber
          ?.unsubscribe(busChannel(roomId))
          .catch(() => undefined);
      }
    };
  }

  async publishBus(
    roomId: string,
    kind: BusKind,
    data: Uint8Array,
  ): Promise<void> {
    if (!this.publisher) return;
    // The sender id is stamped by Room (it owns the instance id); the
    // envelope here only carries the payload kind.
    const envelope = JSON.stringify({
      v: 1,
      kind,
      from: this.busSenderId,
      data: Buffer.from(data).toString('base64'),
    });
    try {
      await this.publisher.connect();
    } catch {
      // ioredis may already be connected, or Redis may be temporarily unavailable.
    }
    this.busHooks?.onPublish?.(kind, data.byteLength);
    await this.publisher.publish(busChannel(roomId), envelope).catch(() => {
      this.busHooks?.onDrop?.(kind);
    });
  }

  /**
   * Sender id stamped on every bus envelope so a replica filters its own
   * messages (Redis delivers our publishes back to our subscriber
   * connection). Set once per process by RoomManager.
   */
  busSenderId = '';
  /** Optional observability sink for bus traffic; set by RoomManager. */
  busHooks?: BusHooks;

  private handleBusMessage(roomId: string, message: string): void {
    let envelope: unknown;
    try {
      envelope = JSON.parse(message);
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
    for (const listener of this.busListeners.get(roomId) ?? [])
      listener({ kind, from, data: bytes });
  }

  async close(): Promise<void> {
    await Promise.all([
      this.publisher?.quit().catch(() => undefined),
      this.subscriber?.quit().catch(() => undefined),
    ]);
    this.listeners.clear();
    this.busListeners.clear();
  }
}
