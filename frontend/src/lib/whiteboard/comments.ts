'use client';

import type { BoardComment } from './board-types';

export type { BoardComment } from './board-types';

const COMMENTS_KEY_PREFIX = 'eunoia:comments:';

function keyFor(roomId: string): string {
  return `${COMMENTS_KEY_PREFIX}${roomId}:v1`;
}

function parse(raw: string | null): BoardComment[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return sanitizeComments(value);
  } catch {
    return [];
  }
}

export function sanitizeComment(raw: unknown): BoardComment | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<BoardComment>;
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 120 ||
    typeof value.body !== 'string' ||
    value.body.trim().length === 0 ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  )
    return null;
  const mentions = Array.isArray(value.mentions)
    ? value.mentions
        .filter((mention): mention is string => typeof mention === 'string')
        .map((mention) => mention.slice(0, 64))
        .slice(0, 50)
    : extractMentions(value.body);
  return {
    id: value.id,
    parentId:
      value.parentId === null || typeof value.parentId === 'string'
        ? value.parentId
        : null,
    x: Math.min(100_000, Math.max(-100_000, value.x)),
    y: Math.min(100_000, Math.max(-100_000, value.y)),
    body: value.body.trim().slice(0, 4_000),
    author:
      typeof value.author === 'string' && value.author.trim()
        ? value.author.trim().slice(0, 120)
        : 'Anonymous',
    authorId:
      typeof value.authorId === 'string' && value.authorId.length > 0
        ? value.authorId.slice(0, 120)
        : 'anonymous',
    mentions,
    resolved: value.resolved === true,
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now(),
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : Date.now(),
    deletedAt:
      typeof value.deletedAt === 'number' && Number.isFinite(value.deletedAt)
        ? value.deletedAt
        : undefined,
  };
}

export function sanitizeComments(value: unknown): BoardComment[] {
  if (!Array.isArray(value)) return [];
  const comments: BoardComment[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const comment = sanitizeComment(entry);
    if (!comment || ids.has(comment.id)) continue;
    ids.add(comment.id);
    comments.push(comment);
  }
  return comments.slice(-2_000);
}

/** Legacy localStorage access used only to migrate pre-sync comments. */
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
