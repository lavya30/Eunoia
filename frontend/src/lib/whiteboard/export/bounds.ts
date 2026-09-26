import type { BoardArrow, BoardNode, BoardStroke } from '../board-types';
import { rotatedNodeAabb, unionAabbs, type Aabb } from '../geometry';

export type ContentBounds = Aabb & { width: number; height: number };

const FALLBACK_BOUNDS: ContentBounds = {
  minX: 0,
  minY: 0,
  maxX: 1200,
  maxY: 700,
  width: 1200,
  height: 700,
};

/**
 * Union of all drawable content in world units. Rotation-aware for nodes,
 * endpoint-aware for arrows, point-aware for freehand strokes. Used by
 * PNG/PDF/GIF so exports cover the full board instead of the viewport.
 */
export function contentBounds(
  nodes: BoardNode[],
  arrows: BoardArrow[],
  strokes: BoardStroke[],
  padding = 48,
): ContentBounds {
  const boxes: Aabb[] = [];
  for (const node of nodes) {
    boxes.push(
      rotatedNodeAabb(
        node.x,
        node.y,
        Math.max(1, node.width),
        Math.max(1, node.height),
        node.rotation,
      ),
    );
  }
  for (const arrow of arrows) {
    boxes.push({
      minX: Math.min(arrow.start.x, arrow.end.x) - 8,
      minY: Math.min(arrow.start.y, arrow.end.y) - 8,
      maxX: Math.max(arrow.start.x, arrow.end.x) + 8,
      maxY: Math.max(arrow.start.y, arrow.end.y) + 8,
    });
  }
  for (const stroke of strokes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of stroke.points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    if (Number.isFinite(minX)) {
      const radius = Math.max(4, (stroke.brushSize ?? 6) / 2);
      boxes.push({
        minX: minX - radius,
        minY: minY - radius,
        maxX: maxX + radius,
        maxY: maxY + radius,
      });
    }
  }
  const union = unionAabbs(boxes);
  if (!union) return FALLBACK_BOUNDS;
  const minX = Math.floor(union.minX - padding);
  const minY = Math.floor(union.minY - padding);
  const maxX = Math.ceil(union.maxX + padding);
  const maxY = Math.ceil(union.maxY + padding);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
