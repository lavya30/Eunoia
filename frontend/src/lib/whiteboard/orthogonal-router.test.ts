import { describe, expect, it } from 'bun:test';
import type { Aabb, Point, PortNode } from './geometry';
import {
  detectNodePortDirection,
  directionToVector,
  generateOrthogonalRoute,
  generateOrthogonalWaypoints,
  makePolylineOrthogonal,
  nodesToObstacles,
  polylineIntersectsObstacles,
  segmentIntersectsObstacle,
  simplifyCollinear,
} from './geometry';
import { arrowPath, arrowPathPoints, orthogonalPolylineToPath } from './paths';
import type { BoardArrow } from './board-types';

describe('Manhattan / Orthogonal Connector Router', () => {
  it('converts cardinal directions to correct 2D unit vectors', () => {
    expect(directionToVector('n')).toEqual({ x: 0, y: -1 });
    expect(directionToVector('s')).toEqual({ x: 0, y: 1 });
    expect(directionToVector('e')).toEqual({ x: 1, y: 0 });
    expect(directionToVector('w')).toEqual({ x: -1, y: 0 });
  });

  it('detects node port faces accurately from center normal', () => {
    const node: PortNode = { x: 100, y: 100, width: 100, height: 60 };
    // Center is (150, 130)
    expect(detectNodePortDirection(node, { x: 200, y: 130 })).toBe('e');
    expect(detectNodePortDirection(node, { x: 100, y: 130 })).toBe('w');
    expect(detectNodePortDirection(node, { x: 150, y: 100 })).toBe('n');
    expect(detectNodePortDirection(node, { x: 150, y: 160 })).toBe('s');
  });

  it('simplifies collinear points in axis-aligned polylines', () => {
    const input: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
    ];
    const simplified = simplifyCollinear(input);
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
    ]);
  });

  it('forces any non-orthogonal diagonal segment into strict 90-degree bends', () => {
    const diagonal: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 150, y: 150 },
    ];
    const orthogonal = makePolylineOrthogonal(diagonal);
    // Every consecutive segment must have either dx == 0 or dy == 0
    for (let i = 0; i < orthogonal.length - 1; i++) {
      const p1 = orthogonal[i];
      const p2 = orthogonal[i + 1];
      const isHorizontal = Math.abs(p1.y - p2.y) < 0.001;
      const isVertical = Math.abs(p1.x - p2.x) < 0.001;
      expect(isHorizontal || isVertical).toBe(true);
    }
  });

  it('detects axis-aligned segment intersection with obstacle boxes', () => {
    const obstacle: Aabb = { minX: 40, minY: 40, maxX: 80, maxY: 80 };
    // Intersecting horizontal segment
    expect(
      segmentIntersectsObstacle({ x: 0, y: 60 }, { x: 100, y: 60 }, obstacle),
    ).toBe(true);
    // Non-intersecting horizontal segment (above)
    expect(
      segmentIntersectsObstacle({ x: 0, y: 20 }, { x: 100, y: 20 }, obstacle),
    ).toBe(false);
    // Intersecting vertical segment
    expect(
      segmentIntersectsObstacle({ x: 60, y: 0 }, { x: 60, y: 100 }, obstacle),
    ).toBe(true);
    // Non-intersecting vertical segment (to the right)
    expect(
      segmentIntersectsObstacle({ x: 90, y: 0 }, { x: 90, y: 100 }, obstacle),
    ).toBe(false);
  });

  it('routes clean 90-degree Manhattan path between two points without obstacles', () => {
    const start: Point = { x: 0, y: 0 };
    const end: Point = { x: 100, y: 80 };
    const route = generateOrthogonalRoute(start, end);

    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(end);

    // Verify all segments are axis-aligned
    for (let i = 0; i < route.length - 1; i++) {
      const p1 = route[i];
      const p2 = route[i + 1];
      const isH = Math.abs(p1.y - p2.y) < 0.001;
      const isV = Math.abs(p1.x - p2.x) < 0.001;
      expect(isH || isV).toBe(true);
    }

    // Interior waypoints
    const waypoints = generateOrthogonalWaypoints(start, end);
    expect(waypoints.length).toBeGreaterThanOrEqual(1);
  });

  it('routes cleanly around an obstacle positioned directly between start and end', () => {
    const start: Point = { x: 0, y: 100 };
    const end: Point = { x: 300, y: 100 };
    // Obstacle blocking direct horizontal line between start and end
    const obstacle: Aabb = { minX: 100, minY: 70, maxX: 200, maxY: 130 };

    const route = generateOrthogonalRoute(start, end, {
      obstacles: [obstacle],
      padding: 16,
    });

    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(end);

    // Ensure the generated route does NOT intersect the obstacle
    expect(polylineIntersectsObstacles(route, [obstacle])).toBe(false);

    // Ensure all segments are strictly horizontal or vertical
    for (let i = 0; i < route.length - 1; i++) {
      const p1 = route[i];
      const p2 = route[i + 1];
      const isH = Math.abs(p1.y - p2.y) < 0.001;
      const isV = Math.abs(p1.x - p2.x) < 0.001;
      expect(isH || isV).toBe(true);
    }
  });

  it('converts orthogonal polylines to rounded SVG paths', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const pathWithFillet = orthogonalPolylineToPath(points, 6);
    expect(pathWithFillet).toContain('M 0 0');
    expect(pathWithFillet).toContain('Q 100 0');
    expect(pathWithFillet).toContain('L 100 100');

    const pathWithoutFillet = orthogonalPolylineToPath(points, 0);
    expect(pathWithoutFillet).toBe('M 0 0 L 100 0 L 100 100');
  });

  it('arrowPath renders explicit waypoints when specified', () => {
    const arrow: BoardArrow = {
      id: 'a1',
      start: { x: 0, y: 0 },
      end: { x: 200, y: 200 },
      color: '#25263a',
      routing: 'orthogonal',
      waypoints: [
        { x: 100, y: 0 },
        { x: 100, y: 200 },
      ],
    };

    const d = arrowPath(arrow);
    expect(d).toContain('M 0 0');
    expect(d).toContain('Q 100 0');
    expect(d).toContain('L 200 200');
  });

  it('shares auto-routed bend points with hit-testing callers', () => {
    const nodes: Array<PortNode & { id: string }> = [
      { id: 'start', x: -40, y: 70, width: 40, height: 60 },
      { id: 'end', x: 260, y: 70, width: 40, height: 60 },
      { id: 'blocker', x: 100, y: 70, width: 100, height: 60 },
    ];
    const arrow: BoardArrow = {
      id: 'a2',
      start: { x: 0, y: 100 },
      end: { x: 260, y: 100 },
      color: '#25263a',
      startNodeId: 'start',
      endNodeId: 'end',
      routing: 'orthogonal',
    };

    const points = arrowPathPoints(arrow, nodes);
    expect(points.length).toBeGreaterThan(2);
    expect(points.some((point) => point.y !== 100)).toBe(true);
    expect(arrowPath(arrow, nodes)).toContain('M 0 100');
  });

  it('filters out frames and divider lines from routing obstacles', () => {
    const nodes: Array<PortNode & { id: string }> = [
      { id: 'frame1', x: 0, y: 0, width: 800, height: 600, shape: 'frame' },
      { id: 'line1', x: 50, y: 50, width: 100, height: 2, shape: 'line' },
      { id: 'box1', x: 100, y: 100, width: 80, height: 60, shape: 'round' },
    ];
    const obstacles = nodesToObstacles(nodes);
    expect(obstacles.length).toBe(1);
    expect(obstacles[0].minX).toBe(100);
    expect(obstacles[0].maxX).toBe(180);
  });
});
