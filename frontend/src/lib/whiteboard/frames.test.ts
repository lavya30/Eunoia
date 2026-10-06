import { describe, expect, test } from 'bun:test';
import type { BoardArrow, BoardNode, BoardStroke } from './board-types';
import {
  getContainedElements,
  getFrameCamera,
  getFrameSlideIndex,
  isArrowInFrame,
  isNodeInFrame,
  isStrokeInFrame,
  sortFrames,
} from './frames';

describe('frames', () => {
  const f1: BoardNode = {
    id: 'f1',
    label: 'Architecture Overview',
    detail: '',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    tone: 'violet',
    shape: 'frame',
    frameIndex: 1,
  };

  const f2: BoardNode = {
    id: 'f2',
    label: 'Data Pipeline',
    detail: '',
    x: 2200,
    y: 0,
    width: 1920,
    height: 1080,
    tone: 'blue',
    shape: 'frame',
    frameIndex: 2,
  };

  const f3NoIndex: BoardNode = {
    id: 'f3',
    label: 'Deployment Tier',
    detail: '',
    x: 100,
    y: 1200,
    width: 1600,
    height: 1200,
    tone: 'mint',
    shape: 'frame',
  };

  const regularNode: BoardNode = {
    id: 'n1',
    label: 'API Gateway',
    detail: '',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    tone: 'orange',
    shape: 'round',
  };

  test('sorts frames by frameIndex then spatial coordinates', () => {
    const sorted = sortFrames([f3NoIndex, f2, f1, regularNode]);
    expect(sorted.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  test('computes 1-based slide index correctly', () => {
    const list = [f3NoIndex, f2, f1];
    expect(getFrameSlideIndex('f1', list)).toBe(1);
    expect(getFrameSlideIndex('f2', list)).toBe(2);
    expect(getFrameSlideIndex('f3', list)).toBe(3);
  });

  test('detects node containment inside frame', () => {
    expect(isNodeInFrame(regularNode, f1)).toBe(true);
    expect(isNodeInFrame(regularNode, f2)).toBe(false);
    // Frames should not be contained in themselves or other frames
    expect(isNodeInFrame(f1, f1)).toBe(false);
  });

  test('detects arrow containment inside frame', () => {
    const arrowInside: BoardArrow = {
      id: 'a1',
      start: { x: 50, y: 50 },
      end: { x: 500, y: 500 },
      color: '#fff',
    };
    const arrowCrossing: BoardArrow = {
      id: 'a2',
      start: { x: 50, y: 50 },
      end: { x: 2500, y: 500 },
      color: '#fff',
    };
    expect(isArrowInFrame(arrowInside, f1)).toBe(true);
    expect(isArrowInFrame(arrowCrossing, f1)).toBe(false);
  });

  test('detects stroke containment inside frame', () => {
    const strokeInside: BoardStroke = {
      id: 's1',
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      color: '#000',
    };
    const strokeOutside: BoardStroke = {
      id: 's2',
      points: [
        { x: 100, y: 100 },
        { x: 2500, y: 200 },
      ],
      color: '#000',
    };
    expect(isStrokeInFrame(strokeInside, f1)).toBe(true);
    expect(isStrokeInFrame(strokeOutside, f1)).toBe(false);
  });

  test('returns all contained elements', () => {
    const arrowInside: BoardArrow = {
      id: 'a1',
      start: { x: 50, y: 50 },
      end: { x: 500, y: 500 },
      color: '#fff',
    };
    const strokeInside: BoardStroke = {
      id: 's1',
      points: [{ x: 100, y: 100 }],
      color: '#000',
    };
    const contained = getContainedElements(
      f1,
      [regularNode, f2],
      [arrowInside],
      [strokeInside],
    );
    expect(contained.nodeIds).toEqual(['n1']);
    expect(contained.arrowIds).toEqual(['a1']);
    expect(contained.strokeIds).toEqual(['s1']);
  });

  test('computes camera focus to fit frame in viewport', () => {
    const cam = getFrameCamera(f1, { width: 1200, height: 700 });
    expect(cam.x).toBe(960); // 0 + 1920 / 2
    expect(cam.y).toBe(540); // 0 + 1080 / 2
    expect(cam.zoom).toBeGreaterThan(0.25);
    expect(cam.zoom <= 2.0).toBe(true);
  });
});
