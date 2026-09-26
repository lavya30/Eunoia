import type { PrismaClient } from "@prisma/client";
import { decompressSync } from "fflate";
import * as Y from "yjs";

export type StoredSnapshot = {
  id: string;
  roomId: string;
  docVersion: string;
  data: Uint8Array;
  createdAt: Date;
};

export type SnapshotListOptions = {
  limit?: number;
  /** Only snapshots created strictly before this date. */
  before?: Date;
};

export type SnapshotRetention = {
  /** Always keep at least this many newest snapshots per room. */
  maxPerRoom: number;
  /** Always keep snapshots newer than this many days. */
  retentionDays: number;
};

export const DEFAULT_RETENTION: SnapshotRetention = {
  maxPerRoom: 100,
  retentionDays: 30,
};

/**
 * Shared retention policy: keep the newest snapshot, the newest
 * `maxPerRoom`, and everything inside the retention window.
 */
export function applyRetention(
  snapshots: StoredSnapshot[],
  now: number,
  retention: SnapshotRetention,
): StoredSnapshot[] {
  if (!snapshots.length) return snapshots;
  const cutoff = now - retention.retentionDays * 86_400_000;
  const newestFirst = [...snapshots].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const newest = newestFirst[0];
  const keep = new Set<string>([newest.id]);
  for (const snapshot of newestFirst.slice(0, retention.maxPerRoom))
    keep.add(snapshot.id);
  for (const snapshot of newestFirst)
    if (snapshot.createdAt.getTime() >= cutoff) keep.add(snapshot.id);
  return snapshots.filter((snapshot) => keep.has(snapshot.id));
}

export type RoomMetadata = {
  id: string;
  name: string;
  ownerId: string;
  tier: "COMMUNITY" | "PRO" | "ENTERPRISE";
  hasPassword: boolean;
};

export interface SnapshotStore {
  getLatestSnapshot(roomId: string): Promise<StoredSnapshot | null>;
  getSnapshot(id: string): Promise<StoredSnapshot | null>;
  listSnapshots(
    roomId: string,
    options?: SnapshotListOptions,
  ): Promise<StoredSnapshot[]>;
  saveSnapshot(snapshot: StoredSnapshot): Promise<void>;
  ensureRoom(metadata: RoomMetadata, passwordHash?: string): Promise<void>;
  updateRoom(roomId: string, updates: RoomUpdate): Promise<RoomMetadata | null>;
  getRoom(roomId: string): Promise<RoomMetadata | null>;
  getPasswordHash(roomId: string): Promise<string | null>;
  /** Password rotation counter; null when the room does not exist. */
  getPasswordVersion(roomId: string): Promise<number | null>;
  deleteRoom?(roomId: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Partial room update. `passwordHash` replaces the stored hash when a
 * string, clears the password when null, and leaves it untouched when
 * undefined (so re-updates never clobber a password by accident).
 */
export type RoomUpdate = {
  name?: string;
  ownerId?: string;
  tier?: RoomMetadata["tier"];
  passwordHash?: string | null;
};

export class MemorySnapshotStore implements SnapshotStore {
  readonly rooms = new Map<string, RoomMetadata>();
  private readonly passwordHashes = new Map<string, string>();
  private readonly passwordVersions = new Map<string, number>();
  private readonly history = new Map<string, StoredSnapshot[]>();

  constructor(
    private readonly retention: SnapshotRetention = DEFAULT_RETENTION,
  ) {}

  /** Latest snapshot per room (kept for backwards-compatible access). */
  get snapshots(): Map<string, StoredSnapshot> {
    const latest = new Map<string, StoredSnapshot>();
    for (const [roomId, snapshots] of this.history)
      if (snapshots.length) latest.set(roomId, snapshots[snapshots.length - 1]);
    return latest;
  }

  async getLatestSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    const snapshots = this.history.get(roomId) ?? [];
    return snapshots.length ? snapshots[snapshots.length - 1] : null;
  }

  async getSnapshot(id: string): Promise<StoredSnapshot | null> {
    for (const snapshots of this.history.values()) {
      const found = snapshots.find((snapshot) => snapshot.id === id);
      if (found) return found;
    }
    return null;
  }

  async listSnapshots(
    roomId: string,
    options: SnapshotListOptions = {},
  ): Promise<StoredSnapshot[]> {
    let snapshots = [...(this.history.get(roomId) ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const { before, limit } = options;
    if (before) snapshots = snapshots.filter((s) => s.createdAt < before);
    if (limit !== undefined) snapshots = snapshots.slice(0, limit);
    return snapshots;
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const snapshots = this.history.get(snapshot.roomId) ?? [];
    snapshots.push({ ...snapshot, data: new Uint8Array(snapshot.data) });
    this.history.set(
      snapshot.roomId,
      applyRetention(snapshots, Date.now(), this.retention),
    );
  }

  async ensureRoom(
    metadata: RoomMetadata,
    passwordHash?: string,
  ): Promise<void> {
    if (!this.rooms.has(metadata.id)) {
      this.rooms.set(metadata.id, metadata);
      if (passwordHash) this.passwordHashes.set(metadata.id, passwordHash);
    }
  }

  async getRoom(roomId: string): Promise<RoomMetadata | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async updateRoom(
    roomId: string,
    updates: RoomUpdate,
  ): Promise<RoomMetadata | null> {
    const existing = this.rooms.get(roomId);
    if (!existing) return null;
    const next: RoomMetadata = {
      ...existing,
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.ownerId !== undefined ? { ownerId: updates.ownerId } : {}),
      ...(updates.tier !== undefined ? { tier: updates.tier } : {}),
      hasPassword:
        updates.passwordHash === undefined
          ? existing.hasPassword
          : updates.passwordHash !== null,
    };
    this.rooms.set(roomId, next);
    if (updates.passwordHash !== undefined) {
      if (updates.passwordHash === null) {
        this.passwordHashes.delete(roomId);
      } else this.passwordHashes.set(roomId, updates.passwordHash);
      // Every rotation (set or clear) invalidates previously minted tickets.
      this.passwordVersions.set(
        roomId,
        (this.passwordVersions.get(roomId) ?? 0) + 1,
      );
    }
    return next;
  }
  async getPasswordHash(roomId: string): Promise<string | null> {
    return this.passwordHashes.get(roomId) ?? null;
  }

  async getPasswordVersion(roomId: string): Promise<number | null> {
    if (!this.rooms.has(roomId)) return null;
    return this.passwordVersions.get(roomId) ?? 0;
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
    this.history.delete(roomId);
    // Auth state must die with the room: otherwise a recreated room with
    // the same id inherits the old lock and version, and stale tickets
    // minted before deletion could replay against it.
    this.passwordHashes.delete(roomId);
    this.passwordVersions.delete(roomId);
  }
}

export class PrismaSnapshotStore implements SnapshotStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly retention: SnapshotRetention = DEFAULT_RETENTION,
  ) {}

  async getLatestSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { roomId },
      orderBy: { createdAt: "desc" },
    });
    return snapshot ? toStoredSnapshot(snapshot) : null;
  }

  async getSnapshot(id: string): Promise<StoredSnapshot | null> {
    const snapshot = await this.prisma.snapshot.findUnique({ where: { id } });
    return snapshot ? toStoredSnapshot(snapshot) : null;
  }

  async listSnapshots(
    roomId: string,
    options: SnapshotListOptions = {},
  ): Promise<StoredSnapshot[]> {
    const snapshots = await this.prisma.snapshot.findMany({
      where: {
        roomId,
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      ...(options.limit !== undefined ? { take: options.limit } : {}),
    });
    return snapshots.map(toStoredSnapshot);
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    await this.prisma.snapshot.create({
      data: {
        id: snapshot.id,
        roomId: snapshot.roomId,
        docVersion: snapshot.docVersion,
        data: Buffer.from(snapshot.data),
      },
    });
    await this.prisma.room.update({
      where: { id: snapshot.roomId },
      data: { updatedAt: snapshot.createdAt },
    });
    await this.prune(snapshot.roomId);
  }

  /** Enforce the retention policy: newest + newest-K + inside the window. */
  private async prune(roomId: string): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.retention.retentionDays * 86_400_000,
    );
    const [newest, recent, inWindow] = await Promise.all([
      this.prisma.snapshot.findFirst({
        where: { roomId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
      this.prisma.snapshot.findMany({
        where: { roomId },
        orderBy: { createdAt: "desc" },
        take: this.retention.maxPerRoom,
        select: { id: true },
      }),
      this.prisma.snapshot.findMany({
        where: { roomId, createdAt: { gte: cutoff } },
        select: { id: true },
      }),
    ]);
    const keep = new Set<string>();
    if (newest) keep.add(newest.id);
    for (const row of [...recent, ...inWindow]) keep.add(row.id);
    await this.prisma.snapshot.deleteMany({
      where: { roomId, id: { notIn: [...keep] } },
    });
  }

  async ensureRoom(
    metadata: RoomMetadata,
    passwordHash?: string,
  ): Promise<void> {
    // Never clobber existing metadata on re-ensure: cold loads call this
    // with defaults, which must not reset a room's name/owner/tier.
    // (Password is intentionally left alone here too — rotation goes
    // through updateRoom.)
    await this.prisma.room.upsert({
      where: { id: metadata.id },
      create: {
        id: metadata.id,
        name: metadata.name,
        ownerId: metadata.ownerId,
        tier: metadata.tier,
        passwordHash,
      },
      update: {},
    });
  }

  async getRoom(roomId: string): Promise<RoomMetadata | null> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        tier: true,
        passwordHash: true,
      },
    });
    return room
      ? {
          id: room.id,
          name: room.name,
          ownerId: room.ownerId,
          tier: room.tier,
          hasPassword: room.passwordHash !== null,
        }
      : null;
  }

  async updateRoom(
    roomId: string,
    updates: RoomUpdate,
  ): Promise<RoomMetadata | null> {
    const room = await this.prisma.room
      .update({
        where: { id: roomId },
        data: {
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.ownerId !== undefined
            ? { ownerId: updates.ownerId }
            : {}),
          ...(updates.tier !== undefined ? { tier: updates.tier } : {}),
          ...(updates.passwordHash !== undefined
            ? {
                passwordHash: updates.passwordHash,
                passwordVersion: { increment: 1 },
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          tier: true,
          passwordHash: true,
        },
      })
      .catch((error: unknown) => {
        // Missing row (P2025). Anything else is a real failure.
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2025"
        )
          return null;
        throw error;
      });
    if (!room) return null;
    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      tier: room.tier,
      hasPassword: room.passwordHash !== null,
    };
  }

  async getPasswordHash(roomId: string): Promise<string | null> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { passwordHash: true },
    });
    return room?.passwordHash ?? null;
  }

  async getPasswordVersion(roomId: string): Promise<number | null> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { passwordVersion: true },
    });
    return room?.passwordVersion ?? null;
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.prisma.room.delete({ where: { id: roomId } });
  }

  close(): Promise<void> {
    return this.prisma.$disconnect();
  }
}

type SnapshotRow = {
  id: string;
  roomId: string;
  docVersion: string;
  data: Uint8Array;
  createdAt: Date;
};

function toStoredSnapshot(snapshot: SnapshotRow): StoredSnapshot {
  return {
    id: snapshot.id,
    roomId: snapshot.roomId,
    docVersion: snapshot.docVersion,
    data: new Uint8Array(snapshot.data),
    createdAt: snapshot.createdAt,
  };
}

export async function loadRoomDoc(
  roomId: string,
  store: SnapshotStore,
): Promise<Y.Doc> {
  const doc = new Y.Doc();
  // Newest-first with fallback: a corrupt latest snapshot must not brick
  // the room — older snapshots still apply cleanly on top of each other
  // because every snapshot is a full state update.
  const snapshots = await store.listSnapshots(roomId, { limit: 10 });
  for (const snapshot of snapshots) {
    try {
      Y.applyUpdate(doc, decompressSync(snapshot.data), "room-loader");
      return doc;
    } catch {
      continue;
    }
  }
  return doc;
}
