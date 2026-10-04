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
