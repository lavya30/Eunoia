'use client';

export type RecentRoom = {
  id: string;
  name: string;
  visitedAt: number;
};

const STORAGE_KEY = 'eunoia:recent-rooms:v1';
const MAX_RECENT = 8;

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): RecentRoom[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is RecentRoom =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as RecentRoom).id === 'string' &&
          typeof (entry as RecentRoom).visitedAt === 'number',
      )
      .map((entry) => ({
        id: entry.id,
        name: typeof entry.name === 'string' ? entry.name : 'Untitled board',
        visitedAt: entry.visitedAt,
      }));
  } catch {
    return [];
  }
}

/** Most-recent-first room visits, for the board switcher. */
export function getRecentRooms(): RecentRoom[] {
  return parse(store()?.getItem(STORAGE_KEY) ?? null).sort(
    (a, b) => b.visitedAt - a.visitedAt,
  );
}

/** Record a visit; moves the room to the front, caps the list. */
export function recordRoomVisit(room: { id: string; name?: string }): void {
  const storage = store();
  if (!storage) return;
  try {
    const rest = parse(storage.getItem(STORAGE_KEY)).filter(
      (entry) => entry.id !== room.id,
    );
    const next: RecentRoom[] = [
      {
        id: room.id,
        name: room.name?.trim() || 'Untitled board',
        visitedAt: Date.now(),
      },
      ...rest,
    ].slice(0, MAX_RECENT);
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort (private mode, quota).
  }
}
