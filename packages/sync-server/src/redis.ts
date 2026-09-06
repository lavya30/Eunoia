import { Redis } from 'ioredis';
import type { CursorTelemetry } from './types.js';

type CursorListener = (cursor: CursorTelemetry) => void;

/** Optional Redis transport. Sync remains fully functional when REDIS_URL is unset. */
export class RedisTelemetry {
  private readonly publisher?: Redis;
  private readonly subscriber?: Redis;
  private readonly listeners = new Map<string, Set<CursorListener>>();

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
      const roomId = channel.slice('cursor:'.length);
      try {
        const cursor = JSON.parse(message) as CursorTelemetry;
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

  async close(): Promise<void> {
    await Promise.all([
      this.publisher?.quit().catch(() => undefined),
      this.subscriber?.quit().catch(() => undefined),
    ]);
    this.listeners.clear();
  }
}
