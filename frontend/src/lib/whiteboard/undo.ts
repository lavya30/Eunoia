import type { BoardArrow, BoardNode, BoardStroke } from './board-types';

export type BoardSnapshot = {
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  code: string;
};

export type ElementChange<T> = {
  /** Value before the local op (`undefined` = the element did not exist). */
  before: T | undefined;
  /** Value after the local op (`undefined` = deleted by the local op). */
  after: T | undefined;
  /** List index before the op (for order-faithful restore). */
  beforeIndex: number | null;
  /** List index after the op (for order-faithful redo). */
  afterIndex: number | null;
};

/**
 * One per-user undo entry. Stores before/after values ONLY for elements
 * touched by the local user's own operation — concurrent peer edits to
 * other elements are never captured, so undo/redo can't revert them.
 */
export type UndoEntry = {
  nodes: Map<string, ElementChange<BoardNode>>;
  arrows: Map<string, ElementChange<BoardArrow>>;
  strokes: Map<string, ElementChange<BoardStroke>>;
  codeBefore: string | null;
  codeAfter: string | null;
};

/** Bound for per-user undo/redo memory (PRD §3.3.3: last 100 operations). */
export const MAX_UNDO_ENTRIES = 100;

export function diffElementLists<T extends { id: string }>(
  before: T[],
  after: T[],
): Map<string, ElementChange<T>> {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const beforeIndex = new Map(before.map((item, index) => [item.id, index]));
  const afterIndex = new Map(after.map((item, index) => [item.id, index]));
  const changes = new Map<string, ElementChange<T>>();
  for (const [id, beforeValue] of beforeById) {
    const afterValue = afterById.get(id);
    if (afterValue === undefined) {
      changes.set(id, {
        before: beforeValue,
        after: undefined,
        beforeIndex: beforeIndex.get(id) ?? null,
        afterIndex: null,
      });
    } else if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.set(id, {
        before: beforeValue,
        after: afterValue,
        beforeIndex: beforeIndex.get(id) ?? null,
        afterIndex: afterIndex.get(id) ?? null,
      });
    }
  }
  for (const [id, afterValue] of afterById) {
    if (!beforeById.has(id)) {
      changes.set(id, {
        before: undefined,
        after: afterValue,
        beforeIndex: null,
        afterIndex: afterIndex.get(id) ?? null,
      });
    }
  }
  return changes;
}

/** Diff two board states into an undo entry, or `null` when identical. */
export function diffBoardSnapshots(
  base: BoardSnapshot,
  current: BoardSnapshot,
): UndoEntry | null {
  const nodes = diffElementLists(base.nodes, current.nodes);
  const arrows = diffElementLists(base.arrows, current.arrows);
  const strokes = diffElementLists(base.strokes, current.strokes);
  const codeChanged = base.code !== current.code;
  if (
    nodes.size === 0 &&
    arrows.size === 0 &&
    strokes.size === 0 &&
    !codeChanged
  ) {
    return null;
  }
  return {
    nodes,
    arrows,
    strokes,
    codeBefore: codeChanged ? base.code : null,
    codeAfter: codeChanged ? current.code : null,
  };
}

/** Invert an entry (for building the redo counterpart during undo). */
export function invertUndoEntry(entry: UndoEntry): UndoEntry {
  const flip = <T>(changes: Map<string, ElementChange<T>>) =>
    new Map(
      [...changes].map(([id, change]) => [
        id,
        {
          before: change.after,
          after: change.before,
          beforeIndex: change.afterIndex,
          afterIndex: change.beforeIndex,
        },
      ]),
    );
  return {
    nodes: flip(entry.nodes),
    arrows: flip(entry.arrows),
    strokes: flip(entry.strokes),
    codeBefore: entry.codeAfter,
    codeAfter: entry.codeBefore,
  };
}

/**
 * Apply one side of an entry to a list: restore/create listed values,
 * drop elements deleted on that side, pass everything else through.
 * Restored elements are reinserted at their recorded index so z-order
 * survives delete/undo cycles.
 */
export function applyEntryValues<T extends { id: string }>(
  current: T[],
  changes: Map<string, ElementChange<T>>,
  side: 'before' | 'after',
): T[] {
  const next: T[] = [];
  for (const item of current) {
    const change = changes.get(item.id);
    if (!change) {
      next.push(item);
      continue;
    }
    const value = change[side];
    if (value !== undefined) next.push(value);
  }
  const restores: Array<{ index: number; value: T }> = [];
  for (const [id, change] of changes) {
    const value = change[side];
    if (value === undefined || next.some((item) => item.id === id)) continue;
    const index = side === 'before' ? change.beforeIndex : change.afterIndex;
    restores.push({ index: index ?? next.length, value });
  }
  restores.sort((a, b) => a.index - b.index);
  for (const { index, value } of restores) {
    next.splice(Math.min(index, next.length), 0, value);
  }
  return next;
}
