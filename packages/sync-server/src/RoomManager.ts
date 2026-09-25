import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { Room } from "./Room.js";
import {
  loadRoomDoc,
  type RoomMetadata,
  type SnapshotListOptions,
  type SnapshotStore,
  type StoredSnapshot,
} from "./RoomLoader.js";
import { RedisTelemetry } from "./redis.js";
import { hashPassword, verifyPassword } from "./room-auth.js";
import { SnapshotWorker } from "./SnapshotWorker.js";

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();
  private readonly disposePromises = new Map<string, Promise<void>>();
  private closing = false;
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
    if (this.closing) throw new Error("Server is shutting down");
    const existing = this.rooms.get(roomId);
    if (existing) {
      this.cancelIdle(roomId);
      return existing;
    }
    // A dispose may be flushing this room's final snapshot; wait for it so
    // we don't fork a second live Room with a stale doc.
    const disposing = this.disposePromises.get(roomId);
    if (disposing) await disposing;
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

  async createRoom(
    input?: Partial<RoomMetadata>,
    password?: string,
  ): Promise<RoomMetadata> {
    const passwordHash = password ? hashPassword(password) : undefined;
    const metadata: RoomMetadata = {
      id: input?.id ?? randomUUID(),
      name: input?.name ?? "Untitled room",
      ownerId: input?.ownerId ?? "anonymous",
      tier: input?.tier ?? "COMMUNITY",
      hasPassword: passwordHash !== undefined,
    };
    await this.store.ensureRoom(metadata, passwordHash);
    return metadata;
  }

  async getRoomMetadata(roomId: string): Promise<RoomMetadata | null> {
    return this.store.getRoom(roomId);
  }

  /**
   * Partial room update (name / owner / tier / password). `password`
   * replaces the hash when a string, clears it when null, and leaves it
   * untouched when undefined. Returns null when the room does not exist.
   */
  async updateRoom(
    roomId: string,
    updates: { name?: string; ownerId?: string; tier?: RoomMetadata["tier"] },
    password?: string | null,
  ): Promise<RoomMetadata | null> {
    return this.store.updateRoom(roomId, {
      ...updates,
      ...(password === undefined
        ? {}
        : { passwordHash: password === null ? null : hashPassword(password) }),
    });
  }

  /** True for open rooms; compares the scrypt hash for locked rooms. */
  async verifyRoomPassword(roomId: string, password: string): Promise<boolean> {
    const hash = await this.store.getPasswordHash(roomId);
    if (!hash) return false;
    return verifyPassword(password, hash);
  }

  async getPasswordVersion(roomId: string): Promise<number | null> {
    return this.store.getPasswordVersion(roomId);
  }

  async listRoomSnapshots(
    roomId: string,
    options?: SnapshotListOptions,
  ): Promise<StoredSnapshot[]> {
    return this.store.listSnapshots(roomId, options);
  }

  /**
   * Roll a room back to one of its snapshots. Returns false when the room
   * or snapshot does not exist (or the snapshot belongs to another room).
   */
  async restoreRoomSnapshot(
    roomId: string,
    snapshotId: string,
  ): Promise<boolean> {
    const metadata = await this.store.getRoom(roomId);
    if (!metadata) return false;
    const snapshot = await this.store.getSnapshot(snapshotId);
    if (!snapshot || snapshot.roomId !== roomId) return false;
    const room = await this.getOrCreate(roomId);
    await room.restoreSnapshot(snapshot);
    return true;
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
    const disposing = room.dispose();
    this.disposePromises.set(roomId, disposing);
    try {
      await disposing;
    } finally {
      if (this.disposePromises.get(roomId) === disposing)
        this.disposePromises.delete(roomId);
    }
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    const exists = await this.store.getRoom(roomId);
    if (!exists) return false;
    await this.remove(roomId);
    await this.store.deleteRoom?.(roomId);
    return true;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
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
      name: "Untitled room",
      ownerId: "anonymous",
      tier: "COMMUNITY",
      hasPassword: false,
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
