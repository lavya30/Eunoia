import type { PrismaClient } from '@prisma/client';
import { decompressSync } from 'fflate';
import * as Y from 'yjs';

export type StoredSnapshot = {
  roomId: string;
  docVersion: string;
  data: Uint8Array;
  createdAt: Date;
};

export type RoomMetadata = {
  id: string;
  name: string;
  ownerId: string;
  tier: 'COMMUNITY' | 'PRO' | 'ENTERPRISE';
};

export interface SnapshotStore {
  getLatestSnapshot(roomId: string): Promise<StoredSnapshot | null>;
  saveSnapshot(snapshot: StoredSnapshot): Promise<void>;
  ensureRoom(metadata: RoomMetadata): Promise<void>;
  getRoom(roomId: string): Promise<RoomMetadata | null>;
  deleteRoom?(roomId: string): Promise<void>;
  close?(): Promise<void>;
}

export class MemorySnapshotStore implements SnapshotStore {
  readonly snapshots = new Map<string, StoredSnapshot>();
  readonly rooms = new Map<string, RoomMetadata>();

  async getLatestSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    return this.snapshots.get(roomId) ?? null;
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    this.snapshots.set(snapshot.roomId, {
      ...snapshot,
      data: new Uint8Array(snapshot.data),
    });
  }

  async ensureRoom(metadata: RoomMetadata): Promise<void> {
    if (!this.rooms.has(metadata.id)) this.rooms.set(metadata.id, metadata);
  }

  async getRoom(roomId: string): Promise<RoomMetadata | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
    this.snapshots.delete(roomId);
  }
}

export class PrismaSnapshotStore implements SnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getLatestSnapshot(roomId: string): Promise<StoredSnapshot | null> {
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
    });
    return snapshot
      ? {
          roomId: snapshot.roomId,
          docVersion: snapshot.docVersion,
          data: new Uint8Array(snapshot.data),
          createdAt: snapshot.createdAt,
        }
      : null;
  }

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    await this.prisma.snapshot.create({
      data: {
        roomId: snapshot.roomId,
        docVersion: snapshot.docVersion,
        data: Buffer.from(snapshot.data),
      },
    });
    await this.prisma.room.update({
      where: { id: snapshot.roomId },
      data: { updatedAt: snapshot.createdAt },
    });
  }

  async ensureRoom(metadata: RoomMetadata): Promise<void> {
    await this.prisma.room.upsert({
      where: { id: metadata.id },
      create: metadata,
      update: {
        name: metadata.name,
        ownerId: metadata.ownerId,
        tier: metadata.tier,
      },
    });
  }

  async getRoom(roomId: string): Promise<RoomMetadata | null> {
    return this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true, ownerId: true, tier: true },
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.prisma.room.delete({ where: { id: roomId } });
  }

  close(): Promise<void> {
    return this.prisma.$disconnect();
  }
}

export async function loadRoomDoc(
  roomId: string,
  store: SnapshotStore,
): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const snapshot = await store.getLatestSnapshot(roomId);
  if (snapshot)
    Y.applyUpdate(doc, decompressSync(snapshot.data), 'room-loader');
  return doc;
}
