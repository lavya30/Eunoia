import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { Room } from './Room.js';
import {
  loadRoomDoc,
  type RoomMetadata,
  type SnapshotStore,
} from './RoomLoader.js';
import { RedisTelemetry } from './redis.js';
import { SnapshotWorker } from './SnapshotWorker.js';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();
  private readonly idleTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly config: Config,
    private readonly store: SnapshotStore,
    private readonly telemetry = new RedisTelemetry(config.redisUrl),
  ) {}

  async getOrCreate(roomId: string): Promise<Room> {
    const existing = this.rooms.get(roomId);
    if (existing) {
      this.cancelIdle(roomId);
      return existing;
    }
    const loading = this.loading.get(roomId);
    if (loading) return loading;
    const promise = this.loadRoom(roomId);
    this.loading.set(roomId, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(roomId);
    }
  }

  async createRoom(input?: Partial<RoomMetadata>): Promise<RoomMetadata> {
    const metadata: RoomMetadata = {
      id: input?.id ?? randomUUID(),
      name: input?.name ?? 'Untitled room',
      ownerId: input?.ownerId ?? 'anonymous',
      tier: input?.tier ?? 'COMMUNITY',
    };
    await this.store.ensureRoom(metadata);
    return metadata;
  }

  async getRoomMetadata(roomId: string): Promise<RoomMetadata | null> {
    return this.store.getRoom(roomId);
  }

  release(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.size > 0 || this.idleTimers.has(roomId)) return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(roomId);
      void this.remove(roomId);
    }, this.config.roomIdleTimeoutMs);
    this.idleTimers.set(roomId, timer);
  }

  async remove(roomId: string): Promise<void> {
    this.cancelIdle(roomId);
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    await room.dispose();
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    const exists = await this.store.getRoom(roomId);
    if (!exists) return false;
    await this.remove(roomId);
    await this.store.deleteRoom?.(roomId);
    return true;
  }

  async shutdown(): Promise<void> {
    for (const roomId of [...this.rooms.keys()]) await this.remove(roomId);
    await this.telemetry.close();
    await this.store.close?.();
  }

  get activeRoomCount(): number {
    return this.rooms.size;
  }

  private cancelIdle(roomId: string): void {
    const timer = this.idleTimers.get(roomId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(roomId);
  }

  private async loadRoom(roomId: string): Promise<Room> {
    await this.store.ensureRoom({
      id: roomId,
      name: 'Untitled room',
      ownerId: 'anonymous',
      tier: 'COMMUNITY',
    });
    const doc = await loadRoomDoc(roomId, this.store);
    const room = new Room(
      roomId,
      doc,
      new SnapshotWorker(roomId, this.store, this.config.snapshotDebounceMs),
      this.telemetry,
    );
    this.rooms.set(roomId, room);
    return room;
  }
}
