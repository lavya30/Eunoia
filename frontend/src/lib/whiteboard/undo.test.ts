import { describe, expect, test } from 'bun:test';
import type { BoardNode } from './board-types';
import {
  applyEntryValues,
  diffBoardSnapshots,
  invertUndoEntry,
  MAX_UNDO_ENTRIES,
  type BoardSnapshot,
} from './undo';

function node(id: string, x: number): BoardNode {
  return {
    id,
    label: id,
    detail: '',
    x,
    y: 0,
    width: 100,
    height: 50,
    tone: 'mint' as const,
  };
}

function board(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    nodes: [node('a', 0), node('b', 100)],
    arrows: [],
    strokes: [],
    code: 'x -> y',
    ...overrides,
  };
}

describe('diffBoardSnapshots', () => {
  test('identical boards produce no entry', () => {
    expect(diffBoardSnapshots(board(), board())).toBeNull();
  });

  test('captures only touched elements (peer isolation)', () => {
    const before = board();
    const after = board({ nodes: [node('a', 50), node('b', 100)] });
    const entry = diffBoardSnapshots(before, after);
    expect(entry).not.toBeNull();
    expect([...entry!.nodes.keys()]).toEqual(['a']);
    expect(entry!.nodes.get('a')?.before).toEqual(node('a', 0));
    expect(entry!.nodes.get('a')?.after).toEqual(node('a', 50));
    expect(entry!.codeBefore).toBeNull();
  });

  test('captures creates and deletes with indexes', () => {
    const before = board();
    const after = board({ nodes: [node('b', 100), node('c', 200)] });
    const entry = diffBoardSnapshots(before, after)!;
    expect(entry.nodes.get('a')).toMatchObject({
      after: undefined,
      beforeIndex: 0,
    });
    expect(entry.nodes.get('c')).toMatchObject({
      before: undefined,
      afterIndex: 1,
    });
  });

  test('captures code-only changes', () => {
    const entry = diffBoardSnapshots(board(), board({ code: 'x -> z' }))!;
    expect(entry.nodes.size).toBe(0);
    expect(entry.codeBefore).toBe('x -> y');
    expect(entry.codeAfter).toBe('x -> z');
  });
});

describe('applyEntryValues + invertUndoEntry', () => {
  test('undo/redo round-trips a move', () => {
    const before = board();
    const after = board({ nodes: [node('a', 50), node('b', 100)] });
    const entry = diffBoardSnapshots(before, after)!;
    expect(applyEntryValues(after.nodes, entry.nodes, 'before')).toEqual(
      before.nodes,
    );
    const redo = invertUndoEntry(entry);
    expect(applyEntryValues(before.nodes, redo.nodes, 'before')).toEqual(
      after.nodes,
    );
  });

  test('undo of a delete restores z-order position', () => {
    const before = board({
      nodes: [node('a', 0), node('b', 100), node('c', 200)],
    });
    const after = board({ nodes: [node('a', 0), node('c', 200)] });
    const entry = diffBoardSnapshots(before, after)!;
    expect(
      applyEntryValues(after.nodes, entry.nodes, 'before').map((n) => n.id),
    ).toEqual(['a', 'b', 'c']);
  });

  test('untouched peer elements pass through undo', () => {
    const before = board();
    const entry = diffBoardSnapshots(
      before,
      board({ nodes: [node('a', 50), node('b', 100)] }),
    )!;
    // A peer added 'p' after the entry was captured.
    const withPeer = [node('a', 50), node('b', 100), node('p', 999)];
    const undone = applyEntryValues(withPeer, entry.nodes, 'before');
    expect(undone.map((n) => n.id).sort()).toEqual(['a', 'b', 'p']);
    expect(undone.find((n) => n.id === 'a')).toEqual(node('a', 0));
  });
});

describe('MAX_UNDO_ENTRIES', () => {
  test('matches the PRD cap of 100', () => {
    expect(MAX_UNDO_ENTRIES).toBe(100);
  });
});
