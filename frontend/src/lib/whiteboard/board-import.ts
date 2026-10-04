'use client';

import type { BoardArrow, BoardNode, BoardStroke } from './board-types';

export type BoardExportJson = {
  kind: 'eunoia-board';
  version: 1;
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  code?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseNodes(value: unknown): BoardNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (node): node is BoardNode =>
      isRecord(node) &&
      typeof node.id === 'string' &&
      typeof node.x === 'number' &&
      typeof node.y === 'number',
  );
}

function parseArrows(value: unknown): BoardArrow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (arrow): arrow is BoardArrow =>
      isRecord(arrow) &&
      typeof arrow.id === 'string' &&
      isRecord(arrow.start) &&
      isRecord(arrow.end),
  );
}

function parseStrokes(value: unknown): BoardStroke[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (stroke): stroke is BoardStroke =>
      isRecord(stroke) &&
      typeof stroke.id === 'string' &&
      Array.isArray(stroke.points),
  );
}

/**
 * Parse a previously exported board JSON file (see WhiteboardPage
 * exportAsJSON). Returns null when the file is not a board export —
 * callers surface the failure instead of partially applying it.
 */
export function parseBoardExport(text: string): BoardExportJson | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  if (payload.kind !== 'eunoia-board') return null;
  return {
    kind: 'eunoia-board',
    version: 1,
    nodes: parseNodes(payload.nodes),
    arrows: parseArrows(payload.arrows),
    strokes: parseStrokes(payload.strokes),
    code: typeof payload.code === 'string' ? payload.code : undefined,
  };
}

/** Parse a raw `.d2` file into editor source (trimmed, non-empty). */
export function parseD2Import(text: string): string | null {
  const source = text.trim();
  return source.length > 0 ? source : null;
}
