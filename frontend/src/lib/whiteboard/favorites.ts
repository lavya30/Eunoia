'use client';

const FAVORITES_KEY = 'eunoia:favorites:v1';
const TAGS_KEY = 'eunoia:tags:v1';

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
  } catch {
    return [];
  }
}

function parseTagMap(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, tags] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof key !== 'string' || !Array.isArray(tags)) continue;
      out[key] = tags.filter(
        (tag): tag is string => typeof tag === 'string' && tag.length > 0,
      );
    }
    return out;
  } catch {
    return {};
  }
}

/** Starred room ids (local-first; promoted to server field later). */
export function getFavoriteRoomIds(): string[] {
  return parseStringArray(store()?.getItem(FAVORITES_KEY) ?? null);
}

export function isRoomFavorite(roomId: string): boolean {
  return getFavoriteRoomIds().includes(roomId);
}

export function toggleRoomFavorite(roomId: string): boolean {
  const storage = store();
  if (!storage) return false;
  const current = parseStringArray(storage.getItem(FAVORITES_KEY));
  const next = current.includes(roomId)
    ? current.filter((id) => id !== roomId)
    : [...current, roomId];
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // Best-effort.
  }
  return next.includes(roomId);
}

/** Per-room tags. `archived` is the v1 archive flag (hidden by default). */
export function getRoomTags(roomId: string): string[] {
  return parseTagMap(store()?.getItem(TAGS_KEY) ?? null)[roomId] ?? [];
}

export function getAllTags(): Record<string, string[]> {
  return parseTagMap(store()?.getItem(TAGS_KEY) ?? null);
}

export function setRoomTags(roomId: string, tags: string[]): void {
  const storage = store();
  if (!storage) return;
  const current = parseTagMap(storage.getItem(TAGS_KEY));
  const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (cleaned.length === 0) delete current[roomId];
  else current[roomId] = cleaned;
  try {
    storage.setItem(TAGS_KEY, JSON.stringify(current));
  } catch {
    // Best-effort.
  }
}

export function isRoomArchived(roomId: string): boolean {
  return getRoomTags(roomId).includes('archived');
}

export function toggleRoomArchived(roomId: string): boolean {
  const tags = getRoomTags(roomId);
  const next = tags.includes('archived')
    ? tags.filter((tag) => tag !== 'archived')
    : [...tags, 'archived'];
  setRoomTags(roomId, next);
  return next.includes('archived');
}
