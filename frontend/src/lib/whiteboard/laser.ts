import type { Point } from './geometry';

export interface LaserPoint extends Point {
  time: number;
}

export const LASER_LIFESPAN_MS = 1000;

/**
 * Filter out laser points older than `maxAgeMs`.
 */
export function pruneLaserPoints(
  points: LaserPoint[],
  now: number,
  maxAgeMs = LASER_LIFESPAN_MS,
): LaserPoint[] {
  const cutoff = now - maxAgeMs;
  return points.filter((p) => p.time >= cutoff);
}

/**
 * Generates an SVG path string from a sequence of laser trail points.
 * Uses midpoint quadratic curves for smooth fluid rendering.
 */
export function laserTrailSvgPath(points: LaserPoint[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q ${current.x} ${current.y}, ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Calculates opacity for a laser point based on its age.
 */
export function laserPointAlpha(
  point: LaserPoint,
  now: number,
  maxAgeMs = LASER_LIFESPAN_MS,
): number {
  const age = now - point.time;
  if (age <= 0) return 1;
  if (age >= maxAgeMs) return 0;
  return Math.max(0, Math.min(1, 1 - age / maxAgeMs));
}
