'use client';

export type BoardComment = {
  id: string;
  x: number;
  y: number;
  body: string;
  author: string;
  mentions: string[];
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
};

const COMMENTS_KEY_PREFIX = 'eunoia:comments:';

function keyFor(roomId: string): string {
  return `${COMMENTS_KEY_PREFIX}${roomId}:v1`;
}

function parse(raw: string | null): BoardComment[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is BoardComment =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as BoardComment).id === 'string' &&
        typeof (entry as BoardComment).x === 'number' &&
        typeof (entry as BoardComment).y === 'number' &&
        typeof (entry as BoardComment).body === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Local-first comment store (v1). Pins render immediately; the schema is
 * thread-ready (mentions/resolved/timestamps) so a Yjs-backed upgrade
 * keeps the shape and only swaps persistence.
 */
export function getComments(roomId: string): BoardComment[] {
  try {
    return parse(window.localStorage.getItem(keyFor(roomId)));
  } catch {
    return [];
  }
}

export function saveComments(roomId: string, comments: BoardComment[]): void {
  try {
    window.localStorage.setItem(keyFor(roomId), JSON.stringify(comments));
  } catch {
    // Best-effort (private mode, quota).
  }
}

export function extractMentions(body: string): string[] {
  const mentions = new Set<string>();
  for (const match of body.matchAll(/@([\w.-]+)/g)) {
    if (match[1]) mentions.add(match[1]);
  }
  return [...mentions];
}
