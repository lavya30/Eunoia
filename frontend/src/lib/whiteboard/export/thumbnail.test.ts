import { describe, expect, test } from 'bun:test';
import type { BoardArrow, BoardNode, BoardStroke } from '../board-types';
import {
  THUMB_CAPTURE_DEBOUNCE_MS,
  THUMB_MAX_SOURCE_PX,
  THUMB_WIDTH,
  thumbnailContentHash,
} from './thumbnail';

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

describe('thumbnailContentHash', () => {
  test('is stable for identical boards', () => {
    const nodes = [node('a', 0), node('b', 200)];
    const arrows: BoardArrow[] = [];
    const strokes: BoardStroke[] = [];
    expect(thumbnailContentHash(nodes, arrows, strokes)).toBe(
      thumbnailContentHash(nodes, arrows, strokes),
    );
  });

  test('changes when elements are added or moved', () => {
    const base = thumbnailContentHash([node('a', 0)], [], []);
    const added = thumbnailContentHash([node('a', 0), node('b', 200)], [], []);
    expect(added === base).toBe(false);
    // Sub-pixel nudges quantize away; a real move changes the hash.
    const nudged = thumbnailContentHash([node('a', 1)], [], []);
    expect(nudged).toBe(base);
    const moved = thumbnailContentHash([node('a', 64)], [], []);
    expect(moved === base).toBe(false);
  });

  test('distinguishes arrows and strokes', () => {
    const empty = thumbnailContentHash([], [], []);
    const withArrow = thumbnailContentHash(
      [],
      [
        {
          id: 'e1',
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
          color: '#000',
        },
      ],
      [],
    );
    expect(withArrow === empty).toBe(false);
    const withStroke = thumbnailContentHash(
      [],
      [],
      [{ id: 's1', points: [{ x: 0, y: 0 }], color: '#000' }],
    );
    expect(withStroke === empty).toBe(false);
  });
});

describe('thumbnail constants', () => {
  test('capture cadence and dimensions are sane', () => {
    expect(THUMB_WIDTH).toBe(480);
    expect(THUMB_CAPTURE_DEBOUNCE_MS).toBe(30_000);
    expect(THUMB_MAX_SOURCE_PX).toBe(2048);
  });
});
