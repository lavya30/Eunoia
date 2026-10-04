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
import { RedisTelemetry, type RoomTelemetry } from "./redis.js";
import { hashPassword, verifyPassword } from "./room-auth.js";
import type { SnapshotFlushReport } from "./SnapshotWorker.js";
import { SnapshotWorker } from "./SnapshotWorker.js";

export interface BusEvent {
  direction: "published" | "received" | "dropped";
  kind: "update" | "awareness" | "control" | "unknown";
  bytes: number;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();
  private readonly disposePromises = new Map<string, Promise<void>>();
  private closing = false;
  private readonly idleTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Stable per-process id: replicas filter their own bus messages by it. */
  readonly instanceId = randomUUID();

  constructor(
    private readonly config: Config,
    private readonly store: SnapshotStore,
    private readonly telemetry: RoomTelemetry = new RedisTelemetry(
      config.redisUrl,
    ),
    private readonly onSnapshotFlush?: (report: SnapshotFlushReport) => void,
    private readonly onBusEvent?: (event: BusEvent) => void,
  ) {
    this.telemetry.busSenderId = this.instanceId;
    this.telemetry.busHooks = {
      onPublish: (kind, bytes) =>
        this.onBusEvent?.({ direction: "published", kind, bytes }),
      onReceive: (kind, bytes) =>
        this.onBusEvent?.({ direction: "received", kind, bytes }),
      onDrop: (kind) =>
        this.onBusEvent?.({ direction: "dropped", kind, bytes: 0 }),
    };
  }

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
      workspaceId: input?.workspaceId ?? null,
      folderId: input?.folderId ?? null,
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
    updates: {
      name?: string;
      ownerId?: string;
      tier?: RoomMetadata["tier"];
      workspaceId?: string | null;
      folderId?: string | null;
    },
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

  async listRooms(filter?: {
    workspaceId?: string | null;
    ownerId?: string;
  }): Promise<RoomMetadata[]> {
    return this.store.listRooms(filter);
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
   * The restore is fanned out on the room bus so every replica swaps to the
   * same snapshot and drops its peers — otherwise other instances would
   * keep serving (and snapshotting) the pre-restore fork.
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
    const control = Buffer.from(
      JSON.stringify({ type: "restore", snapshotId }),
      "utf8",
    );
    await this.telemetry.publishBus(roomId, "control", control).catch(() => {
      // The local restore already happened; a missed broadcast only delays
      // convergence until the next flush or reconnect (accepted degradation,
      // same as cursor telemetry).
    });
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
      workspaceId: null,
      folderId: null,
      hasPassword: false,
    });
    const doc = await loadRoomDoc(roomId, this.store);
    const room = new Room(
      roomId,
      doc,
      new SnapshotWorker(
        roomId,
        this.store,
        this.config.snapshotDebounceMs,
        this.onSnapshotFlush,
      ),
      this.telemetry,
      {
        instanceId: this.instanceId,
        // Cluster-wide restores arrive on the bus: re-read the snapshot
        // from the shared store and run the same swap-and-drop procedure.
        // Same-bytes double restores (racing HTTP + bus) are idempotent.
        onRestoreRequest: async (snapshotId: string) => {
          const snapshot = await this.store.getSnapshot(snapshotId);
          if (!snapshot || snapshot.roomId !== roomId) return;
          const live = this.rooms.get(roomId);
          if (live) await live.restoreSnapshot(snapshot);
        },
      },
    );
    this.rooms.set(roomId, room);
    return room;
  }
}
