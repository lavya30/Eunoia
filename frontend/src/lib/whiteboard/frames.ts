import type {
  BoardArrow,
  BoardNode,
  BoardStroke,
  FrameAspectRatio,
} from './board-types';
import type { Camera, Viewport } from './geometry';
import { clamp } from './geometry';

export interface FramePreset {
  id: FrameAspectRatio;
  label: string;
  width: number;
  height: number;
}

export const FRAME_PRESETS: FramePreset[] = [
  { id: '16:9', label: '16:9 Presentation', width: 1920, height: 1080 },
  { id: '4:3', label: '4:3 Standard', width: 1600, height: 1200 },
  { id: '1:1', label: '1:1 Square', width: 1200, height: 1200 },
];

/**
 * Filter and sort frames into presentation sequence.
 * Honors explicit `frameIndex` first; ties fall back to spatial reading
 * order (top-to-bottom bands, left-to-right).
 */
export function sortFrames(nodes: BoardNode[]): BoardNode[] {
  const frames = nodes.filter((node) => node.shape === 'frame');
  return [...frames].sort((a, b) => {
    if (a.frameIndex !== undefined && b.frameIndex !== undefined) {
      if (a.frameIndex !== b.frameIndex) return a.frameIndex - b.frameIndex;
    } else if (a.frameIndex !== undefined) {
      return -1;
    } else if (b.frameIndex !== undefined) {
      return 1;
    }
    // Spatial ordering: group in 120px vertical bands, then sort horizontally
    const bandA = Math.round(a.y / 120);
    const bandB = Math.round(b.y / 120);
    if (bandA !== bandB) return bandA - bandB;
    return a.x - b.x;
  });
}

/**
 * 1-based slide index of a frame within the presentation sequence.
 */
export function getFrameSlideIndex(
  frameId: string,
  allNodes: BoardNode[],
): number {
  const sorted = sortFrames(allNodes);
  const idx = sorted.findIndex((f) => f.id === frameId);
  return idx >= 0 ? idx + 1 : 1;
}

/**
 * Checks whether an element's center point is strictly inside a frame boundary.
 */
export function isNodeInFrame(node: BoardNode, frame: BoardNode): boolean {
  if (node.id === frame.id || node.shape === 'frame') return false;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return (
    cx >= frame.x &&
    cx <= frame.x + frame.width &&
    cy >= frame.y &&
    cy <= frame.y + frame.height
  );
}

export function isArrowInFrame(arrow: BoardArrow, frame: BoardNode): boolean {
  const fx2 = frame.x + frame.width;
  const fy2 = frame.y + frame.height;
  return (
    arrow.start.x >= frame.x &&
    arrow.start.x <= fx2 &&
    arrow.start.y >= frame.y &&
    arrow.start.y <= fy2 &&
    arrow.end.x >= frame.x &&
    arrow.end.x <= fx2 &&
    arrow.end.y >= frame.y &&
    arrow.end.y <= fy2
  );
}

export function isStrokeInFrame(stroke: BoardStroke, frame: BoardNode): boolean {
  if (!stroke.points || stroke.points.length === 0) return false;
  const fx2 = frame.x + frame.width;
  const fy2 = frame.y + frame.height;
  // All points must be within frame bounds for full containment
  for (const pt of stroke.points) {
    if (pt.x < frame.x || pt.x > fx2 || pt.y < frame.y || pt.y > fy2) {
      return false;
    }
  }
  return true;
}

/**
 * Returns all child node, arrow, and stroke IDs strictly contained within a frame.
 */
export function getContainedElements(
  frame: BoardNode,
  nodes: BoardNode[],
  arrows: BoardArrow[],
  strokes: BoardStroke[],
): {
  nodeIds: string[];
  arrowIds: string[];
  strokeIds: string[];
} {
  return {
    nodeIds: nodes.filter((n) => isNodeInFrame(n, frame)).map((n) => n.id),
    arrowIds: arrows.filter((a) => isArrowInFrame(a, frame)).map((a) => a.id),
    strokeIds: strokes.filter((s) => isStrokeInFrame(s, frame)).map((s) => s.id),
  };
}

/**
 * Compute optimal camera focus to fit a frame into the active viewport with padding.
 */
export function getFrameCamera(
  frame: BoardNode,
  viewport: Viewport,
  padding = 56,
): Camera {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const availW = Math.max(100, viewport.width - padding * 2);
  const availH = Math.max(100, viewport.height - padding * 2);
  const fitZoom = Math.min(availW / frame.width, availH / frame.height);
  const zoom = clamp(fitZoom, 0.25, 2.0);
  return {
    x: cx,
    y: cy,
    zoom,
  };
}
