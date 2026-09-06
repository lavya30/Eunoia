import { describe, expect, test } from 'bun:test';
import { CursorSmoothing } from '../src/CursorSmoothing.js';

describe('cursor smoothing', () => {
  test('moves toward a remote cursor target without snapping', () => {
    const smoothing = new CursorSmoothing(0.5);
    smoothing.update('peer', { x: 0, y: 0 });
    const cursor = smoothing.update('peer', { x: 10, y: 20 });
    expect(cursor.x).toBe(5);
    expect(cursor.y).toBe(10);
    expect(cursor.targetX).toBe(10);
    expect(cursor.targetY).toBe(20);
  });
});
