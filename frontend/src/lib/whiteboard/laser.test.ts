import { describe, expect, test } from 'bun:test';
import {
  laserPointAlpha,
  laserTrailSvgPath,
  pruneLaserPoints,
  type LaserPoint,
} from './laser';

describe('laser', () => {
  test('prunes points older than cutoff', () => {
    const now = 2000;
    const points: LaserPoint[] = [
      { x: 10, y: 10, time: 500 }, // age 1500 > 1000 -> pruned
      { x: 20, y: 20, time: 1100 }, // age 900 <= 1000 -> kept
      { x: 30, y: 30, time: 1950 }, // age 50 <= 1000 -> kept
    ];
    const remaining = pruneLaserPoints(points, now, 1000);
    expect(remaining.length).toBe(2);
    expect(remaining[0].x).toBe(20);
    expect(remaining[1].x).toBe(30);
  });

  test('computes alpha based on age', () => {
    const now = 1000;
    expect(laserPointAlpha({ x: 0, y: 0, time: 1000 }, now, 1000)).toBe(1);
    expect(laserPointAlpha({ x: 0, y: 0, time: 500 }, now, 1000)).toBe(0.5);
    expect(laserPointAlpha({ x: 0, y: 0, time: 0 }, now, 1000)).toBe(0);
    expect(laserPointAlpha({ x: 0, y: 0, time: -100 }, now, 1000)).toBe(0);
  });

  test('generates smooth SVG path', () => {
    expect(laserTrailSvgPath([])).toBe('');
    expect(laserTrailSvgPath([{ x: 0, y: 0, time: 0 }])).toBe('');
    expect(
      laserTrailSvgPath([
        { x: 0, y: 0, time: 0 },
        { x: 10, y: 10, time: 1 },
      ]),
    ).toBe('M 0 0 L 10 10');

    const multi = laserTrailSvgPath([
      { x: 0, y: 0, time: 0 },
      { x: 10, y: 10, time: 1 },
      { x: 20, y: 15, time: 2 },
    ]);
    expect(multi).toContain('M 0 0 Q 10 10, 15 12.5 L 20 15');
  });
});
