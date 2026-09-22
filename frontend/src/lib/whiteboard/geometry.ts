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
