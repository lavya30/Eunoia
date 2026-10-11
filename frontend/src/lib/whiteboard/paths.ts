import type { BoardArrow, BoardStroke } from './board-types';
import type { Point, PortNode } from './geometry';
import {
  detectNodePortDirection,
  generateOrthogonalRoute,
  makePolylineOrthogonal,
  nodesToObstacles,
} from './geometry';

/**
 * Path builders for canvas rendering (extracted from WhiteboardPage).
 * Pure functions with no React dependencies.
 */

export function smoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1)
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;
  if (points.length === 2)
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
  }
  d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  return d;
}

/**
 * Converts a sequence of points with 90° bends into an SVG path.
 * When `cornerRadius > 0`, 90-degree corners are given subtle rounded fillet
 * arcs (like draw.io / Miro connectors) for a clean modern aesthetic.
 */
export function orthogonalPolylineToPath(
  points: Point[],
  cornerRadius = 6,
): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2)
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  if (cornerRadius <= 0) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];

    const vInX = pCurr.x - pPrev.x;
    const vInY = pCurr.y - pPrev.y;
    const lenIn = Math.hypot(vInX, vInY);

    const vOutX = pNext.x - pCurr.x;
    const vOutY = pNext.y - pCurr.y;
    const lenOut = Math.hypot(vOutX, vOutY);

    if (lenIn < 0.001 || lenOut < 0.001) {
      d += ` L ${pCurr.x} ${pCurr.y}`;
      continue;
    }

    const r = Math.min(cornerRadius, lenIn / 2, lenOut / 2);
    const startX = pCurr.x - (vInX / lenIn) * r;
    const startY = pCurr.y - (vInY / lenIn) * r;
    const endX = pCurr.x + (vOutX / lenOut) * r;
    const endY = pCurr.y + (vOutY / lenOut) * r;

    d += ` L ${startX} ${startY} Q ${pCurr.x} ${pCurr.y}, ${endX} ${endY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Returns the actual points used to render an orthogonal arrow. Keeping this
 * in one place lets hit-testing, bounds calculations, and SVG rendering agree
 * about auto-routed bends as well as explicit waypoints.
 */
export function arrowPathPoints(
  arrow: BoardArrow,
  nodes?: Array<PortNode & { id?: string }>,
): Point[] {
  if (arrow.routing !== 'orthogonal') return [arrow.start, arrow.end];

  if (arrow.waypoints && arrow.waypoints.length > 0) {
    return makePolylineOrthogonal([arrow.start, ...arrow.waypoints, arrow.end]);
  }

  const obstacles = nodes
    ? nodesToObstacles(nodes, [arrow.startNodeId ?? '', arrow.endNodeId ?? ''])
    : [];
  let startDirection: ReturnType<typeof detectNodePortDirection> | undefined;
  let endDirection: ReturnType<typeof detectNodePortDirection> | undefined;

  if (nodes) {
    if (arrow.startNodeId) {
      const startNode = nodes.find((node) => node.id === arrow.startNodeId);
      if (startNode)
        startDirection = detectNodePortDirection(startNode, arrow.start);
    }
    if (arrow.endNodeId) {
      const endNode = nodes.find((node) => node.id === arrow.endNodeId);
      if (endNode) endDirection = detectNodePortDirection(endNode, arrow.end);
    }
  }

  return generateOrthogonalRoute(arrow.start, arrow.end, {
    obstacles,
    startDirection,
    endDirection,
  });
}

/**
 * Central path router for user arrows. `straight` is the legacy `M…L`
 * segment; `orthogonal` uses Manhattan routing with obstacle avoidance and
 * waypoints; `curved` emits a cubic with control points offset
 * perpendicular to the chord for a gentle arc.
 */
export function arrowPath(
  arrow: BoardArrow,
  nodes?: Array<PortNode & { id?: string }>,
): string {
  const { start, end } = arrow;
  const routing = arrow.routing ?? 'straight';
  if (routing === 'orthogonal') {
    return orthogonalPolylineToPath(arrowPathPoints(arrow, nodes), 6);
  }
  if (routing === 'curved') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular bow, scaled by chord length and capped for stability.
    const bow = Math.min(60, len * 0.18);
    const nx = -dy / len;
    const ny = dx / len;
    const c1x = start.x + dx * 0.3 + nx * bow;
    const c1y = start.y + dy * 0.3 + ny * bow;
    const c2x = start.x + dx * 0.7 + nx * bow;
    const c2y = start.y + dy * 0.7 + ny * bow;
    return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
  }
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * Variable-width ink outline for a freehand stroke. Uses the brush size
 * and per-point pressure to build a tapered polygon; falls back to the
 * legacy uniform centerline smoothing when no pressure data exists so old
 * boards render identically.
 */
export function inkOutlinePath(stroke: BoardStroke): string {
  const points = stroke.points;
  if (points.length === 0) return '';
  const brushSize = stroke.brushSize ?? 6;
  const hasPressure = points.some(
    (p) => typeof p.pressure === 'number' && Number.isFinite(p.pressure),
  );
  if (!hasPressure) return smoothPath(points);
  const halfWidths = points.map((p) => {
    const pressure =
      typeof p.pressure === 'number' && Number.isFinite(p.pressure)
        ? Math.min(1, Math.max(0, p.pressure))
        : 0.5;
    // Taper: light touches draw thin, full pressure draws the full brush.
    return (brushSize * (0.25 + 0.75 * pressure)) / 2;
  });
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) {
      dx = 0;
      dy = 1;
    } else {
      dx /= len;
      dy /= len;
    }
    const nx = -dy;
    const ny = dx;
    const hw = halfWidths[i];
    left.push(`${points[i].x + nx * hw} ${points[i].y + ny * hw}`);
    right.push(`${points[i].x - nx * hw} ${points[i].y - ny * hw}`);
  }
  if (left.length === 1) {
    // Single dot: render a small filled blob instead of a degenerate line.
    const [cx, cy] = left[0].split(' ').map(Number);
    const r = halfWidths[0];
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  return `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`;
}
