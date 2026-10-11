export type Point = {
  x: number;
  y: number;
};

export type Aabb = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export type Viewport = {
  width: number;
  height: number;
};

export type ViewBox = Aabb & {
  width: number;
  height: number;
};

export const WORLD_VIEWPORT: Viewport = {
  width: 1200,
  height: 700,
};

export const INITIAL_CAMERA: Camera = {
  x: 600,
  y: 350,
  zoom: 0.82,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cameraViewBox(camera: Camera, viewport: Viewport): ViewBox {
  const width = viewport.width / camera.zoom;
  const height = viewport.height / camera.zoom;
  const minX = camera.x - width / 2;
  const minY = camera.y - height / 2;

  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
    width,
    height,
  };
}

export function screenToWorld(
  point: Point,
  camera: Camera,
  viewport: Viewport,
): Point {
  return {
    x: camera.x + (point.x - viewport.width / 2) / camera.zoom,
    y: camera.y + (point.y - viewport.height / 2) / camera.zoom,
  };
}

export function worldToScreen(
  point: Point,
  camera: Camera,
  viewport: Viewport,
): Point {
  return {
    x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function zoomCameraAtPoint(
  camera: Camera,
  screenPoint: Point,
  delta: number,
  viewport: Viewport,
): Camera {
  const nextZoom = clamp(camera.zoom + delta, 0.35, 2.2);
  const worldPoint = screenToWorld(screenPoint, camera, viewport);
  const screenCenter = {
    x: viewport.width / 2,
    y: viewport.height / 2,
  };

  return {
    x: worldPoint.x - (screenPoint.x - screenCenter.x) / nextZoom,
    y: worldPoint.y - (screenPoint.y - screenCenter.y) / nextZoom,
    zoom: nextZoom,
  };
}

export function panCamera(camera: Camera, screenDelta: Point): Camera {
  return {
    ...camera,
    x: camera.x - screenDelta.x / camera.zoom,
    y: camera.y - screenDelta.y / camera.zoom,
  };
}

export function snapPoint(point: Point, gridSize = 8): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/** Default magnetic snap radius in world units for port snapping. */
export const PORT_SNAP_RADIUS = 18;

export type NodePort = {
  /** Stable port id within the node (`n`, `e`, `s`, `w`, `ne`, …). */
  id: string;
  x: number;
  y: number;
};

/** Minimal node-like shape for port computation (avoids a board-types import). */
export type PortNode = {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: string;
  rotation?: number;
};

/**
 * Magnetic connection ports for a node. Rectangles expose 8 ports
 * (midpoints + corners); ellipses/diamonds expose the 4 cardinal points;
 * `line` dividers expose their two ends; everything else falls back to
 * the 4 midpoints. Ports rotate with the node.
 */
export function getNodePorts(node: PortNode): NodePort[] {
  // Frames are slide containers, never connector endpoints.
  if (node.shape === 'frame') return [];
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hw = node.width / 2;
  const hh = node.height / 2;
  let ports: NodePort[];
  if (node.shape === 'line') {
    ports = [
      { id: 'w', x: node.x, y: cy },
      { id: 'e', x: node.x + node.width, y: cy },
    ];
  } else {
    const cardinals: NodePort[] = [
      { id: 'n', x: cx, y: cy - hh },
      { id: 'e', x: cx + hw, y: cy },
      { id: 's', x: cx, y: cy + hh },
      { id: 'w', x: cx - hw, y: cy },
    ];
    if (node.shape === 'ellipse' || node.shape === 'diamond') {
      ports = cardinals;
    } else {
      ports = [
        ...cardinals,
        { id: 'ne', x: cx + hw, y: cy - hh },
        { id: 'se', x: cx + hw, y: cy + hh },
        { id: 'sw', x: cx - hw, y: cy + hh },
        { id: 'nw', x: cx - hw, y: cy - hh },
      ];
    }
  }
  const rotation = normalizeRotation(node.rotation ?? 0);
  if (rotation === 0) return ports;
  const center = { x: cx, y: cy };
  const angleRad = degToRad(rotation);
  return ports.map((port) => ({
    ...port,
    ...rotatePoint(port, center, angleRad),
  }));
}

export type PortSnapHit<T extends { id: string } = { id: string }> = {
  node: T;
  port: NodePort;
  distance: number;
};

/**
 * Magnetic snap: nearest node port within `radius` world units of `point`.
 * Optionally excludes one node (e.g. the node an arrow starts from is still
 * eligible — exclusion is for the element being created, which has no id
 * yet, so it defaults to no exclusion).
 */
export function nearestPort<T extends PortNode & { id: string }>(
  point: Point,
  nodes: T[],
  radius = PORT_SNAP_RADIUS,
  excludeId?: string,
): PortSnapHit<T> | null {
  let best: PortSnapHit<T> | null = null;
  for (const node of nodes) {
    if (excludeId !== undefined && node.id === excludeId) continue;
    for (const port of getNodePorts(node)) {
      const distance = Math.hypot(point.x - port.x, point.y - port.y);
      if (distance <= radius && (!best || distance < best.distance)) {
        best = { node, port, distance };
      }
    }
  }
  return best;
}

export function aabbFromRect(
  x: number,
  y: number,
  width: number,
  height: number,
): Aabb {
  return {
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  };
}

export function aabbIntersects(first: Aabb, second: Aabb): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

export function aabbContainsPoint(bounds: Aabb, point: Point): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

export function unionAabbs(bounds: Aabb[]): Aabb | null {
  if (bounds.length === 0) return null;

  return bounds.reduce(
    (union, current) => ({
      minX: Math.min(union.minX, current.minX),
      minY: Math.min(union.minY, current.minY),
      maxX: Math.max(union.maxX, current.maxX),
      maxY: Math.max(union.maxY, current.maxY),
    }),
    bounds[0],
  );
}

export function resizeAabb(
  bounds: Aabb,
  handle: string,
  point: Point,
  lockAspectRatio = false,
): Aabb {
  const next = { ...bounds };

  if (handle.includes('w')) next.minX = Math.min(point.x, bounds.maxX - 16);
  if (handle.includes('e')) next.maxX = Math.max(point.x, bounds.minX + 16);
  if (handle.includes('n')) next.minY = Math.min(point.y, bounds.maxY - 16);
  if (handle.includes('s')) next.maxY = Math.max(point.y, bounds.minY + 16);

  if (lockAspectRatio) {
    const width = next.maxX - next.minX;
    const height = next.maxY - next.minY;
    const ratio = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);

    if (Math.abs(width - height * ratio) > 0.001) {
      if (handle.includes('e') || handle.includes('w')) {
        const adjustedHeight = width / ratio;
        next.maxY = next.minY + adjustedHeight;
      } else {
        const adjustedWidth = height * ratio;
        next.maxX = next.minX + adjustedWidth;
      }
    }
  }

  return next;
}

export function resizeHandles(bounds: Aabb): Array<Point & { id: string }> {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return [
    { id: 'nw', x: bounds.minX, y: bounds.minY },
    { id: 'n', x: centerX, y: bounds.minY },
    { id: 'ne', x: bounds.maxX, y: bounds.minY },
    { id: 'e', x: bounds.maxX, y: centerY },
    { id: 'se', x: bounds.maxX, y: bounds.maxY },
    { id: 's', x: centerX, y: bounds.maxY },
    { id: 'sw', x: bounds.minX, y: bounds.maxY },
    { id: 'w', x: bounds.minX, y: centerY },
  ];
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Normalize degrees into [0, 360). */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees % 360) + 360) % 360;
}

/** Snap degrees to the nearest multiple of `step` (default 15°). */
export function snapAngle(degrees: number, step = 15): number {
  return Math.round(degrees / step) * step;
}

/** Rotate point `p` around `center` by `angleRad` (counter-clockwise positive). */
export function rotatePoint(p: Point, center: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Angle in radians of the vector from `center` to `p` (atan2 convention). */
export function angleOfPoint(p: Point, center: Point): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

/**
 * Axis-aligned bounding box of a node after applying its `rotation`
 * (degrees, clockwise in screen space) around its center.
 */
export function rotatedNodeAabb(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation?: number,
): Aabb {
  const normalized = normalizeRotation(rotation ?? 0);
  if (normalized === 0) return aabbFromRect(x, y, width, height);
  const center = { x: x + width / 2, y: y + height / 2 };
  const angleRad = degToRad(normalized);
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map((corner) => rotatePoint(corner, center, angleRad));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY };
}

export type AlignType =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export type DistributeAxis = 'horizontal' | 'vertical';

export type AlignableNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
};

/**
 * Aligns a collection of nodes along a bounding-box edge or centerline.
 */
export function alignNodes<T extends AlignableNode>(
  nodes: T[],
  type: AlignType,
): T[] {
  if (nodes.length < 2) return nodes.slice();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y < minY) minY = n.y;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return nodes.map((node) => {
    switch (type) {
      case 'left':
        return { ...node, x: minX };
      case 'center':
        return { ...node, x: Math.round(centerX - node.width / 2) };
      case 'right':
        return { ...node, x: maxX - node.width };
      case 'top':
        return { ...node, y: minY };
      case 'middle':
        return { ...node, y: Math.round(centerY - node.height / 2) };
      case 'bottom':
        return { ...node, y: maxY - node.height };
    }
  });
}

/**
 * Distributes nodes evenly along the horizontal or vertical axis between
 * the outer boundaries of the selection.
 */
export function distributeNodes<T extends AlignableNode>(
  nodes: T[],
  axis: DistributeAxis,
): T[] {
  if (nodes.length < 3) return nodes.slice();

  if (axis === 'horizontal') {
    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.x + last.width - first.x;
    const totalNodeWidth = sorted.reduce((sum, n) => sum + n.width, 0);
    const totalGap = totalSpan - totalNodeWidth;
    const gap = totalGap / (sorted.length - 1);

    let currentX = first.x;
    const updated = new Map<string, number>();
    for (const node of sorted) {
      updated.set(node.id, Math.round(currentX));
      currentX += node.width + gap;
    }
    return nodes.map((n) => ({
      ...n,
      x: updated.get(n.id) ?? n.x,
    }));
  } else {
    const sorted = [...nodes].sort((a, b) => a.y - b.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan = last.y + last.height - first.y;
    const totalNodeHeight = sorted.reduce((sum, n) => sum + n.height, 0);
    const totalGap = totalSpan - totalNodeHeight;
    const gap = totalGap / (sorted.length - 1);

    let currentY = first.y;
    const updated = new Map<string, number>();
    for (const node of sorted) {
      updated.set(node.id, Math.round(currentY));
      currentY += node.height + gap;
    }
    return nodes.map((n) => ({
      ...n,
      y: updated.get(n.id) ?? n.y,
    }));
  }
}

// ---------------------------------------------------------------------------
// Orthogonal Connector Manhattan Routing & Obstacle Avoidance
// ---------------------------------------------------------------------------

export type OrthogonalDirection = 'n' | 's' | 'e' | 'w';

export type OrthogonalRoutingOptions = {
  /** Obstacles to route around (bounding boxes in world coordinates). */
  obstacles?: Aabb[];
  /** Obstacle clearance margin in world units. Defaults to 16. */
  padding?: number;
  /** Direction leaving the start port/node. */
  startDirection?: OrthogonalDirection;
  /** Direction entering the end port/node. */
  endDirection?: OrthogonalDirection;
  /** Initial straight stub extending from port before bending. Defaults to 20. */
  stubLength?: number;
};

/** Convert cardinal direction to 2D unit normal vector. */
export function directionToVector(dir: OrthogonalDirection): Point {
  switch (dir) {
    case 'n':
      return { x: 0, y: -1 };
    case 's':
      return { x: 0, y: 1 };
    case 'e':
      return { x: 1, y: 0 };
    case 'w':
      return { x: -1, y: 0 };
  }
}

/**
 * Detects which face/side ('n', 's', 'e', 'w') of a node a given anchor
 * point is closest to, based on normal angle from node center.
 */
export function detectNodePortDirection(
  node: PortNode,
  point: Point,
): OrthogonalDirection {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hw = Math.max(1, node.width / 2);
  const hh = Math.max(1, node.height / 2);
  const dx = point.x - cx;
  const dy = point.y - cy;
  if (Math.abs(dx) / hw >= Math.abs(dy) / hh) {
    return dx >= 0 ? 'e' : 'w';
  }
  return dy >= 0 ? 's' : 'n';
}

/**
 * Converts canvas nodes into inflated bounding box obstacles for routing,
 * excluding containers (frames) and line dividers.
 */
export function nodesToObstacles(
  nodes: Array<PortNode & { id?: string }>,
  excludeIds?: string[],
): Aabb[] {
  const excludeSet = new Set(excludeIds ?? []);
  return nodes
    .filter(
      (n) =>
        !excludeSet.has(n.id ?? '') &&
        n.shape !== 'frame' &&
        n.shape !== 'line',
    )
    .map((n) => rotatedNodeAabb(n.x, n.y, n.width, n.height, n.rotation));
}

/** Test whether an axis-aligned line segment penetrates an obstacle box. */
export function segmentIntersectsObstacle(
  p1: Point,
  p2: Point,
  box: Aabb,
): boolean {
  // If segment is horizontal
  if (Math.abs(p1.y - p2.y) < 0.001) {
    const y = p1.y;
    if (y <= box.minY || y >= box.maxY) return false;
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    return maxX > box.minX && minX < box.maxX;
  }
  // If segment is vertical
  if (Math.abs(p1.x - p2.x) < 0.001) {
    const x = p1.x;
    if (x <= box.minX || x >= box.maxX) return false;
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    return maxY > box.minY && minY < box.maxY;
  }
  // Diagonal segment (for arbitrary fallback lines): AABB line-clipping
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  return (
    maxX > box.minX && minX < box.maxX && maxY > box.minY && minY < box.maxY
  );
}

/** Check if a candidate polyline collides with any obstacle. */
export function polylineIntersectsObstacles(
  points: Point[],
  obstacles: Aabb[],
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    for (const obs of obstacles) {
      if (segmentIntersectsObstacle(p1, p2, obs)) return true;
    }
  }
  return false;
}

/**
 * Removes duplicate points and intermediate points lying on the same
 * horizontal or vertical line, leaving only the essential 90° bend points.
 */
export function simplifyCollinear(points: Point[]): Point[] {
  if (points.length <= 2) return points.slice();

  // Step 1: Remove consecutive near-identical points
  const deduped: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 0.5) {
      deduped.push(curr);
    }
  }
  if (deduped.length <= 2) return deduped;

  // Step 2: Remove redundant collinear points
  const simplified: Point[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const pPrev = simplified[simplified.length - 1];
    const pCurr = deduped[i];
    const pNext = deduped[i + 1];

    const isCollinearH =
      Math.abs(pPrev.y - pCurr.y) < 0.5 && Math.abs(pCurr.y - pNext.y) < 0.5;
    const isCollinearV =
      Math.abs(pPrev.x - pCurr.x) < 0.5 && Math.abs(pCurr.x - pNext.x) < 0.5;

    if (!isCollinearH && !isCollinearV) {
      simplified.push(pCurr);
    }
  }
  simplified.push(deduped[deduped.length - 1]);
  return simplified;
}

/**
 * Ensures any arbitrary sequence of points is connected exclusively by
 * axis-aligned (horizontal and vertical) segments with 90° bends.
 */
export function makePolylineOrthogonal(points: Point[]): Point[] {
  if (points.length <= 1) return points.slice();
  const orthogonal: Point[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);

    if (dx < 0.5 || dy < 0.5) {
      orthogonal.push(p2);
    } else {
      // Connect with an intermediate orthogonal elbow
      if (dx >= dy) {
        orthogonal.push({ x: p2.x, y: p1.y });
      } else {
        orthogonal.push({ x: p1.x, y: p2.y });
      }
      orthogonal.push(p2);
    }
  }
  return simplifyCollinear(orthogonal);
}

/**
 * Manhattan Router with Obstacle Avoidance.
 *
 * Employs a Hanan grid routing space with A* search and turn-penalty
 * optimization to calculate clean, professional orthogonal connector paths
 * with 90-degree bends around shapes.
 *
 * @returns Array of points [start, ...waypoints, end] representing the full route.
 */
export function generateOrthogonalRoute(
  start: Point,
  end: Point,
  options?: OrthogonalRoutingOptions,
): Point[] {
  // If points coincide or already align on an axis with no obstacles
  if (Math.abs(start.x - end.x) < 0.5 && Math.abs(start.y - end.y) < 0.5) {
    return [start, end];
  }

  const padding = options?.padding ?? 16;
  const stubLength = options?.stubLength ?? 20;

  // Stubs extend perpendicular to node ports before turning
  let sStub = start;
  if (options?.startDirection) {
    const sv = directionToVector(options.startDirection);
    sStub = {
      x: start.x + sv.x * stubLength,
      y: start.y + sv.y * stubLength,
    };
  }

  let eStub = end;
  if (options?.endDirection) {
    const ev = directionToVector(options.endDirection);
    eStub = {
      x: end.x + ev.x * stubLength,
      y: end.y + ev.y * stubLength,
    };
  }

  const rawObstacles = options?.obstacles ?? [];
  // Inflate obstacles by the safety padding margin
  const inflatedObstacles: Aabb[] = [];
  const searchBounds: Aabb = {
    minX: Math.min(start.x, end.x, sStub.x, eStub.x) - 160,
    minY: Math.min(start.y, end.y, sStub.y, eStub.y) - 160,
    maxX: Math.max(start.x, end.x, sStub.x, eStub.x) + 160,
    maxY: Math.max(start.y, end.y, sStub.y, eStub.y) + 160,
  };

  for (const obs of rawObstacles) {
    if (aabbIntersects(searchBounds, obs)) {
      inflatedObstacles.push({
        minX: obs.minX - padding,
        minY: obs.minY - padding,
        maxX: obs.maxX + padding,
        maxY: obs.maxY + padding,
      });
    }
  }

  // Quick check: if simple direct routes have 0 obstacle collisions, use them!
  const midX = (sStub.x + eStub.x) / 2;
  const midY = (sStub.y + eStub.y) / 2;

  // Prefer orientation matching stub directions:
  // e/w stubs prefer horizontal-first; n/s stubs prefer vertical-first.
  const preferHorizontalFirst =
    options?.startDirection === 'e' ||
    options?.startDirection === 'w' ||
    (!options?.startDirection &&
      Math.abs(end.x - start.x) >= Math.abs(end.y - start.y));

  const candidateA: Point[] = simplifyCollinear([
    start,
    sStub,
    { x: midX, y: sStub.y },
    { x: midX, y: eStub.y },
    eStub,
    end,
  ]);

  const candidateB: Point[] = simplifyCollinear([
    start,
    sStub,
    { x: sStub.x, y: midY },
    { x: eStub.x, y: midY },
    eStub,
    end,
  ]);

  const candidateC: Point[] = simplifyCollinear([
    start,
    sStub,
    { x: eStub.x, y: sStub.y },
    eStub,
    end,
  ]);

  const candidateD: Point[] = simplifyCollinear([
    start,
    sStub,
    { x: sStub.x, y: eStub.y },
    eStub,
    end,
  ]);

  const candidates = preferHorizontalFirst
    ? [candidateA, candidateC, candidateB, candidateD]
    : [candidateB, candidateD, candidateA, candidateC];

  for (const cand of candidates) {
    if (!polylineIntersectsObstacles(cand, inflatedObstacles)) {
      return cand;
    }
  }

  // If no simple candidate is obstacle-free, run A* on the Hanan grid
  const xs: number[] = [start.x, end.x, sStub.x, eStub.x, midX];
  const ys: number[] = [start.y, end.y, sStub.y, eStub.y, midY];

  for (const obs of inflatedObstacles) {
    xs.push(obs.minX, obs.maxX, (obs.minX + obs.maxX) / 2);
    ys.push(obs.minY, obs.maxY, (obs.minY + obs.maxY) / 2);
  }

  // Deduplicate coordinates within a 2px tolerance
  const dedupeCoords = (coords: number[]): number[] => {
    const sorted = [...coords].sort((a, b) => a - b);
    const result: number[] = [];
    for (const c of sorted) {
      if (result.length === 0 || Math.abs(c - result[result.length - 1]) > 2) {
        result.push(c);
      }
    }
    return result;
  };

  const gridX = dedupeCoords(xs);
  const gridY = dedupeCoords(ys);
  const W = gridX.length;
  const H = gridY.length;

  if (W === 0 || H === 0) {
    return candidateA;
  }

  // Find nearest grid indices for sStub and eStub
  const findClosestGridIndex = (pt: Point): { ix: number; iy: number } => {
    let bestIx = 0;
    let bestDistX = Infinity;
    for (let i = 0; i < W; i++) {
      const d = Math.abs(gridX[i] - pt.x);
      if (d < bestDistX) {
        bestDistX = d;
        bestIx = i;
      }
    }
    let bestIy = 0;
    let bestDistY = Infinity;
    for (let j = 0; j < H; j++) {
      const d = Math.abs(gridY[j] - pt.y);
      if (d < bestDistY) {
        bestDistY = d;
        bestIy = j;
      }
    }
    return { ix: bestIx, iy: bestIy };
  };

  const startIdx = findClosestGridIndex(sStub);
  const goalIdx = findClosestGridIndex(eStub);

  const startKey = startIdx.iy * W + startIdx.ix;
  const goalKey = goalIdx.iy * W + goalIdx.ix;

  type AStarNode = {
    key: number;
    ix: number;
    iy: number;
    dir: 'h' | 'v' | 'none';
    g: number;
    f: number;
  };

  const BEND_PENALTY = 35;
  const gScores = new Map<number, number>();
  const parents = new Map<
    number,
    { key: number; ix: number; iy: number; dir: 'h' | 'v' }
  >();

  gScores.set(startKey, 0);

  // Min-priority queue
  const openSet: AStarNode[] = [
    {
      key: startKey,
      ix: startIdx.ix,
      iy: startIdx.iy,
      dir: 'none',
      g: 0,
      f:
        Math.abs(gridX[goalIdx.ix] - gridX[startIdx.ix]) +
        Math.abs(gridY[goalIdx.iy] - gridY[startIdx.iy]),
    },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 600;
  let found = false;

  while (openSet.length > 0 && iterations++ < MAX_ITERATIONS) {
    // Pop min f
    let minIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[minIdx].f) {
        minIdx = i;
      }
    }
    const current = openSet.splice(minIdx, 1)[0];

    if (current.key === goalKey) {
      found = true;
      break;
    }

    if (current.g > (gScores.get(current.key) ?? Infinity)) {
      continue;
    }

    // Neighbors: left, right, up, down
    const neighbors = [
      { ix: current.ix + 1, iy: current.iy, dir: 'h' as const },
      { ix: current.ix - 1, iy: current.iy, dir: 'h' as const },
      { ix: current.ix, iy: current.iy + 1, dir: 'v' as const },
      { ix: current.ix, iy: current.iy - 1, dir: 'v' as const },
    ];

    const currentPt: Point = {
      x: gridX[current.ix],
      y: gridY[current.iy],
    };

    for (const nb of neighbors) {
      if (nb.ix < 0 || nb.ix >= W || nb.iy < 0 || nb.iy >= H) continue;

      const neighborPt: Point = {
        x: gridX[nb.ix],
        y: gridY[nb.iy],
      };

      // Check collision with inflated obstacles
      let collides = false;
      for (const obs of inflatedObstacles) {
        if (segmentIntersectsObstacle(currentPt, neighborPt, obs)) {
          collides = true;
          break;
        }
      }
      if (collides) continue;

      const stepDist =
        Math.abs(neighborPt.x - currentPt.x) +
        Math.abs(neighborPt.y - currentPt.y);
      const isTurn = current.dir !== 'none' && current.dir !== nb.dir;
      const turnCost = isTurn ? BEND_PENALTY : 0;
      const tentativeG = current.g + stepDist + turnCost;

      const neighborKey = nb.iy * W + nb.ix;
      if (tentativeG < (gScores.get(neighborKey) ?? Infinity)) {
        gScores.set(neighborKey, tentativeG);
        parents.set(neighborKey, {
          key: current.key,
          ix: current.ix,
          iy: current.iy,
          dir: nb.dir,
        });

        const h =
          Math.abs(gridX[goalIdx.ix] - neighborPt.x) +
          Math.abs(gridY[goalIdx.iy] - neighborPt.y);
        openSet.push({
          key: neighborKey,
          ix: nb.ix,
          iy: nb.iy,
          dir: nb.dir,
          g: tentativeG,
          f: tentativeG + h,
        });
      }
    }
  }

  if (found) {
    const path: Point[] = [{ x: gridX[goalIdx.ix], y: gridY[goalIdx.iy] }];
    let currKey = goalKey;
    while (currKey !== startKey) {
      const parent = parents.get(currKey);
      if (!parent) break;
      path.push({ x: gridX[parent.ix], y: gridY[parent.iy] });
      currKey = parent.key;
    }
    path.reverse();

    const fullRoute: Point[] = [start, sStub, ...path, eStub, end];
    return simplifyCollinear(fullRoute);
  }

  // Fallback to candidate A if Hanan grid is blocked
  return candidateA;
}

/**
 * Calculates intermediate 90-degree bend waypoints between start and end.
 * Returns only the internal waypoints (excluding start and end).
 */
export function generateOrthogonalWaypoints(
  start: Point,
  end: Point,
  options?: OrthogonalRoutingOptions,
): Point[] {
  const route = generateOrthogonalRoute(start, end, options);
  if (route.length <= 2) return [];
  return route.slice(1, -1);
}
