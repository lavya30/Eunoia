'use client';

import { getSessionToken } from './auth';
import { getFavoriteRoomIds, getRoomTags } from './favorites';
import { getRecentRooms, type RecentRoom } from './recent-rooms';
import { getRoom } from './rooms-api';
import {
  getWorkspace,
  listRooms,
  listWorkspaces,
  type RoomSummary,
} from './workspaces-api';

export type DashboardRoom = {
  id: string;
  name: string;
  tier: RoomSummary['tier'];
  workspaceId: string | null;
  folderId: string | null;
  hasPassword: boolean;
  ownerId: string;
  visitedAt: number | null;
  favorite: boolean;
  tags: string[];
};

export type DashboardData = {
  personal: DashboardRoom[];
  workspaceRooms: DashboardRoom[];
  recent: RecentRoom[];
  signedIn: boolean;
};

function toDashboardRoom(
  room: RoomSummary,
  visitedAt: Map<string, number>,
): DashboardRoom {
  return {
    id: room.id,
    name: room.name,
    tier: room.tier,
    workspaceId: room.workspaceId,
    folderId: room.folderId,
    hasPassword: room.hasPassword,
    ownerId: room.ownerId,
    visitedAt: visitedAt.get(room.id) ?? null,
    favorite: getFavoriteRoomIds().includes(room.id),
    tags: getRoomTags(room.id),
  };
}

/**
 * Dashboard aggregation: personal rooms + team rooms + local recents.
 * Workspace detail fan-out is bounded (first 5 workspaces) so the page
 * stays fast for users with many teams.
 */
export async function loadDashboard(): Promise<DashboardData> {
  const recent = getRecentRooms();
  const visitedAt = new Map(recent.map((room) => [room.id, room.visitedAt]));
  const token = getSessionToken();
  if (!token) {
    // Signed-out: surface local recents only; each card hydrates its name
    // lazily (rooms-api getRoom best-effort) to avoid a dead page.
    const hydrated = await Promise.all(
      recent.map(async (room) => {
        try {
          const meta = await getRoom(room.id);
          return {
            id: meta.id,
            name: meta.name,
            tier: meta.tier,
            workspaceId: meta.workspaceId,
            folderId: meta.folderId,
            hasPassword: meta.hasPassword,
            ownerId: meta.ownerId,
            visitedAt: room.visitedAt,
            favorite: getFavoriteRoomIds().includes(meta.id),
            tags: getRoomTags(meta.id),
          } satisfies DashboardRoom;
        } catch {
          return {
            id: room.id,
            name: room.name,
            tier: 'COMMUNITY' as const,
            workspaceId: null,
            folderId: null,
            hasPassword: false,
            ownerId: 'local',
            visitedAt: room.visitedAt,
            favorite: false,
            tags: [],
          } satisfies DashboardRoom;
        }
      }),
    );
    return { personal: hydrated, workspaceRooms: [], recent, signedIn: false };
  }

  const [personalRes, workspaces] = await Promise.all([
    listRooms(token).catch(() => ({ rooms: [] as RoomSummary[] })),
    listWorkspaces(token).catch(() => []),
  ]);

  const detailRooms: RoomSummary[] = [];
  for (const entry of workspaces.slice(0, 5)) {
    try {
      const detail = await getWorkspace(entry.workspace.id, token);
      detailRooms.push(...detail.rooms);
    } catch {
      // A single failing workspace must not blank the dashboard.
    }
  }

  return {
    personal: personalRes.rooms.map((room) => toDashboardRoom(room, visitedAt)),
    workspaceRooms: detailRooms.map((room) => toDashboardRoom(room, visitedAt)),
    recent,
    signedIn: true,
  };
}
