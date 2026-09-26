'use client';

import { D2Editor } from '@/components/editor';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  Code2,
  Cloud,
  Download,
  Ellipsis,
  Hand,
  Image as ImageIcon,
  Layers2,
  Sparkles,
  LockKeyhole,
  Maximize2,
  Minus,
  MousePointer2,
  PanelRight,
  Pencil,
  Redo2,
  RotateCcw,
  Search,
  Share2,
  Square,
  StickyNote,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type ChangeEvent as ReactChangeEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  aabbIntersects,
  angleOfPoint,
  cameraViewBox,
  degToRad,
  INITIAL_CAMERA,
  normalizeRotation,
  panCamera,
  resizeAabb,
  resizeHandles,
  rotatedNodeAabb,
  rotatePoint,
  screenToWorld,
  snapAngle,
  worldToScreen,
  snapPoint,
  unionAabbs,
  WORLD_VIEWPORT,
  zoomCameraAtPoint,
  type Aabb,
  type Camera,
  type Point,
} from '@/lib/whiteboard/geometry';
import { SpatialIndex } from '@/lib/whiteboard/spatial-index';
import type {
  ArrowRouting,
  BoardArrow,
  BoardNode,
  BoardStroke,
  InkPoint,
} from '@/lib/whiteboard/board-types';
import {
  applyEntryValues,
  diffBoardSnapshots,
  invertUndoEntry,
  MAX_UNDO_ENTRIES,
  type BoardSnapshot,
  type UndoEntry,
} from '@/lib/whiteboard/undo';
import {
  parseCompileResponse,
  reconcileDiagram,
} from '@/lib/whiteboard/d2-adapter';
import {
  createBoardSync,
  resolveSyncHttpUrl,
  resolveSyncServerUrl,
  type PeerInfo,
  type SyncBoardState,
  type SyncStatus,
} from '@/lib/whiteboard/sync';
import {
  ApiError,
  confirmImageUpload,
  createRoom,
  deleteRoom,
  freshImageUrl,
  getRoom,
  isRoomLocked,
  isRoomNotFound,
  requestImageUpload,
  uploadImageBytes,
  type RoomMetadata,
} from '@/lib/whiteboard/rooms-api';
import {
  buildInviteLink,
  clearTicket,
  getTicket,
  ingestTicketDeepLink,
} from '@/lib/whiteboard/tickets';
import {
  clearSession,
  loadSession,
  type AuthSession,
} from '@/lib/whiteboard/auth';
import { CreateRoomDialog, UnlockDialog } from './RoomDialogs';
import { WorkspacePanel } from './WorkspacePanel';
import { RemoteCursors } from './RemoteCursors';
import { RoomSettingsDialog } from './RoomSettingsDialog';
import { HistoryPanel } from './HistoryPanel';
import { SearchPalette } from './SearchPalette';
import { contentBounds } from '@/lib/whiteboard/export/bounds';
import {
  cloneBoardSvg,
  downloadBlob,
  serializeSvg,
  svgStringToPngBlob,
} from '@/lib/whiteboard/export/pipeline';
import { embedRemoteImages } from '@/lib/whiteboard/export/embed-images';
import { isProTier } from '@/lib/whiteboard/export/tier';
import {
  THUMB_CAPTURE_DEBOUNCE_MS,
  captureThumbnailBlob,
  pruneOldThumbnails,
  thumbnailContentHash,
  uploadThumbnail,
} from '@/lib/whiteboard/export/thumbnail';
import { getRecentRooms, recordRoomVisit } from '@/lib/whiteboard/recent-rooms';
import './board.css';

type ToolId =
  | 'select'
  | 'hand'
  | 'note'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'draw'
  | 'text';

type Interaction =
  | { kind: 'pan'; pointerId: number; lastScreen: Point }
  | {
      kind: 'drag';
      pointerId: number;
      startWorld: Point;
      originNodes: Array<{ id: string; x: number; y: number }>;
      originArrows: Array<{ id: string; start: Point; end: Point }>;
      originStrokes: Array<{ id: string; points: InkPoint[] }>;
    }
  | {
      kind: 'arrowEndpoint';
      pointerId: number;
      arrowId: string;
      endpoint: 'start' | 'end';
    }
  | {
      kind: 'marquee';
      pointerId: number;
      startWorld: Point;
      currentWorld: Point;
    }
  | {
      kind: 'resize';
      pointerId: number;
      handle: string;
      targetId: string;
      originBounds: Aabb;
    }
  | {
      kind: 'rotate';
      pointerId: number;
      targetIds: string[];
      center: Point;
      startAngle: number;
      originNodes: Array<{ id: string; rotation: number }>;
      originArrows: Array<{ id: string; start: Point; end: Point }>;
      originStrokes: Array<{ id: string; points: InkPoint[] }>;
    }
  | {
      kind: 'create';
      pointerId: number;
      tool: Exclude<ToolId, 'select' | 'hand'>;
      startWorld: Point;
      currentWorld: Point;
      color: string;
    }
  | {
      kind: 'draw';
      pointerId: number;
      points: InkPoint[];
      color: string;
      brushSize: number;
      thinning: number;
    };

const INITIAL_NODES: BoardNode[] = [
  {
    id: 'client',
    label: 'Web client',
    detail: 'React · browser',
    x: 90,
    y: 225,
    width: 188,
    height: 92,
    tone: 'violet',
    shape: 'round',
  },
  {
    id: 'gateway',
    label: 'API gateway',
    detail: 'edge routing · auth',
    x: 385,
    y: 225,
    width: 205,
    height: 92,
    tone: 'orange',
    shape: 'round',
  },
  {
    id: 'worker',
    label: 'Event worker',
    detail: 'Yjs sync · jobs',
    x: 700,
    y: 148,
    width: 190,
    height: 92,
    tone: 'blue',
    shape: 'round',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    detail: 'snapshots · rooms',
    x: 700,
    y: 314,
    width: 190,
    height: 92,
    tone: 'yellow',
    shape: 'cylinder',
  },
  {
    id: 'redis',
    label: 'Redis',
    detail: 'presence · cursors',
    x: 386,
    y: 455,
    width: 205,
    height: 92,
    tone: 'mint',
    shape: 'round',
  },
  {
    id: 'decision',
    label: 'Keep the room human',
    detail: 'Canvas before ceremony',
    x: 930,
    y: 184,
    width: 206,
    height: 124,
    tone: 'note',
    shape: 'note',
  },
];

const DEFAULT_D2_CODE = `# request flow

client: Web client {
  shape: rectangle
  style.fill: "#ede8ff"
}

gateway: API gateway {
  shape: rectangle
  style.fill: "#ffe0c8"
}

worker: Event worker {
  shape: rectangle
  style.fill: "#d9ebf8"
}

database: PostgreSQL {
  shape: cylinder
  style.fill: "#fff0b8"
}

client -> gateway: request
gateway -> worker: events
worker -> database: snapshot`;

const LEGACY_ROOM_ID = 'incident-room';
const LEGACY_STORAGE_KEY = `eunoia:board:${LEGACY_ROOM_ID}:v1`;

function storageKeyFor(roomId: string): string {
  return `eunoia:board:${roomId}:v1`;
}

type PersistedBoard = {
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  code: string;
};

const CONNECTOR_SPECS = [
  { from: 'client', to: 'gateway', label: 'request', offsetX: 0, offsetY: -24 },
  { from: 'gateway', to: 'worker', label: 'events', offsetX: 0, offsetY: -20 },
  {
    from: 'gateway',
    to: 'postgres',
    label: 'snapshot',
    offsetX: 0,
    offsetY: 22,
  },
  {
    from: 'gateway',
    to: 'redis',
    label: 'presence',
    offsetX: 42,
    offsetY: 0,
    dashed: true,
  },
] as const;

const zoomLabel = (zoom: number) => `${Math.round(zoom)}%`;

function nextId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `${prefix}-${uuid}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The selected image could not be read.'));
    };
    reader.onerror = () =>
      reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function isPersistedBoard(value: unknown): value is PersistedBoard {
  if (!value || typeof value !== 'object') return false;
  const board = value as Partial<PersistedBoard>;
  return (
    Array.isArray(board.nodes) &&
    Array.isArray(board.arrows) &&
    Array.isArray(board.strokes) &&
    typeof board.code === 'string'
  );
}

function toneForColor(color: string): BoardNode['tone'] {
  if (color === '#ef8c52') return 'orange';
  if (color === '#4a86c6') return 'blue';
  if (color === '#f7d66f') return 'yellow';
  if (color === '#766cdc') return 'violet';
  return 'mint';
}

function smoothPath(points: Point[]): string {
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

function strokeBounds(stroke: BoardStroke): Aabb {
  if (stroke.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Pad by half the brush diameter (plus smoothing slop) so thick ink is
  // never culled at the viewport edge and marquee selection hits its edges.
  const pad = (stroke.brushSize ?? 6) / 2 + 3;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

/**
 * Central path router for user arrows. `straight` is the legacy `M…L`
 * segment; `orthogonal` emits axis-aligned `H/V` elbows via the segment
 * midpoint; `curved` emits a cubic with control points offset
 * perpendicular to the chord for a gentle arc.
 */
function arrowPath(arrow: BoardArrow): string {
  const { start, end } = arrow;
  const routing = arrow.routing ?? 'straight';
  if (routing === 'orthogonal') {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    // Elbow orientation follows the dominant axis so short connectors
    // don't zig-zag: mostly-horizontal chords bend vertically and vice versa.
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
    }
    return `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
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
function inkOutlinePath(stroke: BoardStroke): string {
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

/** Build an ink point from a pointer event, normalizing pen pressure. */
function inkPointFromPointer(
  pressure: number | undefined,
  worldPoint: Point,
): InkPoint {
  const raw = typeof pressure === 'number' ? pressure : 0.5;
  // Mice report 0/0.5 with no meaningful pressure; treat 0 as default.
  const normalized =
    Number.isFinite(raw) && raw > 0 ? Math.min(1, Math.max(0, raw)) : 0.5;
  return { ...worldPoint, pressure: normalized };
}

function inkPerpendicularDistance(
  p: InkPoint,
  a: InkPoint,
  b: InkPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.000001) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const clamped = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + clamped * dx), p.y - (a.y + clamped * dy));
}

/**
 * Ramer–Douglas–Peucker simplification on x/y. Pressure travels with the
 * kept points. Runs on pointer-up so live ink stays raw and stored/synced
 * strokes stay small.
 */
function simplifyInkPoints(points: InkPoint[], tolerance = 1.5): InkPoint[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let maxDist = 0;
    let maxIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const dist = inkPerpendicularDistance(
        points[i],
        points[first],
        points[last],
      );
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDist > tolerance) {
      keep[maxIndex] = true;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function arrowBounds(arrow: BoardArrow): Aabb {
  if (arrow.routing === 'curved') {
    // Cubic control points can bow outside the start/end box; expand by
    // the same capped bow used in arrowPath (18% of chord, max 60).
    const chord = Math.hypot(
      arrow.end.x - arrow.start.x,
      arrow.end.y - arrow.start.y,
    );
    const pad = Math.min(60, chord * 0.18) + 10;
    return {
      minX: Math.min(arrow.start.x, arrow.end.x) - pad,
      minY: Math.min(arrow.start.y, arrow.end.y) - pad,
      maxX: Math.max(arrow.start.x, arrow.end.x) + pad,
      maxY: Math.max(arrow.start.y, arrow.end.y) + pad,
    };
  }
  return {
    minX: Math.min(arrow.start.x, arrow.end.x) - 8,
    minY: Math.min(arrow.start.y, arrow.end.y) - 8,
    maxX: Math.max(arrow.start.x, arrow.end.x) + 8,
    maxY: Math.max(arrow.start.y, arrow.end.y) + 8,
  };
}

function nodeBounds(node: BoardNode): Aabb {
  return rotatedNodeAabb(
    node.x,
    node.y,
    node.width,
    node.height,
    node.rotation,
  );
}

function elementsInBounds(
  bounds: Aabb,
  nodes: BoardNode[],
  arrows: BoardArrow[],
  strokes: BoardStroke[],
): string[] {
  const selected: string[] = [];

  for (const node of nodes) {
    if (aabbIntersects(bounds, nodeBounds(node))) {
      selected.push(node.id);
    }
  }

  for (const arrow of arrows) {
    if (aabbIntersects(bounds, arrowBounds(arrow))) {
      selected.push(arrow.id);
    }
  }

  for (const stroke of strokes) {
    if (aabbIntersects(bounds, strokeBounds(stroke))) {
      selected.push(stroke.id);
    }
  }

  return selected;
}

function nodeCenter(node: BoardNode): Point {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function getAnchorPoint(node: BoardNode, targetPoint: Point): Point {
  const rotation = normalizeRotation(node.rotation ?? 0);
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const center = { x: cx, y: cy };
  // Work in the node's unrotated local frame, then rotate the result back.
  const localTarget =
    rotation === 0
      ? targetPoint
      : rotatePoint(targetPoint, center, -degToRad(rotation));
  const dx = localTarget.x - cx;
  const dy = localTarget.y - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: cx, y: cy };
  }

  let local: Point;
  if (node.shape === 'ellipse') {
    const rx = node.width / 2;
    const ry = node.height / 2;
    const angle = Math.atan2(dy, dx);
    local = {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  } else {
    const hw = node.width / 2;
    const hh = node.height / 2;
    const tanX = Math.abs(hw / dx);
    const tanY = Math.abs(hh / dy);
    const t = Math.min(tanX, tanY);
    local = {
      x: cx + dx * t,
      y: cy + dy * t,
    };
  }
  return rotation === 0
    ? local
    : rotatePoint(local, center, degToRad(rotation));
}

/**
 * Side-midpoint anchor for orthogonal routing: picks the edge whose
 * outward normal best aligns with the direction to the target.
 */
function getOrthogonalAnchor(node: BoardNode, targetPoint: Point): Point {
  const rotation = normalizeRotation(node.rotation ?? 0);
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const center = { x: cx, y: cy };
  const localTarget =
    rotation === 0
      ? targetPoint
      : rotatePoint(targetPoint, center, -degToRad(rotation));
  const dx = localTarget.x - cx;
  const dy = localTarget.y - cy;
  const hw = node.width / 2;
  const hh = node.height / 2;
  let local: Point;
  if (Math.abs(dx) / (hw || 1) >= Math.abs(dy) / (hh || 1)) {
    local = { x: dx >= 0 ? cx + hw : cx - hw, y: cy };
  } else {
    local = { x: cx, y: dy >= 0 ? cy + hh : cy - hh };
  }
  return rotation === 0
    ? local
    : rotatePoint(local, center, degToRad(rotation));
}

/** Anchor dispatcher honoring the arrow's routing mode. */
function getRoutedAnchor(
  node: BoardNode,
  targetPoint: Point,
  routing?: ArrowRouting,
): Point {
  if (routing === 'orthogonal') return getOrthogonalAnchor(node, targetPoint);
  return getAnchorPoint(node, targetPoint);
}

function findSnapNode(
  point: Point,
  nodes: BoardNode[],
  padding = 20,
): BoardNode | null {
  for (const node of nodes) {
    const rotation = normalizeRotation(node.rotation ?? 0);
    if (rotation === 0) {
      if (
        point.x >= node.x - padding &&
        point.x <= node.x + node.width + padding &&
        point.y >= node.y - padding &&
        point.y <= node.y + node.height + padding
      ) {
        return node;
      }
      continue;
    }
    // Inverse-rotate the point into the node's local frame for an exact
    // hit test instead of the (oversized) rotated AABB.
    const center = {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    };
    const local = rotatePoint(point, center, -degToRad(rotation));
    if (
      local.x >= node.x - padding &&
      local.x <= node.x + node.width + padding &&
      local.y >= node.y - padding &&
      local.y <= node.y + node.height + padding
    ) {
      return node;
    }
  }
  return null;
}

function connectorPath(source: BoardNode, target: BoardNode): string {
  const sourcePoint = nodeCenter(source);
  const targetPoint = nodeCenter(target);
  const movingRight = targetPoint.x >= sourcePoint.x;
  const startX =
    sourcePoint.x + (movingRight ? source.width / 2 : -source.width / 2);
  const endX =
    targetPoint.x + (movingRight ? -target.width / 2 : target.width / 2);
  const bendX = (startX + endX) / 2;

  return `M ${startX} ${sourcePoint.y} C ${bendX} ${sourcePoint.y}, ${bendX} ${targetPoint.y}, ${endX} ${targetPoint.y}`;
}

function connectorLabelPosition(
  source: BoardNode,
  target: BoardNode,
  offsetX: number,
  offsetY: number,
): Point {
  const sourcePoint = nodeCenter(source);
  const targetPoint = nodeCenter(target);

  return {
    x: (sourcePoint.x + targetPoint.x) / 2 + offsetX,
    y: (sourcePoint.y + targetPoint.y) / 2 + offsetY,
  };
}

function pointerToViewportPoint(
  event: { clientX: number; clientY: number },
  element: SVGSVGElement,
  viewport: { width: number; height: number },
  cachedRect?: DOMRect | null,
): Point {
  const bounds = cachedRect ?? element.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return { x: 0, y: 0 };
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * viewport.width,
    y: ((event.clientY - bounds.top) / bounds.height) * viewport.height,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    Boolean(target.closest('.monaco-editor'))
  );
}

function clearNativeSelection(): void {
  // Dragging a marquee / shape must not create a browser text selection.
  // CSS `user-select: none` prevents new ranges, this clears a pre-existing one.
  if (typeof window === 'undefined') return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) selection.removeAllRanges();
}

function isAuxClick(event: { pointerType: string; button: number }): boolean {
  // Allow touch/pen unconditionally; for mice ignore right-click (button 2).
  // Middle-click (button 1) is handled by the caller as pan.
  return event.pointerType === 'mouse' && event.button === 2;
}

function boardFileSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'board';
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const NODE_TONES = new Set([
  'violet',
  'orange',
  'blue',
  'yellow',
  'mint',
  'note',
]);
const NODE_SHAPES = new Set([
  'round',
  'cylinder',
  'note',
  'ellipse',
  'text',
  'image',
]);

function sanitizeNode(raw: unknown): BoardNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Partial<BoardNode>;
  if (typeof n.id !== 'string' || n.id.length === 0 || n.id.length > 120)
    return null;
  const width = clampSize(finiteOr(n.width, 0), 8, 4000);
  const height = clampSize(finiteOr(n.height, 0), 8, 4000);
  return {
    id: n.id,
    label: typeof n.label === 'string' ? n.label.slice(0, 500) : '',
    detail: typeof n.detail === 'string' ? n.detail.slice(0, 500) : '',
    x: clampSize(finiteOr(n.x, 0), -100000, 100000),
    y: clampSize(finiteOr(n.y, 0), -100000, 100000),
    width,
    height,
    tone: (typeof n.tone === 'string' && NODE_TONES.has(n.tone)
      ? n.tone
      : 'mint') as BoardNode['tone'],
    shape: (typeof n.shape === 'string' && NODE_SHAPES.has(n.shape)
      ? n.shape
      : undefined) as BoardNode['shape'],
    href:
      typeof n.href === 'string' &&
      (n.href.startsWith('data:image/') ||
        n.href.startsWith('https://') ||
        n.href.startsWith('http://'))
        ? n.href.slice(0, 8_000_000)
        : undefined,
    imageId:
      typeof n.imageId === 'string' &&
      n.imageId.length > 0 &&
      n.imageId.length <= 120
        ? n.imageId
        : undefined,
    stroke: typeof n.stroke === 'string' ? n.stroke.slice(0, 32) : undefined,
    fill: typeof n.fill === 'string' ? n.fill.slice(0, 32) : undefined,
    strokeWidth:
      n.strokeWidth === undefined
        ? undefined
        : clampSize(finiteOr(n.strokeWidth, 2), 0.5, 24),
    dashed: n.dashed === true,
    opacity:
      n.opacity === undefined
        ? undefined
        : clampSize(finiteOr(n.opacity, 1), 0.05, 1),
    rotation:
      n.rotation === undefined
        ? undefined
        : normalizeRotation(finiteOr(n.rotation, 0)),
    fontSize:
      n.fontSize === undefined
        ? undefined
        : clampSize(Math.round(finiteOr(n.fontSize, 16)), 8, 400),
  };
}

function sanitizePoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Point> & { pressure?: unknown };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const clean: Point = {
    x: clampSize(p.x as number, -100000, 100000),
    y: clampSize(p.y as number, -100000, 100000),
  };
  if (typeof p.pressure === 'number' && Number.isFinite(p.pressure)) {
    (clean as InkPoint).pressure = clampSize(p.pressure, 0, 1);
  }
  return clean;
}

const ARROW_ROUTINGS: ReadonlySet<string> = new Set([
  'straight',
  'orthogonal',
  'curved',
]);

function sanitizeArrow(raw: unknown): BoardArrow | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<BoardArrow>;
  if (typeof a.id !== 'string' || a.id.length === 0 || a.id.length > 120)
    return null;
  const start = sanitizePoint(a.start);
  const end = sanitizePoint(a.end);
  if (!start || !end) return null;
  return {
    id: a.id,
    start,
    end,
    color: typeof a.color === 'string' ? a.color.slice(0, 32) : '#25263a',
    startNodeId: typeof a.startNodeId === 'string' ? a.startNodeId : undefined,
    endNodeId: typeof a.endNodeId === 'string' ? a.endNodeId : undefined,
    routing:
      typeof a.routing === 'string' && ARROW_ROUTINGS.has(a.routing)
        ? (a.routing as ArrowRouting)
        : undefined,
  };
}

function sanitizeStroke(raw: unknown): BoardStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<BoardStroke>;
  if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 120)
    return null;
  if (!Array.isArray(s.points)) return null;
  const points = s.points.slice(0, 2000).flatMap((p) => {
    const clean = sanitizePoint(p);
    return clean ? [clean as InkPoint] : [];
  });
  if (points.length === 0) return null;
  return {
    id: s.id,
    points,
    color: typeof s.color === 'string' ? s.color.slice(0, 32) : '#25263a',
    brushSize:
      s.brushSize === undefined
        ? undefined
        : clampSize(finiteOr(s.brushSize, 6), 1, 64),
    thinning:
      s.thinning === undefined
        ? undefined
        : clampSize(finiteOr(s.thinning, 0.5), -1, 1),
    opacity:
      s.opacity === undefined
        ? undefined
        : clampSize(finiteOr(s.opacity, 1), 0.05, 1),
  };
}

function sanitizeBoardState(value: unknown): PersistedBoard | null {
  if (!isPersistedBoard(value)) return null;
  return {
    nodes: value.nodes.flatMap((n) => {
      const clean = sanitizeNode(n);
      return clean ? [clean] : [];
    }),
    arrows: value.arrows.flatMap((a) => {
      const clean = sanitizeArrow(a);
      return clean ? [clean] : [];
    }),
    strokes: value.strokes.flatMap((s) => {
      const clean = sanitizeStroke(s);
      return clean ? [clean] : [];
    }),
    code: value.code.slice(0, 500_000),
  };
}

function reorderBySelection<T extends { id: string }>(
  items: T[],
  selectedIds: string[],
  direction: 'forward' | 'backward' | 'front' | 'back',
): T[] {
  const selected = items.filter((item) => selectedIds.includes(item.id));
  if (selected.length === 0) return items;
  const remaining = items.filter((item) => !selectedIds.includes(item.id));
  if (direction === 'front') return [...remaining, ...selected];
  if (direction === 'back') return [...selected, ...remaining];
  if (direction === 'forward') {
    const next = [...items];
    for (const item of selected) {
      const index = next.findIndex((entry) => entry.id === item.id);
      if (index >= 0 && index < next.length - 1) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
    return next;
  }
  const next = [...items];
  for (const item of [...selected].reverse()) {
    const index = next.findIndex((entry) => entry.id === item.id);
    if (index > 0) {
      [next[index], next[index - 1]] = [next[index - 1], next[index]];
    }
  }
  return next;
}

function downscaleImageToDataUrl(
  source: string,
  maxDimension = 1024,
): Promise<{ href: string; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || 400;
      const naturalHeight = img.naturalHeight || 300;
      const scale = Math.min(
        1,
        maxDimension / Math.max(naturalWidth, naturalHeight),
      );
      if (scale >= 1) {
        resolve({ href: source, width: naturalWidth, height: naturalHeight });
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ href: source, width: naturalWidth, height: naturalHeight });
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          href: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        });
      } catch {
        resolve({ href: source, width: naturalWidth, height: naturalHeight });
      }
    };
    img.onerror = () => resolve({ href: source, width: 400, height: 300 });
    img.src = source;
  });
}

function ToolButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`board-tool ${active ? 'is-active' : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PresenceAvatar({
  initials,
  color,
  title,
}: {
  initials: string;
  color: string;
  title?: string;
}) {
  return (
    <span
      className="presence-avatar"
      style={{ backgroundColor: color }}
      aria-hidden={title ? undefined : true}
      title={title}
    >
      {initials}
    </span>
  );
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const second =
    parts.length > 1 ? (parts[1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${second}`.toUpperCase();
}

function Connector({
  path,
  label,
  labelX,
  labelY,
  dashed = false,
}: {
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  dashed?: boolean;
}) {
  return (
    <g className={`board-connector ${dashed ? 'is-dashed' : ''}`}>
      <path d={path} markerEnd="url(#arrowhead)" />
      <rect x={labelX - 44} y={labelY - 13} width="88" height="26" rx="13" />
      <text x={labelX} y={labelY + 4} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function CanvasNode({
  node,
  selected,
  onPointerDown,
  onDoubleClick,
  onKeySelect,
  onImageError,
}: {
  node: BoardNode;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void;
  onDoubleClick: () => void;
  onKeySelect: (
    event: ReactKeyboardEvent<SVGGElement>,
    node: BoardNode,
  ) => void;
  onImageError?: (node: BoardNode) => void;
}) {
  const isNote = node.shape === 'note';
  const isCylinder = node.shape === 'cylinder';
  const isEllipse = node.shape === 'ellipse';
  const isText = node.shape === 'text';
  const isImage = node.shape === 'image';
  const shapeStyle = {
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    strokeDasharray: node.dashed ? '7 5' : undefined,
    opacity: node.opacity ?? 1,
  };

  const rotation = normalizeRotation(node.rotation ?? 0);
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;

  return (
    <g
      className={`canvas-node canvas-node--${node.tone} ${isNote ? 'is-note' : ''} ${selected ? 'is-selected' : ''}`}
      transform={
        rotation === 0 ? undefined : `rotate(${rotation} ${centerX} ${centerY})`
      }
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick();
      }}
      role="button"
      tabIndex={0}
      aria-label={`Select ${node.label}`}
      aria-pressed={selected}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onKeySelect(event, node);
        }
      }}
    >
      {isImage ? (
        <>
          <image
            className="node-image"
            href={node.href}
            crossOrigin="anonymous"
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            preserveAspectRatio="none"
            style={{ opacity: node.opacity ?? 1 }}
            onError={() => onImageError?.(node)}
          />
          <rect
            className="node-image-frame"
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx="12"
            style={{ opacity: node.opacity ?? 1 }}
          />
        </>
      ) : isNote ? (
        <path
          className="node-note"
          d={`M ${node.x + 10} ${node.y} h ${node.width - 22} l 12 12 v ${node.height - 24} q 0 12 -12 12 h -${node.width - 10} q -10 0 -10 -10 v -${node.height - 4} q 0 -10 10 -10`}
          style={shapeStyle}
        />
      ) : isCylinder ? (
        <>
          <path
            className="node-body"
            d={`M ${node.x} ${node.y + 16} v ${node.height - 32} c 0 11 ${((node.width / 2) * 0.4526).toFixed(1)} 20 ${(node.width / 2).toFixed(1)} 20 s ${(node.width / 2).toFixed(1)} -9 ${(node.width / 2).toFixed(1)} -20 V ${node.y + 16}`}
            style={shapeStyle}
          />
          <ellipse
            className="node-cap"
            cx={node.x + node.width / 2}
            cy={node.y + 16}
            rx={node.width / 2}
            ry="20"
            style={shapeStyle}
          />
          <path
            className="node-rim"
            d={`M ${node.x} ${node.y + 16} c 0 11 ${((node.width / 2) * 0.4526).toFixed(1)} 20 ${(node.width / 2).toFixed(1)} 20 s ${(node.width / 2).toFixed(1)} -9 ${(node.width / 2).toFixed(1)} -20`}
            style={{ stroke: node.stroke, strokeWidth: node.strokeWidth }}
          />
        </>
      ) : isEllipse ? (
        <ellipse
          className="node-body"
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          style={shapeStyle}
        />
      ) : isText ? null : (
        <rect
          className="node-body"
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx="18"
          style={shapeStyle}
        />
      )}
      {!isImage && (
        <text
          className={`node-label ${isText ? 'node-label--text' : ''}`}
          x={node.x + (isText ? 0 : 18)}
          y={
            node.y +
            (isText ? Math.round(node.height * 0.72) : isNote ? 42 : 43)
          }
          style={{
            fontSize: isText
              ? `${node.fontSize ?? Math.max(14, Math.round(node.height * 0.65))}px`
              : undefined,
          }}
        >
          {node.label}
        </text>
      )}
      {!isText && !isImage && (
        <text
          className="node-detail"
          x={node.x + 18}
          y={node.y + (isNote ? 70 : 68)}
        >
          {node.detail}
        </text>
      )}
    </g>
  );
}

export function WhiteboardPage({
  initialRoomId,
}: {
  initialRoomId: string | null;
}) {
  const router = useRouter();
  // The route keys this component by room, so the initial id is fixed per
  // mount.
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [roomMeta, setRoomMeta] = useState<RoomMetadata | null>(null);
  const [roomStatus, setRoomStatus] = useState<
    'loading' | 'ready' | 'missing' | 'locked' | 'error'
  >(initialRoomId && initialRoomId.startsWith('local-') ? 'ready' : 'loading');
  // Ingest shared invite tickets (`?ticket=`) into the ticket store once
  // per mount. The store (not React state) is the single source of truth
  // for tickets — resolvers read it live, so rotation/expiry can never go
  // stale. Initialization is idempotent, safe under StrictMode remounts.
  useState(() => {
    if (typeof window !== 'undefined') ingestTicketDeepLink();
  });
  // Signed-in account, if any. Loaded once per mount; login/logout happen
  // on other routes which remount this page on return.
  const [session, setSession] = useState<AuthSession | null>(() =>
    typeof window === 'undefined' ? null : loadSession(),
  );
  // Session storage is client-only (SSR always renders signed-out), so the
  // account-menu branch below waits for mount to keep hydration identical.
  // Sync/auth logic keeps using `session` synchronously — only rendering
  // is gated.
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration gate, not a render loop. */
  useEffect(() => {
    setMounted(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>(['gateway']);
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [strokes, setStrokes] = useState<BoardStroke[]>([]);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const [canvasViewport, setCanvasViewport] = useState(WORLD_VIEWPORT);
  const [marquee, setMarquee] = useState<Aabb | null>(null);
  const [showCode, setShowCode] = useState(true);
  const [code, setCode] = useState(DEFAULT_D2_CODE);
  const [compileState, setCompileState] = useState<
    'saved' | 'draft' | 'compiled' | 'compiling'
  >('saved');
  const [engine, setEngine] = useState<'dagre' | 'elk' | 'tala'>(() => {
    if (typeof window === 'undefined') return 'dagre';
    const stored = window.localStorage.getItem('eunoia:engine');
    return stored === 'elk' || stored === 'tala' ? stored : 'dagre';
  });
  const [persistenceState, setPersistenceState] = useState<
    'loading' | 'saving' | 'saved' | 'error'
  >('loading');
  const [hasHydrated, setHasHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const [syncReady, setSyncReady] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeColor, setActiveColor] = useState('#25263a');
  const [arrowRouting, setArrowRouting] = useState<ArrowRouting>('straight');
  const [brushSize, setBrushSize] = useState(8);
  const [brushThinning, setBrushThinning] = useState(0.5);
  const [locked, setLocked] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [createPreview, setCreatePreview] = useState<{
    tool: Exclude<ToolId, 'select' | 'hand'>;
    start: Point;
    end: Point;
    color: string;
  } | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiQuota, setAiQuota] = useState<{
    used: number;
    limit: number;
  } | null>(null);
  // Thumbnail auto-capture guards: one in-flight upload, last uploaded hash.
  const thumbInFlightRef = useRef(false);
  const thumbHashRef = useRef<string | null>(null);
  const [boardTitle, setBoardTitle] = useState('Request flow');
  const canvasRef = useRef<SVGSVGElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const spaceRef = useRef(false);
  const viewportRectRef = useRef<DOMRect | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<{
    nodes: BoardNode[];
    arrows: BoardArrow[];
    strokes: BoardStroke[];
  } | null>(null);
  // Per-user isolated undo/redo (PRD §3.3.3): stacks hold op entries
  // covering ONLY the local user's own mutations. Remote boards are never
  // captured, so undo can't revert concurrent peer changes.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  // Pre-gesture board staged once per pointer gesture (see beginGesture);
  // committed as a single entry on release (see commitGesture).
  const gestureBaseRef = useRef<BoardSnapshot | null>(null);
  // Explicit post-state for creation commits (the created element hasn't
  // rendered when the gesture ends).
  const createCommitRef = useRef<BoardSnapshot | null>(null);
  const syncRef = useRef<ReturnType<typeof createBoardSync> | null>(null);
  const cursorBroadcastRef = useRef(0);
  const compileAbortRef = useRef<AbortController | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const cameraRef = useRef<Camera>(camera);
  const nodesRef = useRef<BoardNode[]>(nodes);
  const arrowsRef = useRef<BoardArrow[]>(arrows);
  const strokesRef = useRef<BoardStroke[]>(strokes);
  const [svgPixelSize, setSvgPixelSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const boardStateRef = useRef<SyncBoardState>({
    nodes,
    arrows,
    strokes,
    code,
  });
  const arrowRoutingRef = useRef<ArrowRouting>(arrowRouting);

  useEffect(() => {
    arrowRoutingRef.current = arrowRouting;
  }, [arrowRouting]);

  const brushRef = useRef({ size: brushSize, thinning: brushThinning });

  useEffect(() => {
    brushRef.current = { size: brushSize, thinning: brushThinning };
  }, [brushSize, brushThinning]);
  const lastCompiledCodeRef = useRef<string | null>(null);
  const restoreNoticeRef = useRef(false);
  // Bounded reconnect attempts after access loss (see onAccessLost): reset
  // whenever a session connects or the room changes.
  const accessLostRetries = useRef(0);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate and persist an external browser store. */
  useEffect(() => {
    boardStateRef.current = { nodes, arrows, strokes, code };
  }, [arrows, code, nodes, strokes]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const canvasViewportRef = useRef(canvasViewport);

  useEffect(() => {
    canvasViewportRef.current = canvasViewport;
  }, [canvasViewport]);

  const roomIdRef = useRef(roomId);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    arrowsRef.current = arrows;
  }, [arrows]);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // Track the SVG element's pixel size without reading refs during render,
  // so the in-place text editor stays aligned on resize/zoom.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSvgPixelSize({ width: rect.width, height: rect.height });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  /** Deep-clone the current board for use as an undo base. */
  const captureBoardSnapshot = useCallback((): BoardSnapshot => {
    return structuredClone(boardStateRef.current) as unknown as BoardSnapshot;
  }, []);

  const pushUndoEntry = useCallback((entry: UndoEntry) => {
    undoStackRef.current = [...undoStackRef.current, entry].slice(
      -MAX_UNDO_ENTRIES,
    );
    redoStackRef.current = [];
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(0);
  }, []);

  /**
   * Stage the pre-gesture board once per pointer gesture (idempotent).
   * Passive ref-sync effects flush before discrete pointer events, so the
   * ref is current at gesture start.
   */
  const beginGesture = useCallback(() => {
    if (gestureBaseRef.current) return;
    gestureBaseRef.current = structuredClone(
      boardStateRef.current,
    ) as unknown as BoardSnapshot;
  }, []);

  /**
   * Commit the staged gesture as one undo entry. Call BEFORE
   * flushPendingRemote: remotes are deferred mid-gesture, so the ref holds
   * local-only changes and the entry never captures peer edits.
   * Accepts an explicit post-state for gestures whose final mutation
   * hasn't rendered yet (draw commit, shape creation).
   */
  const commitGesture = useCallback(
    (afterOverride?: BoardSnapshot) => {
      const base = gestureBaseRef.current;
      gestureBaseRef.current = null;
      if (!base) return;
      const entry = diffBoardSnapshots(
        base,
        afterOverride ?? (boardStateRef.current as unknown as BoardSnapshot),
      );
      if (entry) pushUndoEntry(entry);
    },
    [pushUndoEntry],
  );

  /**
   * Push a discrete (non-gesture) local mutation as one undo entry.
   * Callers compute `after` explicitly because their setStates are async.
   */
  const pushDiscreteChange = useCallback(
    (before: BoardSnapshot, after: BoardSnapshot) => {
      const entry = diffBoardSnapshots(before, after);
      if (entry) pushUndoEntry(entry);
    },
    [pushUndoEntry],
  );

  const applyUndoEntry = useCallback(
    (entry: UndoEntry, side: 'before' | 'after') => {
      setNodes((current) => applyEntryValues(current, entry.nodes, side));
      setArrows((current) => applyEntryValues(current, entry.arrows, side));
      setStrokes((current) => applyEntryValues(current, entry.strokes, side));
      const code = side === 'before' ? entry.codeBefore : entry.codeAfter;
      if (code !== null) {
        setCode(code);
        if (code !== lastCompiledCodeRef.current) {
          setCompileState('draft');
        }
      }
      setSelectedIds([]);
    },
    [],
  );

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    // The redo counterpart inverts the entry; `after` values are read live
    // so redo re-applies exactly what undo removed.
    redoStackRef.current = [...redoStackRef.current, invertUndoEntry(entry)];
    applyUndoEntry(entry, 'before');
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
  }, [applyUndoEntry]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, invertUndoEntry(entry)];
    applyUndoEntry(entry, 'before');
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
  }, [applyUndoEntry]);

  const pendingRemoteRef = useRef<PersistedBoard | null>(null);

  /**
   * Merge a validated remote board into local state. During an active
   * pointer gesture the update is queued and applied on pointer-up so the
   * canvas is never yanked mid-drag (see flushPendingRemote).
   */
  const applyRemoteState = useCallback((clean: PersistedBoard) => {
    if (interactionRef.current) {
      pendingRemoteRef.current = clean;
      return;
    }
    // Deliberately NOT captured for undo: per-user isolated undo covers
    // only local mutations, so peer edits survive local undo/redo.
    if (restoreNoticeRef.current) {
      restoreNoticeRef.current = false;
      setBoardError(null);
    }
    setNodes(clean.nodes);
    setArrows(clean.arrows);
    setStrokes(clean.strokes);
    setCode(clean.code);
    setPersistenceState('saved');
  }, []);

  const flushPendingRemote = useCallback(() => {
    const pending = pendingRemoteRef.current;
    if (!pending) return;
    pendingRemoteRef.current = null;
    applyRemoteState(pending);
  }, [applyRemoteState]);

  /** Single source of truth for credentials: the stores, never stale state. */
  const resolveRoomTicket = useCallback(
    () => (roomId ? getTicket(roomId) : undefined),
    [roomId],
  );
  const resolveUserToken = useCallback(
    () =>
      session && session.expiresAt > Date.now() ? session.token : undefined,
    [session],
  );
  const [syncNonce, setSyncNonce] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      setCanvasViewport({
        width: (width / height) * WORLD_VIEWPORT.height,
        height: WORLD_VIEWPORT.height,
      });
    });

    resizeObserver.observe(canvasRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!roomId) return;
    setHasHydrated(false);
    setPersistenceState('loading');
    // Fresh room, fresh undo: stacks from another room must never leak in.
    undoStackRef.current = [];
    redoStackRef.current = [];
    gestureBaseRef.current = null;
    createCommitRef.current = null;
    pendingRemoteRef.current = null;
    setUndoDepth(0);
    setRedoDepth(0);
    try {
      const key = storageKeyFor(roomId);
      let raw = window.localStorage.getItem(key);
      // One-time migration from the pre-multi-room hardcoded room key.
      if (!raw && roomId !== LEGACY_ROOM_ID) {
        raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      }
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const clean = sanitizeBoardState(parsed);
        if (clean) {
          // Verbatim: an intentionally emptied board must stay empty.
          setNodes(clean.nodes);
          setArrows(clean.arrows);
          setStrokes(clean.strokes);
          setCode(clean.code);
        }
      }
      setPersistenceState('saved');
    } catch {
      setPersistenceState('error');
      setBoardError(
        'This browser blocked local board storage. Your changes will remain in memory for this session.',
      );
    } finally {
      setHasHydrated(true);
    }
  }, [roomId]);

  useEffect(() => {
    if (!hasHydrated || !roomId) return;
    setPersistenceState('saving');
    const timeoutId = window.setTimeout(() => {
      const fullPayload: PersistedBoard = { nodes, arrows, strokes, code };
      try {
        window.localStorage.setItem(
          roomId ? storageKeyFor(roomId) : LEGACY_STORAGE_KEY,
          JSON.stringify(fullPayload),
        );
        setPersistenceState('saved');
      } catch (error) {
        // Image data URLs can exceed the ~5MB localStorage quota. Retry
        // metadata-only so text/shapes still persist for this session.
        const isQuota =
          error instanceof DOMException
            ? error.name === 'QuotaExceededError' || error.code === 22
            : false;
        if (isQuota) {
          try {
            const slimPayload: PersistedBoard = {
              nodes: nodes.map((node) =>
                node.shape === 'image' ? { ...node, href: undefined } : node,
              ),
              arrows,
              strokes,
              code,
            };
            window.localStorage.setItem(
              roomId ? storageKeyFor(roomId) : LEGACY_STORAGE_KEY,
              JSON.stringify(slimPayload),
            );
            setPersistenceState('saved');
            setBoardError(
              'Images are kept in memory only: local storage is full, so they will not persist after reload.',
            );
            return;
          } catch {
            // Fall through to the generic error below.
          }
        }
        setPersistenceState('error');
        setBoardError(
          'The board could not be saved in this browser. Export or keep the tab open to avoid losing changes.',
        );
      }
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [arrows, code, hasHydrated, nodes, roomId, strokes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Room bootstrap: auto-create a room when the URL carries none, and
  // load room metadata (tier, lock state) otherwise.
  useEffect(() => {
    if (initialRoomId) return;
    let cancelled = false;
    createRoom({ name: 'Untitled board' }, resolveUserToken())
      .then((meta) => {
        if (cancelled) return;
        setRoomMeta(meta);
        setRoomStatus('ready');
        router.replace(`/board?room=${encodeURIComponent(meta.id)}`);
      })
      .catch(() => {
        if (cancelled) return;
        // Server unreachable: fall back to a local-only room so the board
        // stays usable offline.
        setRoomId(`local-${Date.now().toString(36)}`);
        setRoomMeta(null);
        setRoomStatus('ready');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Local-only fallback rooms have no server counterpart.
    if (!roomId || roomMeta || roomId.startsWith('local-')) return;
    let cancelled = false;
    getRoom(roomId, resolveRoomTicket())
      .then((meta) => {
        if (cancelled) return;
        setRoomMeta(meta);
        setRoomStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isRoomNotFound(error)) setRoomStatus('missing');
        else if (isRoomLocked(error)) setRoomStatus('locked');
        else {
          setRoomMeta(null);
          setRoomStatus('ready');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    if (
      !hasHydrated ||
      !roomId ||
      // Local-only rooms have no server counterpart: syncing them just
      // 404s the upgrade forever, and onAccessLost would then misfile
      // them as missing server rooms.
      roomId.startsWith('local-') ||
      roomStatus === 'locked' ||
      roomStatus === 'missing'
    )
      return;
    const session = createBoardSync({
      roomId,
      serverUrl: resolveSyncServerUrl(),
      ticket: resolveRoomTicket(),
      // Workspace members sync locked team rooms through this token
      // (see sync.ts); harmless for personal rooms.
      userToken: resolveUserToken(),
      initialState: boardStateRef.current,
      getInitialState: () => boardStateRef.current,
      onReady: () => {
        accessLostRetries.current = 0;
        setSyncReady(true);
      },
      onStatus: (status) => {
        setSyncStatus(status);
        if (status === 'offline') setSyncReady(false);
      },
      onError: (message) => setBoardError(message),
      onPeers: (next) => setPeers(next),
      onClose: (code) => {
        // 4100: the server restored a snapshot and dropped us. The session
        // auto-reconnects and resyncs from scratch; just explain the flash.
        if (code === 4100) {
          restoreNoticeRef.current = true;
          setBoardError('Board history was restored — resyncing…');
        }
      },
      onAccessLost: () => {
        // Credentials are dead (revoked/rotated/deleted room), not a
        // transient drop. Re-validate over HTTP and land in the right UI.
        // The live ticket must travel along: without it a locked room with
        // a still-valid ticket is misclassified as locked and the good
        // credential gets destroyed below.
        const id = roomId;
        void getRoom(id, getTicket(id))
          .then(() => {
            // Open room (or valid ticket) but sync keeps failing: flaky
            // network or server restart — recreate the session fresh, with
            // a bounded backoff so a hard-down backend can't storm it.
            accessLostRetries.current += 1;
            if (accessLostRetries.current > 5) {
              setBoardError(
                'Live sync keeps failing. The board still works locally.',
              );
              return;
            }
            const delayMs = Math.min(30, 2 ** accessLostRetries.current) * 1000;
            window.setTimeout(() => {
              if (roomIdRef.current === id) setSyncNonce((n) => n + 1);
            }, delayMs);
          })
          .catch((error: unknown) => {
            if (isRoomLocked(error)) {
              clearTicket(id);
              setRoomStatus('locked');
            } else if (isRoomNotFound(error)) {
              setRoomStatus('missing');
            } else {
              setBoardError(
                'Live sync keeps failing. The board still works locally.',
              );
            }
          });
      },
      onState: (state) => {
        const clean = sanitizeBoardState(state);
        if (!clean) {
          setBoardError(
            'The room sent an invalid board state. Local changes were kept.',
          );
          return;
        }
        applyRemoteState(clean);
      },
    });
    syncRef.current = session;
    return () => {
      setSyncReady(false);
      setPeers([]);
      session.destroy();
      syncRef.current = null;
    };
  }, [
    applyRemoteState,
    hasHydrated,
    roomId,
    roomStatus,
    resolveRoomTicket,
    resolveUserToken,
    syncNonce,
  ]);

  useEffect(() => {
    if (!hasHydrated || !syncReady) return;
    const timeoutId = window.setTimeout(() => {
      syncRef.current?.publish(boardStateRef.current);
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [arrows, code, hasHydrated, nodes, strokes, syncReady]);

  // Track server-room visits for the board switcher's recent list. The
  // switcher dialog reads the list lazily on open, so no state sync here.
  useEffect(() => {
    if (!roomId || roomId.startsWith('local-') || roomStatus !== 'ready')
      return;
    recordRoomVisit({ id: roomId, name: roomMeta?.name });
  }, [roomId, roomMeta, roomStatus]);

  // Thumbnail auto-capture: idle-delayed after the last mutation, following
  // the sync publish pulse. Best-effort and silent — a missing preview must
  // never interrupt drawing, and R2-off servers simply skip capture.
  useEffect(() => {
    if (
      !hasHydrated ||
      !syncReady ||
      !roomId ||
      roomId.startsWith('local-') ||
      roomStatus !== 'ready' ||
      nodes.length + arrows.length + strokes.length === 0
    )
      return;
    const captureRoomId = roomId;
    const timeoutId = window.setTimeout(() => {
      if (thumbInFlightRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const svg = canvasRef.current;
      if (!svg) return;
      const hash = thumbnailContentHash(nodes, arrows, strokes);
      if (thumbHashRef.current === hash) return;
      thumbInFlightRef.current = true;
      const ticket = getTicket(captureRoomId);
      captureThumbnailBlob(svg, nodes, arrows, strokes, {
        roomId: captureRoomId,
        ticket,
      })
        .then((shot) => uploadThumbnail(captureRoomId, ticket, shot.blob))
        .then((stored) =>
          pruneOldThumbnails(captureRoomId, ticket, stored.id).then(() => {
            // Only mark the hash after upload+prune succeed so a failed
            // capture retries on the next pulse instead of going stale.
            if (roomIdRef.current === captureRoomId)
              thumbHashRef.current = hash;
          }),
        )
        .catch(() => {
          // Silent: thumbnails are decorative; errors stay out of boardError.
        })
        .finally(() => {
          thumbInFlightRef.current = false;
        });
    }, THUMB_CAPTURE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [arrows, hasHydrated, nodes, roomId, roomStatus, strokes, syncReady]);

  const selectedId = selectedIds[0] ?? '';

  const spatialIndex = useMemo(() => {
    const index = new SpatialIndex<BoardNode>();
    index.rebuild(
      nodes.map((node) => ({
        ...nodeBounds(node),
        id: node.id,
        value: node,
      })),
    );
    return index;
  }, [nodes]);

  const arrowIndex = useMemo(() => {
    const index = new SpatialIndex<BoardArrow>();
    index.rebuild(
      arrows.map((arrow) => ({
        ...arrowBounds(arrow),
        id: arrow.id,
        value: arrow,
      })),
    );
    return index;
  }, [arrows]);

  const strokeIndex = useMemo(() => {
    const index = new SpatialIndex<BoardStroke>();
    index.rebuild(
      strokes.map((stroke) => ({
        ...strokeBounds(stroke),
        id: stroke.id,
        value: stroke,
      })),
    );
    return index;
  }, [strokes]);

  const viewBox = useMemo(
    () => cameraViewBox(camera, canvasViewport),
    [camera, canvasViewport],
  );

  const visibleNodes = useMemo(
    () => spatialIndex.search(viewBox),
    [spatialIndex, viewBox],
  );

  const visibleStrokes = useMemo(
    () => strokeIndex.search(viewBox),
    [strokeIndex, viewBox],
  );

  const visibleArrows = useMemo(
    () => arrowIndex.search(viewBox),
    [arrowIndex, viewBox],
  );

  // Per-color markers: `fill="context-stroke"` has spotty browser support,
  // so dynamic arrows get an explicit marker in their own color.
  const arrowMarkerIds = useMemo(() => {
    const ids = new Map<string, string>();
    for (const arrow of arrows) {
      if (!ids.has(arrow.color)) {
        ids.set(
          arrow.color,
          `ah-${arrow.color.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'ink'}`,
        );
      }
    }
    return ids;
  }, [arrows]);

  const selectedNodeBounds = useMemo(() => {
    const selectedNodes = nodes.filter((node) => selectedIds.includes(node.id));
    if (selectedNodes.length === 0) return null;
    return unionAabbs(selectedNodes.map(nodeBounds));
  }, [nodes, selectedIds]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const arrowById = useMemo(
    () => new Map(arrows.map((arrow) => [arrow.id, arrow])),
    [arrows],
  );

  const strokeById = useMemo(
    () => new Map(strokes.map((stroke) => [stroke.id, stroke])),
    [strokes],
  );

  /**
   * Peer selection highlights: dashed outlines in each peer's color for
   * the elements they currently have selected. Bounds-based (rotated
   * AABBs for nodes) so highlights track moves without re-rendering the
   * scene itself.
   */
  const peerSelectionOutlines = useMemo(() => {
    const outlines: Array<{
      key: string;
      bounds: Aabb;
      color: string;
      name: string;
    }> = [];
    for (const peer of peers) {
      if (!peer.selection || peer.selection.length === 0) continue;
      for (const id of peer.selection.slice(0, 100)) {
        const node = nodeById.get(id);
        if (node) {
          outlines.push({
            key: `${peer.clientId}:${id}`,
            bounds: nodeBounds(node),
            color: peer.user.color,
            name: peer.user.name,
          });
          continue;
        }
        const arrow = arrowById.get(id);
        if (arrow) {
          outlines.push({
            key: `${peer.clientId}:${id}`,
            bounds: arrowBounds(arrow),
            color: peer.user.color,
            name: peer.user.name,
          });
          continue;
        }
        const stroke = strokeById.get(id);
        if (stroke) {
          outlines.push({
            key: `${peer.clientId}:${id}`,
            bounds: strokeBounds(stroke),
            color: peer.user.color,
            name: peer.user.name,
          });
        }
      }
    }
    return outlines;
  }, [peers, nodeById, arrowById, strokeById]);

  const connectors = useMemo(
    () =>
      CONNECTOR_SPECS.flatMap((spec) => {
        const source = nodeById.get(spec.from);
        const target = nodeById.get(spec.to);
        if (!source || !target) return [];
        return [
          {
            ...spec,
            path: connectorPath(source, target),
            dashed: Boolean('dashed' in spec && spec.dashed),
            labelPosition: connectorLabelPosition(
              source,
              target,
              spec.offsetX,
              spec.offsetY,
            ),
          },
        ];
      }),
    [nodeById],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const selectedOpacity = Math.round((selectedNode?.opacity ?? 1) * 100);
  const selectedArrowCount = useMemo(
    () => arrows.filter((arrow) => selectedIds.includes(arrow.id)).length,
    [arrows, selectedIds],
  );
  const selectedStrokeCount = useMemo(
    () => strokes.filter((stroke) => selectedIds.includes(stroke.id)).length,
    [strokes, selectedIds],
  );
  const selectedArrowRouting = useMemo<ArrowRouting | null>(() => {
    const selected = arrows.filter((arrow) => selectedIds.includes(arrow.id));
    if (selected.length === 0) return null;
    const first = selected[0].routing ?? 'straight';
    return selected.every((arrow) => (arrow.routing ?? 'straight') === first)
      ? first
      : null;
  }, [arrows, selectedIds]);

  const applyArrowRouting = useCallback(
    (routing: ArrowRouting) => {
      setArrowRouting(routing);
      if (locked) return;
      if (!selectedIds.some((id) => arrowsRef.current.some((a) => a.id === id)))
        return;
      const before = captureBoardSnapshot();
      const nextArrows = before.arrows.map((arrow) =>
        selectedIds.includes(arrow.id) ? { ...arrow, routing } : arrow,
      );
      setArrows(nextArrows);
      pushDiscreteChange(before, { ...before, arrows: nextArrows });
    },
    [captureBoardSnapshot, locked, pushDiscreteChange, selectedIds],
  );

  const applyBrushSize = useCallback(
    (size: number) => {
      setBrushSize(size);
      if (locked || selectedStrokeCount === 0) return;
      const before = captureBoardSnapshot();
      const nextStrokes = before.strokes.map((stroke) =>
        selectedIds.includes(stroke.id)
          ? { ...stroke, brushSize: size }
          : stroke,
      );
      setStrokes(nextStrokes);
      pushDiscreteChange(before, { ...before, strokes: nextStrokes });
    },
    [
      captureBoardSnapshot,
      locked,
      pushDiscreteChange,
      selectedIds,
      selectedStrokeCount,
    ],
  );

  const applyBrushThinning = useCallback(
    (thinning: number) => {
      setBrushThinning(thinning);
      if (locked || selectedStrokeCount === 0) return;
      const before = captureBoardSnapshot();
      const nextStrokes = before.strokes.map((stroke) =>
        selectedIds.includes(stroke.id) ? { ...stroke, thinning } : stroke,
      );
      setStrokes(nextStrokes);
      pushDiscreteChange(before, { ...before, strokes: nextStrokes });
    },
    [
      captureBoardSnapshot,
      locked,
      pushDiscreteChange,
      selectedIds,
      selectedStrokeCount,
    ],
  );

  const selectTool = useCallback((tool: ToolId) => {
    setActiveTool(tool);
    if (tool !== 'select' && tool !== 'hand') setSelectedIds([]);
  }, []);

  const adjustZoom = useCallback((amount: number) => {
    setCamera((current) => ({
      ...current,
      zoom: Math.min(2.2, Math.max(0.35, current.zoom + amount / 100)),
    }));
  }, []);

  const resetCamera = useCallback(() => {
    setCamera(INITIAL_CAMERA);
  }, []);

  const handleNodeEdit = useCallback(
    (nodeId: string) => {
      if (locked) return;
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      setEditingNode({ id: nodeId, value: node.label });
    },
    [locked, nodes],
  );

  const commitEdit = useCallback(() => {
    if (!editingNode) return;
    const targetNode = nodes.find((n) => n.id === editingNode.id);
    const trimmed = editingNode.value.trim();

    if (trimmed === '' && targetNode?.shape === 'text') {
      const before = captureBoardSnapshot();
      const nextNodes = before.nodes.filter(
        (item) => item.id !== editingNode.id,
      );
      setNodes(nextNodes);
      setSelectedIds([]);
      pushDiscreteChange(before, { ...before, nodes: nextNodes });
    } else if (trimmed && trimmed !== targetNode?.label) {
      const before = captureBoardSnapshot();
      const nextNodes = before.nodes.map((item) =>
        item.id === editingNode.id ? { ...item, label: trimmed } : item,
      );
      setNodes(nextNodes);
      pushDiscreteChange(before, { ...before, nodes: nextNodes });
    }
    setEditingNode(null);
  }, [captureBoardSnapshot, editingNode, nodes, pushDiscreteChange]);

  const cancelEdit = useCallback(() => {
    setEditingNode(null);
  }, []);

  const selectAllIds = useCallback(() => {
    const ids = new Set<string>();
    for (const node of nodesRef.current) ids.add(node.id);
    for (const arrow of arrowsRef.current) ids.add(arrow.id);
    for (const stroke of strokesRef.current) ids.add(stroke.id);
    return [...ids];
  }, []);

  const applySelectedColor = useCallback(
    (color: string, tone: BoardNode['tone']) => {
      setActiveColor(color);
      if (locked || selectedIds.length === 0) return;
      const before = captureBoardSnapshot();
      const nextNodes = before.nodes.map((node) =>
        selectedIds.includes(node.id) ? { ...node, tone, stroke: color } : node,
      );
      const nextArrows = before.arrows.map((arrow) =>
        selectedIds.includes(arrow.id) ? { ...arrow, color } : arrow,
      );
      const nextStrokes = before.strokes.map((stroke) =>
        selectedIds.includes(stroke.id) ? { ...stroke, color } : stroke,
      );
      setNodes(nextNodes);
      setArrows(nextArrows);
      setStrokes(nextStrokes);
      pushDiscreteChange(before, {
        ...before,
        nodes: nextNodes,
        arrows: nextArrows,
        strokes: nextStrokes,
      });
    },
    [captureBoardSnapshot, locked, pushDiscreteChange, selectedIds],
  );

  const copySelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const copiedNodes = nodes.filter((n) => selectedIds.includes(n.id));
    const copiedArrows = arrows.filter((a) => selectedIds.includes(a.id));
    const copiedStrokes = strokes.filter((s) => selectedIds.includes(s.id));
    clipboardRef.current = {
      nodes: copiedNodes,
      arrows: copiedArrows,
      strokes: copiedStrokes,
    };
  }, [arrows, nodes, selectedIds, strokes]);

  const cutSelected = useCallback(() => {
    if (locked) return;
    copySelected();
    const before = captureBoardSnapshot();
    const nextNodes = before.nodes.filter((n) => !selectedIds.includes(n.id));
    const nextArrows = before.arrows.filter((a) => !selectedIds.includes(a.id));
    const nextStrokes = before.strokes.filter(
      (s) => !selectedIds.includes(s.id),
    );
    setNodes(nextNodes);
    setArrows(nextArrows);
    setStrokes(nextStrokes);
    setSelectedIds([]);
    pushDiscreteChange(before, {
      ...before,
      nodes: nextNodes,
      arrows: nextArrows,
      strokes: nextStrokes,
    });
  }, [
    captureBoardSnapshot,
    copySelected,
    locked,
    pushDiscreteChange,
    selectedIds,
  ]);

  const pasteClipboard = useCallback(() => {
    if (locked || !clipboardRef.current) return;
    const {
      nodes: cNodes,
      arrows: cArrows,
      strokes: cStrokes,
    } = clipboardRef.current;
    if (cNodes.length === 0 && cArrows.length === 0 && cStrokes.length === 0)
      return;

    const offset = 24;

    const newNodes = cNodes.map((n) => ({
      ...n,
      id: nextId(n.shape ?? 'node'),
      x: n.x + offset,
      y: n.y + offset,
    }));

    const newArrows = cArrows.map((a) => ({
      ...a,
      id: nextId('arrow'),
      start: { x: a.start.x + offset, y: a.start.y + offset },
      end: { x: a.end.x + offset, y: a.end.y + offset },
    }));

    const newStrokes = cStrokes.map((s) => ({
      ...s,
      id: nextId('stroke'),
      points: s.points.map((p) =>
        typeof p.pressure === 'number'
          ? { x: p.x + offset, y: p.y + offset, pressure: p.pressure }
          : { x: p.x + offset, y: p.y + offset },
      ),
    }));

    const before = captureBoardSnapshot();
    const nextNodes = [...before.nodes, ...newNodes];
    const nextArrows = [...before.arrows, ...newArrows];
    const nextStrokes = [...before.strokes, ...newStrokes];
    setNodes(nextNodes);
    setArrows(nextArrows);
    setStrokes(nextStrokes);

    const newSelectedIds = [
      ...newNodes.map((n) => n.id),
      ...newArrows.map((a) => a.id),
      ...newStrokes.map((s) => s.id),
    ];
    setSelectedIds(newSelectedIds);
    pushDiscreteChange(before, {
      ...before,
      nodes: nextNodes,
      arrows: nextArrows,
      strokes: nextStrokes,
    });
  }, [captureBoardSnapshot, locked, pushDiscreteChange]);

  const duplicateSelected = useCallback(() => {
    copySelected();
    pasteClipboard();
  }, [copySelected, pasteClipboard]);

  const updateSelectedNodes = useCallback(
    (updates: Partial<BoardNode>) => {
      if (locked || selectedIds.length === 0) return;
      const before = captureBoardSnapshot();
      const nextNodes = before.nodes.map((node) =>
        selectedIds.includes(node.id) ? { ...node, ...updates } : node,
      );
      setNodes(nextNodes);
      pushDiscreteChange(before, { ...before, nodes: nextNodes });
    },
    [captureBoardSnapshot, locked, pushDiscreteChange, selectedIds],
  );

  const moveSelectedLayer = useCallback(
    (direction: 'forward' | 'backward' | 'front' | 'back') => {
      if (locked || selectedIds.length === 0) return;
      const before = captureBoardSnapshot();
      const nextNodes = reorderBySelection(
        before.nodes,
        selectedIds,
        direction,
      );
      const nextArrows = reorderBySelection(
        before.arrows,
        selectedIds,
        direction,
      );
      const nextStrokes = reorderBySelection(
        before.strokes,
        selectedIds,
        direction,
      );
      setNodes(nextNodes);
      setArrows(nextArrows);
      setStrokes(nextStrokes);
      pushDiscreteChange(before, {
        ...before,
        nodes: nextNodes,
        arrows: nextArrows,
        strokes: nextStrokes,
      });
    },
    [captureBoardSnapshot, locked, pushDiscreteChange, selectedIds],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<SVGRectElement>, handle: string) => {
      if (
        locked ||
        !canvasRef.current ||
        selectedIds.length !== 1 ||
        !selectedNodeBounds ||
        isAuxClick(event)
      )
        return;
      event.stopPropagation();
      event.preventDefault();
      gestureBaseRef.current = null;
      interactionRef.current = {
        kind: 'resize',
        pointerId: event.pointerId,
        handle,
        targetId: selectedIds[0],
        originBounds: selectedNodeBounds,
      };
      canvasRef.current.setPointerCapture(event.pointerId);
    },
    [locked, selectedNodeBounds, selectedIds],
  );

  const handleRotatePointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      if (
        locked ||
        !canvasRef.current ||
        !selectedNodeBounds ||
        isAuxClick(event)
      )
        return;
      event.stopPropagation();
      event.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      viewportRectRef.current = rect;
      const screenPoint = pointerToViewportPoint(
        event,
        canvasRef.current,
        canvasViewportRef.current,
        rect,
      );
      const worldPoint = screenToWorld(
        screenPoint,
        cameraRef.current,
        canvasViewportRef.current,
      );
      const center = {
        x: (selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2,
        y: (selectedNodeBounds.minY + selectedNodeBounds.maxY) / 2,
      };
      const currentNodes = nodesRef.current;
      const targetIds = currentNodes
        .filter((node) => selectedIds.includes(node.id))
        .map((node) => node.id);
      if (targetIds.length === 0) return;
      gestureBaseRef.current = null;
      interactionRef.current = {
        kind: 'rotate',
        pointerId: event.pointerId,
        targetIds,
        center,
        startAngle: angleOfPoint(worldPoint, center),
        originNodes: currentNodes
          .filter((node) => targetIds.includes(node.id))
          .map((node) => ({
            id: node.id,
            rotation: normalizeRotation(node.rotation ?? 0),
          })),
        originArrows: arrowsRef.current
          .filter((arrow) => selectedIds.includes(arrow.id))
          .map((arrow) => ({
            id: arrow.id,
            start: { ...arrow.start },
            end: { ...arrow.end },
          })),
        originStrokes: strokesRef.current
          .filter((stroke) => selectedIds.includes(stroke.id))
          .map((stroke) => ({
            id: stroke.id,
            points: stroke.points.map((p) => ({ ...p })),
          })),
      };
      canvasRef.current.setPointerCapture(event.pointerId);
    },
    [locked, selectedNodeBounds, selectedIds],
  );

  const handleArrowEndpointPointerDown = useCallback(
    (
      event: ReactPointerEvent<SVGCircleElement>,
      arrowId: string,
      endpoint: 'start' | 'end',
    ) => {
      if (locked || !canvasRef.current || isAuxClick(event)) return;
      event.stopPropagation();
      event.preventDefault();
      gestureBaseRef.current = null;
      interactionRef.current = {
        kind: 'arrowEndpoint',
        pointerId: event.pointerId,
        arrowId,
        endpoint,
      };
      canvasRef.current.setPointerCapture(event.pointerId);
    },
    [locked],
  );

  const handleElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, elementId: string) => {
      if (!canvasRef.current || isAuxClick(event)) return;
      // Don't let a canvas drag extend a browser text selection.
      clearNativeSelection();
      event.preventDefault();
      viewportRectRef.current = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointerToViewportPoint(
        event,
        canvasRef.current,
        canvasViewport,
        viewportRectRef.current,
      );
      const worldPoint = screenToWorld(
        screenPoint,
        cameraRef.current,
        canvasViewport,
      );

      if (activeTool === 'hand') {
        gestureBaseRef.current = null;
        interactionRef.current = {
          kind: 'pan',
          pointerId: event.pointerId,
          lastScreen: screenPoint,
        };
        canvasRef.current.setPointerCapture(event.pointerId);
        return;
      }

      if (locked) return;

      gestureBaseRef.current = null;
      let nextSelected: string[];
      if (event.shiftKey) {
        nextSelected = selectedIds.includes(elementId)
          ? selectedIds.filter((id) => id !== elementId)
          : [...selectedIds, elementId];
      } else {
        nextSelected = selectedIds.includes(elementId)
          ? selectedIds
          : [elementId];
      }
      setSelectedIds(nextSelected);

      const startWorld = worldPoint;
      if (activeTool === 'select') {
        interactionRef.current = {
          kind: 'drag',
          pointerId: event.pointerId,
          startWorld,
          originNodes: nodes
            .filter((item) => nextSelected.includes(item.id))
            .map((item) => ({ id: item.id, x: item.x, y: item.y })),
          originArrows: arrows
            .filter((item) => nextSelected.includes(item.id))
            .map((item) => ({
              id: item.id,
              start: { ...item.start },
              end: { ...item.end },
            })),
          originStrokes: strokes
            .filter((item) => nextSelected.includes(item.id))
            .map((item) => ({
              id: item.id,
              points: item.points.map((p) => ({ ...p })),
            })),
        };
      } else if (activeTool === 'draw') {
        beginGesture();
        interactionRef.current = {
          kind: 'draw',
          pointerId: event.pointerId,
          points: [inkPointFromPointer(event.pressure, worldPoint)],
          color: activeColor,
          brushSize: brushRef.current.size,
          thinning: brushRef.current.thinning,
        };
      } else {
        beginGesture();
        interactionRef.current = {
          kind: 'create',
          pointerId: event.pointerId,
          tool: activeTool,
          startWorld: worldPoint,
          currentWorld: worldPoint,
          color: activeColor,
        };
      }

      canvasRef.current.setPointerCapture(event.pointerId);
    },
    [
      activeColor,
      activeTool,
      arrows,
      canvasViewport,
      beginGesture,
      locked,
      nodes,
      selectedIds,
      strokes,
    ],
  );

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<SVGGElement>, node: BoardNode) => {
      handleElementPointerDown(event, node.id);
    },
    [handleElementPointerDown],
  );

  const handleNodeKeySelect = useCallback(
    (event: ReactKeyboardEvent<SVGGElement>, node: BoardNode) => {
      if (locked) return;
      if (event.shiftKey) {
        setSelectedIds((current) =>
          current.includes(node.id)
            ? current.filter((id) => id !== node.id)
            : [...current, node.id],
        );
      } else {
        setSelectedIds([node.id]);
        if (event.key === 'Enter') handleNodeEdit(node.id);
      }
    },
    [handleNodeEdit, locked],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (isAuxClick(event)) return;
      clearNativeSelection();
      event.preventDefault();
      viewportRectRef.current = event.currentTarget.getBoundingClientRect();
      const screenPoint = pointerToViewportPoint(
        event,
        event.currentTarget,
        canvasViewport,
        viewportRectRef.current,
      );
      gestureBaseRef.current = null;

      // Middle-click or space-bar always pans
      if (event.button === 1 || spaceRef.current || activeTool === 'hand') {
        interactionRef.current = {
          kind: 'pan',
          pointerId: event.pointerId,
          lastScreen: screenPoint,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (locked) return;

      if (activeTool === 'select') {
        const startWorld = screenToWorld(
          screenPoint,
          cameraRef.current,
          canvasViewport,
        );
        interactionRef.current = {
          kind: 'marquee',
          pointerId: event.pointerId,
          startWorld,
          currentWorld: startWorld,
        };
        setMarquee(null);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const worldPoint = screenToWorld(
        screenPoint,
        cameraRef.current,
        canvasViewport,
      );
      if (activeTool === 'draw') {
        beginGesture();
        interactionRef.current = {
          kind: 'draw',
          pointerId: event.pointerId,
          points: [inkPointFromPointer(event.pressure, worldPoint)],
          color: activeColor,
          brushSize: brushRef.current.size,
          thinning: brushRef.current.thinning,
        };
      } else {
        beginGesture();
        interactionRef.current = {
          kind: 'create',
          pointerId: event.pointerId,
          tool: activeTool,
          startWorld: worldPoint,
          currentWorld: worldPoint,
          color: activeColor,
        };
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [activeColor, activeTool, canvasViewport, beginGesture, locked],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      event.preventDefault();

      const screenPoint = pointerToViewportPoint(
        event,
        event.currentTarget,
        canvasViewport,
        viewportRectRef.current,
      );

      if (interaction.kind === 'pan') {
        const delta = {
          x: screenPoint.x - interaction.lastScreen.x,
          y: screenPoint.y - interaction.lastScreen.y,
        };
        setCamera((current) => panCamera(current, delta));
        interactionRef.current = {
          ...interaction,
          lastScreen: screenPoint,
        };
        return;
      }

      const currentCamera = cameraRef.current;
      const worldPoint = screenToWorld(
        screenPoint,
        currentCamera,
        canvasViewport,
      );

      if (interaction.kind === 'arrowEndpoint') {
        beginGesture();
        const currentArrow = arrowsRef.current.find(
          (a) => a.id === interaction.arrowId,
        );
        if (!currentArrow) return;

        const currentNodes = nodesRef.current;
        const targetNode = findSnapNode(worldPoint, currentNodes);
        let newPoint = worldPoint;
        let boundNodeId: string | undefined = undefined;

        if (targetNode) {
          boundNodeId = targetNode.id;
          const otherPoint =
            interaction.endpoint === 'start'
              ? currentArrow.end
              : currentArrow.start;
          newPoint = getRoutedAnchor(
            targetNode,
            otherPoint,
            currentArrow.routing,
          );
        }

        setArrows((current) =>
          current.map((arrow) => {
            if (arrow.id !== interaction.arrowId) return arrow;
            if (interaction.endpoint === 'start') {
              return {
                ...arrow,
                start: newPoint,
                startNodeId: boundNodeId,
              };
            } else {
              return {
                ...arrow,
                end: newPoint,
                endNodeId: boundNodeId,
              };
            }
          }),
        );
        return;
      }

      if (interaction.kind === 'drag') {
        beginGesture();
        const delta = {
          x: worldPoint.x - interaction.startWorld.x,
          y: worldPoint.y - interaction.startWorld.y,
        };
        const movedNodeIds = interaction.originNodes.map((item) => item.id);

        setNodes((current) =>
          current.map((node) => {
            const origin = interaction.originNodes.find(
              (item) => item.id === node.id,
            );
            if (!origin) return node;
            const snapped = snapPoint({
              x: origin.x + delta.x,
              y: origin.y + delta.y,
            });
            return { ...node, x: snapped.x, y: snapped.y };
          }),
        );

        setArrows((current) =>
          current.map((arrow) => {
            const origin = interaction.originArrows?.find(
              (item) => item.id === arrow.id,
            );
            if (origin) {
              return {
                ...arrow,
                start: {
                  x: origin.start.x + delta.x,
                  y: origin.start.y + delta.y,
                },
                end: {
                  x: origin.end.x + delta.x,
                  y: origin.end.y + delta.y,
                },
              };
            }

            let startNodeId = arrow.startNodeId;
            let endNodeId = arrow.endNodeId;

            if (!startNodeId) {
              const currentNodes = nodesRef.current;
              const snap = findSnapNode(arrow.start, currentNodes, 10);
              if (snap) startNodeId = snap.id;
            }
            if (!endNodeId) {
              const currentNodes = nodesRef.current;
              const snap = findSnapNode(arrow.end, currentNodes, 10);
              if (snap) endNodeId = snap.id;
            }

            const startIsMoving =
              startNodeId && movedNodeIds.includes(startNodeId);
            const endIsMoving = endNodeId && movedNodeIds.includes(endNodeId);

            if (startIsMoving || endIsMoving) {
              const currentNodes = nodesRef.current;
              const nextNodesMap = new Map(
                currentNodes.map((node) => {
                  const isMoving = movedNodeIds.includes(node.id);
                  const nodeOrigin = interaction.originNodes.find(
                    (item) => item.id === node.id,
                  );
                  if (isMoving && nodeOrigin) {
                    const snapped = snapPoint({
                      x: nodeOrigin.x + delta.x,
                      y: nodeOrigin.y + delta.y,
                    });
                    return [node.id, { ...node, x: snapped.x, y: snapped.y }];
                  }
                  return [node.id, node];
                }),
              );

              const sNode = startNodeId ? nextNodesMap.get(startNodeId) : null;
              const eNode = endNodeId ? nextNodesMap.get(endNodeId) : null;

              let newStart = arrow.start;
              let newEnd = arrow.end;

              if (sNode && eNode) {
                newStart = getRoutedAnchor(
                  sNode,
                  nodeCenter(eNode),
                  arrow.routing,
                );
                newEnd = getRoutedAnchor(
                  eNode,
                  nodeCenter(sNode),
                  arrow.routing,
                );
              } else if (sNode) {
                newStart = getRoutedAnchor(sNode, arrow.end, arrow.routing);
              } else if (eNode) {
                newEnd = getRoutedAnchor(eNode, arrow.start, arrow.routing);
              }

              return {
                ...arrow,
                start: newStart,
                end: newEnd,
                startNodeId,
                endNodeId,
              };
            }

            return arrow;
          }),
        );

        setStrokes((current) =>
          current.map((stroke) => {
            const origin = interaction.originStrokes?.find(
              (item) => item.id === stroke.id,
            );
            if (!origin) return stroke;
            return {
              ...stroke,
              points: origin.points.map((p) =>
                typeof p.pressure === 'number'
                  ? { x: p.x + delta.x, y: p.y + delta.y, pressure: p.pressure }
                  : { x: p.x + delta.x, y: p.y + delta.y },
              ),
            };
          }),
        );
        return;
      }

      if (interaction.kind === 'rotate') {
        beginGesture();
        const center = interaction.center;
        const worldAngle = angleOfPoint(worldPoint, center);
        const rawDeltaDeg =
          ((worldAngle - interaction.startAngle) * 180) / Math.PI;
        // Shift snaps to 15° increments. Modifier meaning is per
        // interaction kind: Shift is aspect-lock while resizing.
        const deltaDeg = event.shiftKey
          ? snapAngle(rawDeltaDeg, 15)
          : rawDeltaDeg;
        const totalRad = degToRad(deltaDeg);
        const rotatingIds = new Set(
          interaction.originNodes.map((item) => item.id),
        );
        const currentNodes = nodesRef.current;
        const rotatedById = new Map<string, BoardNode>();
        for (const node of currentNodes) {
          const origin = interaction.originNodes.find(
            (item) => item.id === node.id,
          );
          rotatedById.set(
            node.id,
            origin
              ? {
                  ...node,
                  rotation: normalizeRotation(origin.rotation + deltaDeg),
                }
              : node,
          );
        }
        setNodes((current) =>
          current.map((node) => rotatedById.get(node.id) ?? node),
        );

        setArrows((current) =>
          current.map((arrow) => {
            const origin = interaction.originArrows?.find(
              (item) => item.id === arrow.id,
            );
            const base = origin ?? arrow;
            const startRotating =
              !!arrow.startNodeId && rotatingIds.has(arrow.startNodeId);
            const endRotating =
              !!arrow.endNodeId && rotatingIds.has(arrow.endNodeId);
            if (!startRotating && !endRotating) {
              // Free arrow: rigid rotation about the selection center.
              // Unselected, unattached arrows are left untouched.
              if (!origin) return arrow;
              return {
                ...arrow,
                start: rotatePoint(base.start, center, totalRad),
                end: rotatePoint(base.end, center, totalRad),
              };
            }
            // Bound ends re-anchor against the rotated node; free ends
            // rotate rigidly with the gesture.
            let newStart = startRotating
              ? base.start
              : rotatePoint(base.start, center, totalRad);
            let newEnd = endRotating
              ? base.end
              : rotatePoint(base.end, center, totalRad);
            const startId = arrow.startNodeId;
            const endId = arrow.endNodeId;
            if (startRotating && startId) {
              const sNode = rotatedById.get(startId);
              if (sNode) {
                const eNode =
                  endId !== undefined ? rotatedById.get(endId) : undefined;
                newStart = getRoutedAnchor(
                  sNode,
                  eNode ? nodeCenter(eNode) : newEnd,
                  arrow.routing,
                );
              }
            }
            if (endRotating && endId) {
              const eNode = rotatedById.get(endId);
              if (eNode) {
                const sNode =
                  startId !== undefined ? rotatedById.get(startId) : undefined;
                newEnd = getRoutedAnchor(
                  eNode,
                  sNode ? nodeCenter(sNode) : newStart,
                  arrow.routing,
                );
              }
            }
            return { ...arrow, start: newStart, end: newEnd };
          }),
        );

        setStrokes((current) =>
          current.map((stroke) => {
            const origin = interaction.originStrokes?.find(
              (item) => item.id === stroke.id,
            );
            if (!origin) return stroke;
            return {
              ...stroke,
              points: origin.points.map((p) => {
                const rotated = rotatePoint(p, center, totalRad);
                return typeof p.pressure === 'number'
                  ? { ...rotated, pressure: p.pressure }
                  : rotated;
              }),
            };
          }),
        );
        return;
      }

      if (interaction.kind === 'resize') {
        beginGesture();
        const targetId = interaction.targetId;
        const currentNodes = nodesRef.current;
        const targetNode = currentNodes.find((n) => n.id === targetId);
        const isImageNode = targetNode?.shape === 'image';
        const isTextNode = targetNode?.shape === 'text';
        const nextBounds = resizeAabb(
          interaction.originBounds,
          interaction.handle,
          worldPoint,
          event.shiftKey || isImageNode || isTextNode,
        );

        const nextWidth = nextBounds.maxX - nextBounds.minX;
        const nextHeight = nextBounds.maxY - nextBounds.minY;

        setNodes((current) =>
          current.map((node) => {
            if (node.id !== targetId) return node;
            if (node.shape === 'text') {
              const originHeight =
                interaction.originBounds.maxY - interaction.originBounds.minY;
              const scaleRatio =
                originHeight > 0 ? nextHeight / originHeight : 1;
              const originFontSize =
                node.fontSize ?? Math.max(14, Math.round(originHeight * 0.65));
              const newFontSize = Math.max(
                12,
                Math.round(originFontSize * scaleRatio),
              );
              return {
                ...node,
                x: nextBounds.minX,
                y: nextBounds.minY,
                width: nextWidth,
                height: nextHeight,
                fontSize: newFontSize,
              };
            }
            return {
              ...node,
              x: nextBounds.minX,
              y: nextBounds.minY,
              width: nextWidth,
              height: nextHeight,
            };
          }),
        );

        setArrows((current) =>
          current.map((arrow) => {
            if (
              arrow.startNodeId !== targetId &&
              arrow.endNodeId !== targetId
            ) {
              return arrow;
            }
            const currentNodes = nodesRef.current;
            const targetNode = currentNodes.find((n) => n.id === targetId);
            if (!targetNode) return arrow;

            const resizedNode = {
              ...targetNode,
              x: nextBounds.minX,
              y: nextBounds.minY,
              width: nextBounds.maxX - nextBounds.minX,
              height: nextBounds.maxY - nextBounds.minY,
            };
            let newStart = arrow.start;
            let newEnd = arrow.end;
            if (arrow.startNodeId === targetId) {
              const endNode = currentNodes.find(
                (n) => n.id === (arrow.endNodeId ?? ''),
              );
              newStart = getRoutedAnchor(
                resizedNode,
                endNode ? nodeCenter(endNode) : arrow.end,
                arrow.routing,
              );
            }
            if (arrow.endNodeId === targetId) {
              const startNode = currentNodes.find(
                (n) => n.id === (arrow.startNodeId ?? ''),
              );
              newEnd = getRoutedAnchor(
                resizedNode,
                startNode ? nodeCenter(startNode) : arrow.start,
                arrow.routing,
              );
            }
            return { ...arrow, start: newStart, end: newEnd };
          }),
        );
        return;
      }

      if (interaction.kind === 'draw') {
        // High-frequency pen input: fold in coalesced events so fast
        // strokes keep their pressure curve instead of chord-cutting it.
        const native = event.nativeEvent as PointerEvent & {
          getCoalescedEvents?: () => PointerEvent[];
        };
        const rawSamples =
          typeof native.getCoalescedEvents === 'function' &&
          native.getCoalescedEvents().length > 0
            ? native.getCoalescedEvents()
            : [native];
        const viewport = canvasViewportRef.current;
        const camera = cameraRef.current;
        const samples: InkPoint[] = [];
        for (const sample of rawSamples) {
          const screen = pointerToViewportPoint(
            { clientX: sample.clientX, clientY: sample.clientY },
            event.currentTarget,
            viewport,
            viewportRectRef.current,
          );
          samples.push(
            inkPointFromPointer(
              sample.pressure,
              screenToWorld(screen, camera, viewport),
            ),
          );
        }
        let nextPoints = interaction.points;
        for (const sample of samples) {
          const lastPoint = nextPoints[nextPoints.length - 1];
          const dx = sample.x - lastPoint.x;
          const dy = sample.y - lastPoint.y;
          if (dx * dx + dy * dy < 4) continue; // Skip if < 2px distance
          nextPoints = [...nextPoints, sample];
        }
        if (nextPoints === interaction.points) return;
        interactionRef.current = {
          ...interaction,
          points: nextPoints,
        };
        const brushSize = interaction.brushSize;
        const thinning = interaction.thinning;
        setStrokes((current) => {
          const last = current[current.length - 1];
          if (!last || last.id !== `draft-${interaction.pointerId}`) {
            return [
              ...current,
              {
                id: `draft-${interaction.pointerId}`,
                points: nextPoints,
                color: interaction.color,
                brushSize,
                thinning,
              },
            ];
          }
          return current.map((stroke) =>
            stroke.id === last.id ? { ...stroke, points: nextPoints } : stroke,
          );
        });
        return;
      }

      if (interaction.kind === 'create') {
        interactionRef.current = {
          ...interaction,
          currentWorld: worldPoint,
        };
        setCreatePreview({
          tool: interaction.tool,
          start: interaction.startWorld,
          end: worldPoint,
          color: interaction.color,
        });
        return;
      }

      const nextMarquee: Aabb = {
        minX: Math.min(interaction.startWorld.x, worldPoint.x),
        minY: Math.min(interaction.startWorld.y, worldPoint.y),
        maxX: Math.max(interaction.startWorld.x, worldPoint.x),
        maxY: Math.max(interaction.startWorld.y, worldPoint.y),
      };
      interactionRef.current = {
        ...interaction,
        currentWorld: worldPoint,
      };
      setMarquee(nextMarquee);

      const marqueeWidth = nextMarquee.maxX - nextMarquee.minX;
      const marqueeHeight = nextMarquee.maxY - nextMarquee.minY;
      if (marqueeWidth > 4 || marqueeHeight > 4) {
        const liveSelected = elementsInBounds(
          nextMarquee,
          nodesRef.current,
          arrowsRef.current,
          strokesRef.current,
        );
        setSelectedIds(liveSelected);
      }
    },
    [canvasViewport, beginGesture],
  );

  const handleCanvasPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;

      const screenPoint = pointerToViewportPoint(
        event,
        event.currentTarget,
        canvasViewport,
        viewportRectRef.current,
      );
      viewportRectRef.current = null;
      const currentCamera = cameraRef.current;
      const worldPoint = screenToWorld(
        screenPoint,
        currentCamera,
        canvasViewport,
      );

      if (interaction.kind === 'draw') {
        // Simplify on commit (not live) so stored/synced strokes stay
        // small while the in-progress stroke keeps full fidelity.
        const raw = [
          ...interaction.points,
          inkPointFromPointer(event.pressure, worldPoint),
        ];
        const points = simplifyInkPoints(raw);
        const brushSize = interaction.brushSize;
        const thinning = interaction.thinning;
        const committedId = nextId('stroke');
        setStrokes((current) =>
          current.map((stroke) =>
            stroke.id === `draft-${interaction.pointerId}`
              ? { ...stroke, id: committedId, points, brushSize, thinning }
              : stroke,
          ),
        );
        interactionRef.current = null;
        // Explicit post-state from the live ref (which holds the draft
        // stroke): the committed stroke hasn't rendered yet, so a plain
        // ref diff would miss it.
        const live = boardStateRef.current as unknown as BoardSnapshot;
        commitGesture({
          ...live,
          strokes: live.strokes.map((stroke) =>
            stroke.id === `draft-${interaction.pointerId}`
              ? { ...stroke, id: committedId, points, brushSize, thinning }
              : stroke,
          ),
        });
        flushPendingRemote();
        setActiveTool('select');
        gestureBaseRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }

      if (interaction.kind === 'create') {
        setCreatePreview(null);
        const start = interaction.startWorld;
        const end = worldPoint;
        const minX = Math.min(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const width = Math.max(
          Math.abs(end.x - start.x),
          interaction.tool === 'text' ? 160 : 96,
        );
        const height = Math.max(
          Math.abs(end.y - start.y),
          interaction.tool === 'text' ? 36 : 76,
        );
        const centerX = (start.x + end.x) / 2;
        const centerY = (start.y + end.y) / 2;

        if (interaction.tool === 'arrow') {
          const rawEnd =
            Math.abs(end.x - start.x) + Math.abs(end.y - start.y) > 10
              ? end
              : { x: start.x + 140, y: start.y };
          const currentNodes = nodesRef.current;
          const startNode = findSnapNode(start, currentNodes);
          const endNode = findSnapNode(rawEnd, currentNodes);

          let finalStart = start;
          let finalEnd = rawEnd;

          if (startNode && endNode && startNode.id !== endNode.id) {
            finalStart = getRoutedAnchor(
              startNode,
              nodeCenter(endNode),
              arrowRoutingRef.current,
            );
            finalEnd = getRoutedAnchor(
              endNode,
              nodeCenter(startNode),
              arrowRoutingRef.current,
            );
          } else if (startNode) {
            finalStart = getRoutedAnchor(
              startNode,
              rawEnd,
              arrowRoutingRef.current,
            );
          } else if (endNode) {
            finalEnd = getRoutedAnchor(endNode, start, arrowRoutingRef.current);
          }

          const createdArrow: BoardArrow = {
            id: nextId('arrow'),
            start: finalStart,
            end: finalEnd,
            color: interaction.color,
            startNodeId: startNode?.id,
            endNodeId: endNode?.id,
            routing: arrowRoutingRef.current,
          };
          setArrows((current) => [...current, createdArrow]);
          const liveAfterCreate =
            boardStateRef.current as unknown as BoardSnapshot;
          createCommitRef.current = {
            ...liveAfterCreate,
            arrows: [...liveAfterCreate.arrows, createdArrow],
          };
        } else {
          const shape =
            interaction.tool === 'note'
              ? 'note'
              : interaction.tool === 'ellipse'
                ? 'ellipse'
                : interaction.tool === 'text'
                  ? 'text'
                  : 'round';
          const node: BoardNode = {
            id: nextId(interaction.tool),
            label:
              interaction.tool === 'note'
                ? 'New thought'
                : interaction.tool === 'text'
                  ? 'Text'
                  : 'New shape',
            detail:
              interaction.tool === 'note'
                ? 'Click twice to refine'
                : interaction.tool === 'text'
                  ? ''
                  : 'Canvas object',
            x: snapPoint({
              x: interaction.tool === 'text' ? minX : centerX - width / 2,
              y: interaction.tool === 'text' ? minY : centerY - height / 2,
            }).x,
            y: snapPoint({
              x: interaction.tool === 'text' ? minX : centerX - width / 2,
              y: interaction.tool === 'text' ? minY : centerY - height / 2,
            }).y,
            width,
            height,
            tone:
              interaction.tool === 'note'
                ? 'note'
                : toneForColor(interaction.color),
            shape,
          };
          setNodes((current) => [...current, node]);
          setSelectedIds([node.id]);
          const liveAfterCreate =
            boardStateRef.current as unknown as BoardSnapshot;
          createCommitRef.current = {
            ...liveAfterCreate,
            nodes: [...liveAfterCreate.nodes, node],
          };
          if (interaction.tool === 'text' || interaction.tool === 'note') {
            setEditingNode({
              id: node.id,
              value: interaction.tool === 'text' ? '' : node.label,
            });
          }
        }
        interactionRef.current = null;
        // Explicit post-state: the created element hasn't rendered yet.
        commitGesture(createCommitRef.current ?? undefined);
        createCommitRef.current = null;
        flushPendingRemote();
        setActiveTool('select');
        gestureBaseRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }

      if (interaction.kind === 'marquee') {
        const bounds: Aabb = {
          minX: Math.min(interaction.startWorld.x, interaction.currentWorld.x),
          minY: Math.min(interaction.startWorld.y, interaction.currentWorld.y),
          maxX: Math.max(interaction.startWorld.x, interaction.currentWorld.x),
          maxY: Math.max(interaction.startWorld.y, interaction.currentWorld.y),
        };
        const w = bounds.maxX - bounds.minX;
        const h = bounds.maxY - bounds.minY;
        if (w <= 4 && h <= 4) {
          setSelectedIds([]);
        } else {
          const selected = elementsInBounds(
            bounds,
            nodesRef.current,
            arrowsRef.current,
            strokesRef.current,
          );
          setSelectedIds(selected);
        }
      }

      interactionRef.current = null;
      // Commit BEFORE flushing remotes: mid-gesture remotes are deferred,
      // so the ref holds local-only changes (see commitGesture).
      commitGesture();
      flushPendingRemote();
      setMarquee(null);
      setCreatePreview(null);
      gestureBaseRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [canvasViewport, commitGesture, flushPendingRemote],
  );

  const cancelInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    // Escape rolls the in-progress gesture back to its staged base.
    // Nothing is pushed: a cancelled gesture is not an undoable op.
    const base = gestureBaseRef.current;
    if (base) {
      setNodes(base.nodes);
      setArrows(base.arrows);
      setStrokes(base.strokes);
      setCode(base.code);
    }
    if (interaction?.kind === 'draw') {
      setStrokes((current) =>
        current.filter(
          (stroke) => stroke.id !== `draft-${interaction.pointerId}`,
        ),
      );
    }
    if (interaction?.kind === 'create') {
      setCreatePreview(null);
    }
    interactionRef.current = null;
    gestureBaseRef.current = null;
    viewportRectRef.current = null;
    setMarquee(null);
    flushPendingRemote();
  }, [flushPendingRemote]);

  const handleCanvasPointerCancel = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      cancelInteraction();
      viewportRectRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [cancelInteraction],
  );

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      const screenPoint = pointerToViewportPoint(
        event,
        event.currentTarget,
        canvasViewport,
        viewportRectRef.current,
      );
      // Normalize wheel/pinch deltas across mice, trackpads, and
      // deltaMode lines/pages so zoom speed feels consistent.
      const modeScale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const normalized = event.deltaY * modeScale;
      const delta = Math.max(-0.25, Math.min(0.25, -normalized * 0.0012));
      if (delta === 0) return;
      setCamera((current) =>
        zoomCameraAtPoint(current, screenPoint, delta, canvasViewport),
      );
    },
    [canvasViewport],
  );

  const wheelHandlerRef = useRef(handleCanvasWheel);
  useEffect(() => {
    wheelHandlerRef.current = handleCanvasWheel;
  }, [handleCanvasWheel]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      wheelHandlerRef.current(
        event as unknown as ReactWheelEvent<SVGSVGElement>,
      );
    };
    element.addEventListener('wheel', onWheelNative, { passive: false });
    return () => element.removeEventListener('wheel', onWheelNative);
  }, []);

  /* ── Export helpers (Export Pro: full-board, image-embed, vector PDF) ── */
  const roomTier = roomMeta?.tier;
  const requirePro = useCallback(() => {
    if (isProTier(roomTier)) return true;
    setBoardError(
      'Export Pro (PDF, bundle ZIP, GIF) needs a Pro or Enterprise room. Upgrade the room tier to unlock it — PNG, SVG, and JSON stay free.',
    );
    return false;
  }, [roomTier]);

  /** Full-board SVG clone framed to content bounds (not the viewport). */
  const prepareExportClone = useCallback(() => {
    const svg = canvasRef.current;
    if (!svg) throw new Error('The board canvas is not ready yet.');
    const bounds = contentBounds(nodes, arrows, strokes);
    const clone = cloneBoardSvg(svg);
    clone.setAttribute(
      'viewBox',
      `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`,
    );
    clone.setAttribute('width', String(Math.round(bounds.width)));
    clone.setAttribute('height', String(Math.round(bounds.height)));
    return { clone, bounds };
  }, [arrows, nodes, strokes]);

  const exportTicket = useCallback(
    () => (roomId ? getTicket(roomId) : undefined),
    [roomId],
  );

  const exportAsJSON = useCallback(() => {
    const data = { nodes, arrows, strokes, camera };
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `${boardFileSlug(boardTitle)}-board.json`,
    );
    setExportMenuOpen(false);
  }, [arrows, boardTitle, camera, nodes, strokes]);

  const exportAsSVG = useCallback(async () => {
    if (exportBusy) return;
    setExportBusy('svg');
    setExportProgress('Preparing SVG…');
    try {
      const { clone } = prepareExportClone();
      const result = await embedRemoteImages(clone, nodes, {
        roomId,
        ticket: exportTicket(),
        onProgress: (done, total) =>
          setExportProgress(
            total > 0 ? `Embedding images ${done}/${total}…` : 'Preparing SVG…',
          ),
      });
      const svgString = serializeSvg(clone);
      downloadBlob(
        new Blob([svgString], { type: 'image/svg+xml' }),
        `${boardFileSlug(boardTitle)}-board.svg`,
      );
      setBoardError(
        result.failed > 0
          ? `${result.failed} image(s) could not be embedded and show as placeholders.`
          : null,
      );
      setExportMenuOpen(false);
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : 'SVG export failed.',
      );
    } finally {
      setExportBusy(null);
      setExportProgress(null);
    }
  }, [exportBusy, exportTicket, nodes, boardTitle, prepareExportClone, roomId]);

  const exportAsPNG = useCallback(async () => {
    if (exportBusy) return;
    setExportBusy('png');
    setExportProgress('Preparing PNG…');
    try {
      const { clone, bounds } = prepareExportClone();
      await embedRemoteImages(clone, nodes, {
        roomId,
        ticket: exportTicket(),
        onProgress: (done, total) =>
          setExportProgress(
            total > 0 ? `Embedding images ${done}/${total}…` : 'Rendering PNG…',
          ),
      });
      setExportProgress('Rendering PNG…');
      const svgString = serializeSvg(clone);
      const blob = await svgStringToPngBlob(
        svgString,
        bounds.width,
        bounds.height,
        2,
      );
      downloadBlob(blob, `${boardFileSlug(boardTitle)}-board.png`);
      setExportMenuOpen(false);
    } catch (error) {
      setBoardError(
        error instanceof Error
          ? error.message
          : 'The board could not be exported as PNG. Try SVG instead.',
      );
    } finally {
      setExportBusy(null);
      setExportProgress(null);
    }
  }, [exportBusy, exportTicket, nodes, boardTitle, prepareExportClone, roomId]);

  const exportAsPDF = useCallback(async () => {
    if (exportBusy || !requirePro()) return;
    setExportBusy('pdf');
    setExportProgress('Preparing vector PDF…');
    try {
      const { clone, bounds } = prepareExportClone();
      const embed = await embedRemoteImages(clone, nodes, {
        roomId,
        ticket: exportTicket(),
        onProgress: (done, total) =>
          setExportProgress(
            total > 0 ? `Embedding images ${done}/${total}…` : 'Drawing PDF…',
          ),
      });
      setExportProgress('Drawing PDF…');
      const { buildVectorPdf } = await import('@/lib/whiteboard/export/pdf');
      const bytes = await buildVectorPdf({
        nodes,
        arrows,
        strokes,
        bounds,
        title: boardTitle,
        imageData: embed.imageData,
        onProgress: (done, total) =>
          setExportProgress(`Drawing PDF ${done}/${total}…`),
      });
      downloadBlob(
        new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
        `${boardFileSlug(boardTitle)}-board.pdf`,
      );
      setBoardError(
        embed.failed > 0
          ? `${embed.failed} image(s) could not be embedded and show as placeholders.`
          : null,
      );
      setExportMenuOpen(false);
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : 'PDF export failed.',
      );
    } finally {
      setExportBusy(null);
      setExportProgress(null);
    }
  }, [
    arrows,
    boardTitle,
    exportBusy,
    exportTicket,
    nodes,
    prepareExportClone,
    requirePro,
    roomId,
    strokes,
  ]);

  const exportAsBundle = useCallback(async () => {
    if (exportBusy || !requirePro()) return;
    setExportBusy('zip');
    setExportProgress('Preparing bundle…');
    try {
      const { clone, bounds } = prepareExportClone();
      const embed = await embedRemoteImages(clone, nodes, {
        roomId,
        ticket: exportTicket(),
        onProgress: (done, total) =>
          setExportProgress(
            total > 0 ? `Embedding images ${done}/${total}…` : 'Bundling…',
          ),
      });
      const svgString = serializeSvg(clone);
      setExportProgress('Rendering PNG…');
      const pngBlob = await svgStringToPngBlob(
        svgString,
        bounds.width,
        bounds.height,
        2,
      );
      setExportProgress('Drawing PDF…');
      const [{ buildVectorPdf }, { buildBoardBundle }] = await Promise.all([
        import('@/lib/whiteboard/export/pdf'),
        import('@/lib/whiteboard/export/zip'),
      ]);
      const pdfBytes = await buildVectorPdf({
        nodes,
        arrows,
        strokes,
        bounds,
        title: boardTitle,
        imageData: embed.imageData,
      });
      setExportProgress('Zipping bundle…');
      const zipBlob = await buildBoardBundle({
        boardTitle,
        roomId,
        roomTier: roomTier ?? null,
        nodes,
        arrows,
        strokes,
        camera,
        svgString,
        pngBlob,
        pdfBytes,
      });
      downloadBlob(zipBlob, `${boardFileSlug(boardTitle)}-bundle.zip`);
      setExportMenuOpen(false);
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : 'Bundle export failed.',
      );
    } finally {
      setExportBusy(null);
      setExportProgress(null);
    }
  }, [
    arrows,
    boardTitle,
    camera,
    exportBusy,
    exportTicket,
    nodes,
    prepareExportClone,
    requirePro,
    roomId,
    roomTier,
    strokes,
  ]);

  const exportAsGif = useCallback(async () => {
    if (exportBusy || !requirePro()) return;
    const svg = canvasRef.current;
    if (!svg) {
      setBoardError('The board canvas is not ready yet.');
      return;
    }
    setExportBusy('gif');
    setExportProgress('Preparing GIF…');
    try {
      const bounds = contentBounds(nodes, arrows, strokes);
      const { buildHistoryGif } = await import('@/lib/whiteboard/export/gif');
      setExportProgress('Encoding frames…');
      const blob = await buildHistoryGif({
        svg,
        nodes,
        arrows,
        strokes,
        bounds,
        roomId,
        ticket: exportTicket(),
        onProgress: (done, total) =>
          setExportProgress(`Encoding GIF ${done}/${total}…`),
      });
      downloadBlob(blob, `${boardFileSlug(boardTitle)}-board.gif`);
      setExportMenuOpen(false);
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : 'GIF export failed.',
      );
    } finally {
      setExportBusy(null);
      setExportProgress(null);
    }
  }, [
    arrows,
    boardTitle,
    exportBusy,
    exportTicket,
    nodes,
    requirePro,
    roomId,
    strokes,
  ]);

  /* ── Fit to content ── */
  const fitToContent = useCallback(() => {
    if (nodes.length === 0) return;
    const padding = 80;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    const contentW = Math.max(1, maxX - minX + padding * 2);
    const contentH = Math.max(1, maxY - minY + padding * 2);
    const scaleX = canvasViewport.width / contentW;
    const scaleY = canvasViewport.height / contentH;
    const nextZoom = Math.min(Math.max(Math.min(scaleX, scaleY, 1), 0.35), 2.2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setCamera({
      x: centerX,
      y: centerY,
      zoom: nextZoom,
    });
    setExportMenuOpen(false);
  }, [canvasViewport.height, canvasViewport.width, nodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (exportMenuOpen) {
          setExportMenuOpen(false);
          return;
        }
        if (editingNode) {
          cancelEdit();
          return;
        }
        cancelInteraction();
        setSelectedIds([]);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '0') resetCamera();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(selectAllIds());
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        cutSelected();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClipboard();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
      }
      if (
        !locked &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedIds.length > 0
      ) {
        const before = captureBoardSnapshot();
        const nextNodes = before.nodes.filter(
          (node) => !selectedIds.includes(node.id),
        );
        const nextArrows = before.arrows.filter(
          (arrow) => !selectedIds.includes(arrow.id),
        );
        const nextStrokes = before.strokes.filter(
          (stroke) => !selectedIds.includes(stroke.id),
        );
        setNodes(nextNodes);
        setArrows(nextArrows);
        setStrokes(nextStrokes);
        setSelectedIds([]);
        pushDiscreteChange(before, {
          ...before,
          nodes: nextNodes,
          arrows: nextArrows,
          strokes: nextStrokes,
        });
      }
      // Tool & Layer shortcuts (only when no modifier keys or with shift).
      // Skip while focus sits on a button/link so Space/Enter keep working.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const focusOnControl =
        target !== null &&
        (target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.getAttribute('role') === 'button');
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !focusOnControl
      ) {
        switch (event.key.toLowerCase()) {
          case 'v':
            selectTool('select');
            break;
          case 'h':
            selectTool('hand');
            break;
          case 'r':
            selectTool('rectangle');
            break;
          case 'e':
            selectTool('ellipse');
            break;
          case 'a':
            selectTool('arrow');
            break;
          case 'd':
            selectTool('draw');
            break;
          case 't':
            selectTool('text');
            break;
          case 'n':
            selectTool('note');
            break;
          case ']':
            moveSelectedLayer(event.shiftKey ? 'front' : 'forward');
            break;
          case '[':
            moveSelectedLayer(event.shiftKey ? 'back' : 'backward');
            break;
          case '=':
          case '+':
            adjustZoom(8);
            break;
          case '-':
            adjustZoom(-8);
            break;
          case ' ':
            event.preventDefault();
            spaceRef.current = true;
            break;
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        spaceRef.current = false;
      }
    };

    const handleBlur = () => {
      spaceRef.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    adjustZoom,
    cancelEdit,
    cancelInteraction,
    captureBoardSnapshot,
    copySelected,
    cutSelected,
    duplicateSelected,
    editingNode,
    exportMenuOpen,
    locked,
    moveSelectedLayer,
    pasteClipboard,
    pushDiscreteChange,
    redo,
    resetCamera,
    selectAllIds,
    selectTool,
    selectedIds,
    undo,
  ]);

  // Broadcast our canvas cursor to peers at ~20Hz. Uses refs only so
  // pointer traffic never re-renders.
  const broadcastCursor = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const now = Date.now();
      if (now - cursorBroadcastRef.current < 50) return;
      cursorBroadcastRef.current = now;
      const session = syncRef.current;
      if (!session) return;
      const viewport = canvasViewportRef.current;
      const screenPoint = pointerToViewportPoint(
        event,
        event.currentTarget,
        viewport,
      );
      session.setLocalCursor(
        screenToWorld(screenPoint, cameraRef.current, viewport),
      );
    },
    [],
  );

  const clearBroadcastCursor = useCallback(() => {
    syncRef.current?.setLocalCursor(null);
  }, []);

  // Broadcast active tool + selection to peers (throttled, trailing-edge
  // so rapid marquee changes settle instead of spamming awareness).
  const presenceMetaRef = useRef({ tool: activeTool, selection: selectedIds });
  const metaBroadcastAtRef = useRef(0);

  useEffect(() => {
    presenceMetaRef.current = { tool: activeTool, selection: selectedIds };
  });

  useEffect(() => {
    const session = syncRef.current;
    if (!session || !syncReady) return;
    const send = () => {
      metaBroadcastAtRef.current = Date.now();
      const meta = presenceMetaRef.current;
      syncRef.current?.setLocalPresenceMeta(
        meta.tool,
        meta.selection.slice(0, 200),
      );
    };
    if (Date.now() - metaBroadcastAtRef.current >= 250) {
      send();
      return;
    }
    const timer = window.setTimeout(send, 250);
    return () => window.clearTimeout(timer);
  }, [activeTool, selectedIds, syncReady]);

  const handleShare = useCallback(() => {
    const share = async () => {
      try {
        await navigator.clipboard.writeText(
          roomId ? buildInviteLink(roomId) : window.location.href,
        );
        setCopied(true);
        if (copiedTimerRef.current !== null)
          window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(
          () => setCopied(false),
          1800,
        );
      } catch {
        setBoardError(
          'Your browser blocked clipboard access. Copy the room URL from the address bar.',
        );
      }
    };
    void share();
  }, [roomId]);

  const handleAddImage = useCallback(() => {
    if (locked) return;
    imageInputRef.current?.click();
  }, [locked]);

  const handleImageChange = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = '';
      if (locked) return;
      const SUPPORTED_TYPES = new Set([
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
      ]);
      if (!SUPPORTED_TYPES.has(file.type)) {
        setBoardError('Choose a PNG, JPEG, WebP, or GIF image.');
        return;
      }
      if (file.size > 5_000_000) {
        setBoardError('Images must be 5 MB or smaller.');
        return;
      }
      if (!roomId || roomId.startsWith('local-')) {
        setBoardError(
          'Images need a live room. Reconnect the sync server and reload.',
        );
        return;
      }
      const uploadRoomId = roomId;
      const uploadTicket = getTicket(uploadRoomId);
      setBoardError('Uploading image…');
      try {
        const rawHref = await readFileAsDataUrl(file);
        // Downscale large photos before upload: smaller PUTs, smaller nodes.
        const { href, width, height } = await downscaleImageToDataUrl(
          rawHref,
          1024,
        );
        const bytes = await (await fetch(href)).blob();
        const grant = await requestImageUpload(uploadRoomId, uploadTicket, {
          contentType: file.type,
          kind: 'image',
        });
        await uploadImageBytes(grant.uploadUrl, bytes, file.type);
        const stored = await confirmImageUpload(uploadRoomId, uploadTicket, {
          key: grant.key,
          contentType: file.type,
          size: bytes.size,
          kind: 'image',
        });
        // The upload spans several awaits: if the user switched rooms (or
        // the component unmounted) meanwhile, the node belongs to the room
        // where the upload started — never the current one.
        if (roomIdRef.current !== uploadRoomId) return;
        const dimensions = {
          width: width || 400,
          height: height || 300,
        };

        const initWidth = Math.min(480, dimensions.width);
        const initHeight = Math.max(
          60,
          Math.round((initWidth / dimensions.width) * dimensions.height),
        );

        const node: BoardNode = {
          id: nextId('image'),
          label: file.name.slice(0, 100),
          detail: 'Imported image',
          x: camera.x - initWidth / 2,
          y: camera.y - initHeight / 2,
          width: initWidth,
          height: initHeight,
          tone: 'mint',
          shape: 'image',
          href: stored.url,
          imageId: stored.id,
        };
        const before = captureBoardSnapshot();
        const nextNodes = [...before.nodes, node];
        setNodes(nextNodes);
        setSelectedIds([node.id]);
        setActiveTool('select');
        setBoardError(null);
        pushDiscreteChange(before, { ...before, nodes: nextNodes });
      } catch (error) {
        setBoardError(
          error instanceof ApiError && error.code === 'R2_NOT_CONFIGURED'
            ? 'Image storage is not configured on the server. Set R2 credentials to enable uploads.'
            : error instanceof Error
              ? error.message
              : 'The image could not be imported.',
        );
      }
    },
    [
      camera.x,
      camera.y,
      captureBoardSnapshot,
      locked,
      pushDiscreteChange,
      roomId,
    ],
  );

  // Stored image URLs can be time-limited presigned links. On load failure,
  // fetch a fresh URL once per node and patch it in place.
  const imageRefreshRef = useRef(new Set<string>());

  const handleImageError = useCallback(
    (node: BoardNode) => {
      if (!node.imageId || !roomId || imageRefreshRef.current.has(node.imageId))
        return;
      imageRefreshRef.current.add(node.imageId);
      const imageId = node.imageId;
      void freshImageUrl(roomId, imageId, resolveRoomTicket())
        .then(({ url }) => {
          setNodes((current) =>
            current.map((entry) =>
              entry.imageId === imageId ? { ...entry, href: url } : entry,
            ),
          );
        })
        .catch(() => {
          // Leave the broken image in place; the user can delete it.
        });
    },
    [resolveRoomTicket, roomId],
  );

  // Typing produces one undo entry per ~5s window (not per keystroke).
  // The window base is the pre-burst code; the entry commits when the
  // user pauses, so only the local user's own typing is captured.
  const codeUndoBaseRef = useRef<string | null>(null);
  const codeUndoLatestRef = useRef('');
  const codeUndoTimerRef = useRef<number | null>(null);
  const codeUndoRoomRef = useRef<string | null>(null);

  const handleCodeChange = useCallback(
    (value: string) => {
      // Room-scoped bursts: a room switch drops any staged base, mirroring
      // the room effect that clears the undo stacks.
      if (codeUndoRoomRef.current !== roomIdRef.current) {
        codeUndoRoomRef.current = roomIdRef.current;
        codeUndoBaseRef.current = null;
        if (codeUndoTimerRef.current !== null) {
          window.clearTimeout(codeUndoTimerRef.current);
          codeUndoTimerRef.current = null;
        }
      }
      if (codeUndoBaseRef.current === null) {
        codeUndoBaseRef.current = boardStateRef.current.code;
      }
      codeUndoLatestRef.current = value;
      if (codeUndoTimerRef.current !== null) {
        window.clearTimeout(codeUndoTimerRef.current);
      }
      // If the room changes before the window commits, the burst belongs
      // to the old room: drop it with the room-scoped undo stacks.
      const burstRoomId = roomIdRef.current;
      codeUndoTimerRef.current = window.setTimeout(() => {
        codeUndoTimerRef.current = null;
        const base = codeUndoBaseRef.current;
        codeUndoBaseRef.current = null;
        if (
          base === null ||
          base === codeUndoLatestRef.current ||
          roomIdRef.current !== burstRoomId
        )
          return;
        pushUndoEntry({
          nodes: new Map(),
          arrows: new Map(),
          strokes: new Map(),
          codeBefore: base,
          codeAfter: codeUndoLatestRef.current,
        });
      }, 5000);
      setCode(value);
      setCompileState('draft');
    },
    [pushUndoEntry],
  );

  const selectEngine = useCallback((next: 'dagre' | 'elk' | 'tala') => {
    setEngine(next);
    try {
      window.localStorage.setItem('eunoia:engine', next);
    } catch {
      // Engine preference is best-effort.
    }
    setCompileState('draft');
  }, []);

  const compileCode = useCallback(async () => {
    const serverUrl = resolveSyncHttpUrl();
    if (!serverUrl) {
      setCompileState('draft');
      setBoardError(
        'D2 compilation is unavailable until NEXT_PUBLIC_SYNC_SERVER_URL is configured.',
      );
      return;
    }
    const source = code;
    if (!source.trim()) {
      setCompileState('draft');
      setBoardError(
        'Write some D2 code first — there is nothing to compile yet.',
      );
      return;
    }
    compileAbortRef.current?.abort();
    const controller = new AbortController();
    compileAbortRef.current = controller;
    setCompileState('compiling');
    try {
      const postCompile = async (withRoom: boolean) =>
        fetch(`${serverUrl}/api/compile`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Room ticket wins when present (locked rooms reject anything
            // else); otherwise the user token lets PRO accounts compile
            // without a room or above a room's tier. The user token also
            // rides along as x-user-token so both apply together.
            ...(withRoom && roomId && resolveRoomTicket()
              ? { authorization: `Bearer ${resolveRoomTicket()}` }
              : resolveUserToken()
                ? { authorization: `Bearer ${resolveUserToken()}` }
                : {}),
            ...(resolveUserToken()
              ? { 'x-user-token': resolveUserToken() as string }
              : {}),
          },
          body: JSON.stringify(
            withRoom && roomId
              ? { source, engine, roomId }
              : { source, engine },
          ),
          signal: controller.signal,
        });
      // Read as text first: error responses are not guaranteed to be JSON
      // (proxies, gateways, or server crashes can answer plain text/HTML),
      // and a blind `response.json()` turns those into a cryptic
      // "Unexpected token ... is not valid JSON" toast.
      const readPayload = async (res: Response): Promise<unknown> => {
        const text = await res.text();
        if (!text.trim()) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          const snippet = text.trim().slice(0, 160);
          throw new Error(
            `D2 compilation failed (${res.status}). The server returned a non-JSON response${snippet ? `: ${snippet}` : '.'}`,
          );
        }
      };
      let response = await postCompile(true);
      let payload: unknown = await readPayload(response);
      if (!response.ok) {
        const body =
          payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : null;
        // The room row may not exist yet (sync auto-creates it on connect),
        // but `roomId` is only tier gating for Pro engines — retry as plain
        // COMMUNITY instead of failing the compile.
        if (response.status === 404 && body?.code === 'ROOM_NOT_FOUND') {
          response = await postCompile(false);
          payload = await readPayload(response);
        }
      }
      if (!response.ok) {
        const body =
          payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : null;
        // A dead session must not linger: drop it and point at sign-in.
        if (response.status === 401 && body?.code === 'INVALID_TOKEN') {
          clearSession();
          setSession(null);
          throw new Error(
            'Your sign-in expired. Sign in again to use Pro features.',
          );
        }
        const message =
          body && typeof body.error === 'string'
            ? body.error
            : `D2 compilation failed (${response.status}).`;
        // The banner renders an "Upgrade to Pro" button whenever the
        // message carries this marker (see the boardError banner below).
        const hint =
          body?.code === 'TIER_UPGRADE_REQUIRED'
            ? ' This diagram needs a Pro layout engine or fewer nodes.'
            : '';
        const details =
          body?.code === 'VALIDATION_ERROR' && Array.isArray(body?.issues)
            ? ` (${(body.issues as Array<Record<string, unknown>>)
                .map((issue) =>
                  [issue.path, issue.message].filter(Boolean).join(' '),
                )
                .join('; ')})`
            : '';
        throw new Error(`${message}${hint}${details}`);
      }
      const diagram = parseCompileResponse(payload);
      if (!diagram) {
        throw new Error(
          'D2 compiler returned an invalid response. The board was left unchanged.',
        );
      }
      lastCompiledCodeRef.current = source;
      if (diagram.placeholder) {
        // Placeholder carries no layout, so there is nothing to reconcile.
        // Never report this as a success: the board was left untouched and
        // the user must know the compiler is not connected.
        const upstream =
          payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>).error
            : null;
        setCompileState('draft');
        setBoardError(
          typeof upstream === 'string' && upstream
            ? `Diagram unchanged: ${upstream}`
            : 'The D2 compiler is not connected, so the board was left unchanged. Start it with `docker compose up d2-compiler` and restart the sync server.',
        );
        return;
      }
      const before = captureBoardSnapshot();
      const next = reconcileDiagram(
        nodesRef.current,
        arrowsRef.current,
        diagram,
        getAnchorPoint,
        nodeCenter,
      );
      const keptIds = new Set([
        ...next.nodes.map((node) => node.id),
        ...next.arrows.map((arrow) => arrow.id),
      ]);
      setNodes(next.nodes);
      setArrows(next.arrows);
      setSelectedIds((current) => current.filter((id) => keptIds.has(id)));
      setCompileState('compiled');
      setBoardError(null);
      // Reconcile is a local op: capture it so undo restores the
      // pre-compile arrangement without touching peer edits.
      pushDiscreteChange(before, {
        ...before,
        nodes: next.nodes,
        arrows: next.arrows,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setCompileState('draft');
      setBoardError(
        error instanceof Error
          ? error.message
          : 'D2 compilation failed. Try again.',
      );
    } finally {
      if (compileAbortRef.current === controller)
        compileAbortRef.current = null;
    }
  }, [
    captureBoardSnapshot,
    code,
    engine,
    pushDiscreteChange,
    roomId,
    resolveRoomTicket,
    resolveUserToken,
  ]);

  // Natural-language → D2: the server holds the LLM key, the result flows
  // back into the editor and compiles through the normal pipeline (with
  // undo support from handleCodeChange).
  const generateWithAi = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    if (locked) return;
    setAiBusy(true);
    setBoardError(null);
    try {
      const { generateDiagram } = await import('@/lib/whiteboard/ai-api');
      const result = await generateDiagram(prompt, {
        roomId: roomId ?? undefined,
        ticket: roomId ? getTicket(roomId) : undefined,
        userToken: resolveUserToken(),
      });
      setAiQuota(result.quota);
      setAiPrompt('');
      handleCodeChange(result.d2);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') {
        setBoardError('Sign in to generate diagrams with AI.');
      } else if (
        error instanceof ApiError &&
        error.code === 'AI_NOT_CONFIGURED'
      ) {
        setBoardError(
          'AI generation is not configured on this server. Set AI_API_KEY to enable it.',
        );
      } else {
        setBoardError(
          error instanceof Error ? error.message : 'AI generation failed.',
        );
      }
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, aiPrompt, handleCodeChange, locked, resolveUserToken, roomId]);

  // Auto-compile a short pause after the user stops typing, as promised by
  // the footer copy. Skips when the code already matches the last success.
  useEffect(() => {
    if (!hasHydrated || compileState !== 'draft') return;
    if (code === lastCompiledCodeRef.current) return;
    const timeoutId = window.setTimeout(() => {
      void compileCode();
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [code, compileState, hasHydrated, compileCode]);

  useEffect(
    () => () => {
      compileAbortRef.current?.abort();
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current);
      if (codeUndoTimerRef.current !== null)
        window.clearTimeout(codeUndoTimerRef.current);
    },
    [],
  );

  const activeEditingNode = editingNode
    ? nodes.find((n) => n.id === editingNode.id)
    : null;
  // Derived from state only (svgPixelSize is tracked via ResizeObserver),
  // so render never reads refs — fixes the react-hooks/refs violation and
  // keeps the overlay aligned after resizes.
  const activeEditingNodeScreenPos = useMemo(() => {
    if (!activeEditingNode || !svgPixelSize) return null;
    const screenPt = worldToScreen(
      { x: activeEditingNode.x, y: activeEditingNode.y },
      camera,
      canvasViewport,
    );
    // Convert from viewport-relative SVG coords to pixel offset within the SVG element
    const pxX = (screenPt.x / canvasViewport.width) * svgPixelSize.width;
    const pxY = (screenPt.y / canvasViewport.height) * svgPixelSize.height;
    return { x: pxX, y: pxY };
  }, [activeEditingNode, camera, canvasViewport, svgPixelSize]);

  // Keep the browser tab in sync with the board name.
  useEffect(() => {
    document.title = `${boardTitle} – Eunoia`;
  }, [boardTitle]);

  // Close the header menus on outside click / Escape.
  useEffect(() => {
    if (!exportMenuOpen && !accountMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        exportMenuRef.current &&
        event.target instanceof Node &&
        !exportMenuRef.current.contains(event.target)
      ) {
        setExportMenuOpen(false);
      }
      if (
        accountMenuRef.current &&
        event.target instanceof Node &&
        !accountMenuRef.current.contains(event.target)
      ) {
        setAccountMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExportMenuOpen(false);
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportMenuOpen, accountMenuOpen]);

  if (!roomId) {
    return (
      <div className="eunoia-board-shell room-gate">
        <div className="room-gate-card" role="status">
          <h1>Opening your board…</h1>
          <p>Setting up a realtime room.</p>
        </div>
      </div>
    );
  }

  // Don't flash the full board (or an empty canvas) before access is
  // validated: locked rooms would briefly render behind the gate.
  if (roomStatus === 'loading') {
    return (
      <div className="eunoia-board-shell room-gate">
        <div className="room-gate-card" role="status">
          <h1>Opening your board…</h1>
          <p>Checking room access.</p>
        </div>
      </div>
    );
  }

  if (roomStatus === 'missing') {
    return (
      <div className="eunoia-board-shell room-gate">
        <div className="room-gate-card" role="alert">
          <h1>Room not found</h1>
          <p>
            No room exists with id <code>{roomId}</code>. It may have been
            deleted.
          </p>
          <button
            type="button"
            className="compile-button"
            onClick={() => router.replace('/board')}
          >
            Create a new board
          </button>
        </div>
      </div>
    );
  }

  if (roomStatus === 'locked' && roomId) {
    const lockedRoomId = roomId;
    return (
      <UnlockDialog
        roomId={lockedRoomId}
        onUnlocked={(meta, _nextTicket) => {
          // Ticket already stored by the dialog; flipping to ready
          // reconnects the sync session, which reads the store live.
          setRoomMeta(meta);
          setRoomStatus('ready');
        }}
        onCreateNew={() => router.replace('/board')}
      />
    );
  }

  return (
    <div className="eunoia-board-shell">
      <input
        ref={imageInputRef}
        className="board-file-input"
        type="file"
        accept="image/*"
        onChange={handleImageChange}
      />
      <header className="board-header">
        <div className="board-brand-block">
          <Link className="board-brand" href="/" aria-label="Eunoia home">
            <span className="board-brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>Eunoia</span>
          </Link>
          <span className="header-divider" aria-hidden="true" />
          <button
            className="board-title-control"
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              if (roomMeta && !roomId?.startsWith('local-')) {
                setShowRoomSettings(true);
              } else {
                const newTitle = window.prompt('Rename diagram', boardTitle);
                const trimmed = newTitle?.trim().slice(0, 60);
                if (trimmed) setBoardTitle(trimmed);
              }
            }}
          >
            <span className="board-title">{boardTitle}</span>
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="board-header-center">
          <div className="save-state">
            <span className={`save-dot save-dot--${persistenceState}`} />
            <span>
              {persistenceState === 'loading'
                ? 'Loading board'
                : persistenceState === 'saving'
                  ? 'Saving locally'
                  : persistenceState === 'error'
                    ? 'Save unavailable'
                    : 'All changes saved'}
            </span>
          </div>
          <span className="header-location">
            workspace / {roomMeta?.name ?? roomId ?? 'loading'}
            {roomMeta?.hasPassword ? ' · locked' : ''}
          </span>
        </div>

        <div className="board-header-actions">
          <div
            className="presence-stack"
            role="status"
            aria-label={
              peers.length > 0
                ? `Live room: connected with ${peers.length} ${peers.length === 1 ? 'teammate' : 'teammates'} (${peers.map((peer) => peer.user.name).join(', ')})`
                : syncStatus === 'connected'
                  ? 'Live room: connected'
                  : syncStatus === 'offline'
                    ? 'Local room: changes stay in this browser'
                    : 'Room: connecting'
            }
            title={
              peers.length > 0
                ? peers.map((peer) => peer.user.name).join(', ')
                : syncStatus === 'connected'
                  ? 'Live room: connected'
                  : syncStatus === 'offline'
                    ? 'Local room'
                    : 'Connecting…'
            }
          >
            {peers.slice(0, 4).map((peer) => (
              <PresenceAvatar
                key={peer.clientId}
                initials={initialsForName(peer.user.name)}
                color={peer.user.color}
                title={peer.user.name}
              />
            ))}
            {peers.length > 4 ? (
              <span className="presence-more" aria-hidden="true">
                +{peers.length - 4}
              </span>
            ) : syncStatus === 'connected' ? (
              <span
                className="presence-more presence-more--live"
                aria-hidden="true"
              >
                ●
              </span>
            ) : null}
          </div>
          <button
            className="header-icon-button"
            type="button"
            aria-label="Search board"
            title="Search board"
            onClick={() => setShowSearch((value) => !value)}
          >
            <Search size={17} />
          </button>
          <button className="share-button" type="button" onClick={handleShare}>
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            {copied ? 'Link copied' : 'Share room'}
          </button>
          <button
            className="share-button"
            type="button"
            title="Team workspaces"
            aria-label="Team workspaces"
            onClick={() => setShowWorkspaces(true)}
          >
            <Layers2 size={16} />
            Workspaces
          </button>
          {mounted && session ? (
            <div ref={accountMenuRef} style={{ position: 'relative' }}>
              <button
                className="header-icon-button"
                type="button"
                aria-label={`Account: ${session.user.email}`}
                title={session.user.email}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
              >
                <span
                  className="presence-avatar"
                  style={{ backgroundColor: '#7c5cff', marginLeft: 0 }}
                  aria-hidden="true"
                >
                  {initialsForName(session.user.name ?? session.user.email)}
                </span>
              </button>
              {accountMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 6,
                    minWidth: 220,
                    background: '#fff',
                    border: '1px solid #e3e2ea',
                    borderRadius: 10,
                    boxShadow: '0 6px 24px rgba(37,39,71,0.14)',
                    zIndex: 50,
                    overflow: 'hidden',
                    padding: '10px 14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#35374a',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {session.user.name ?? session.user.email}
                  </div>
                  {session.user.name ? (
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {session.user.email}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      marginTop: 8,
                      fontSize: 13,
                    }}
                  >
                    <a
                      href="/pricing"
                      style={{ color: '#5b54c7', fontWeight: 600 }}
                    >
                      Plans
                    </a>
                    <a
                      href="/billing"
                      style={{ color: '#5b54c7', fontWeight: 600 }}
                    >
                      Billing
                    </a>
                    <a
                      href="/status"
                      style={{ color: '#5b54c7', fontWeight: 600 }}
                    >
                      Status
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearSession();
                      setSession(null);
                      setAccountMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginTop: 8,
                      border: 0,
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 13,
                      color: '#e5484d',
                      padding: 0,
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <a
              className="share-button"
              href={`/login?next=${encodeURIComponent(
                roomId
                  ? `/board?room=${roomId}${
                      // Tickets hydrate client-side only; reading them
                      // during the first render would mismatch SSR HTML.
                      mounted && resolveRoomTicket()
                        ? `&ticket=${resolveRoomTicket()}`
                        : ''
                    }`
                  : '/board',
              )}`}
            >
              Sign in
            </a>
          )}
          <div ref={exportMenuRef} style={{ position: 'relative' }}>
            <button
              className="header-icon-button"
              type="button"
              aria-label="More board actions"
              title="More board actions"
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              onClick={() => setExportMenuOpen((prev) => !prev)}
            >
              <Ellipsis size={18} />
            </button>
            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 6,
                  minWidth: 180,
                  background: '#fff',
                  border: '1px solid #e3e2ea',
                  borderRadius: 10,
                  boxShadow: '0 6px 24px rgba(37,39,71,0.14)',
                  zIndex: 50,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={fitToContent}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Maximize2 size={15} /> Fit to content
                </button>
                <div
                  style={{
                    height: 1,
                    background: '#eeedf2',
                    margin: '0 10px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void exportAsPNG()}
                  disabled={exportBusy !== null}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: exportBusy ? 'wait' : 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    opacity: exportBusy && exportBusy !== 'png' ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Export as PNG
                  {exportBusy === 'png' ? '…' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => void exportAsSVG()}
                  disabled={exportBusy !== null}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: exportBusy ? 'wait' : 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    opacity: exportBusy && exportBusy !== 'svg' ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Export as SVG
                  {exportBusy === 'svg' ? '…' : ''}
                </button>
                <button
                  type="button"
                  onClick={exportAsJSON}
                  disabled={exportBusy !== null}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: exportBusy ? 'wait' : 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    opacity: exportBusy ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Export as JSON
                </button>
                <div
                  style={{
                    height: 1,
                    background: '#eeedf2',
                    margin: '0 10px',
                  }}
                />
                <div
                  style={{
                    padding: '8px 14px 2px',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: '#8a8ca3',
                  }}
                >
                  Export Pro
                  {!isProTier(roomMeta?.tier) ? ' — upgrade room' : ''}
                </div>
                <button
                  type="button"
                  onClick={() => void exportAsPDF()}
                  disabled={exportBusy !== null}
                  title={
                    isProTier(roomMeta?.tier)
                      ? 'True vector PDF with selectable text'
                      : 'Requires a Pro or Enterprise room tier'
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: exportBusy ? 'wait' : 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    opacity:
                      exportBusy && exportBusy !== 'pdf'
                        ? 0.5
                        : !isProTier(roomMeta?.tier)
                          ? 0.75
                          : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Export PDF (vector)
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: isProTier(roomMeta?.tier)
                        ? '#ede9ff'
                        : '#f1f0f6',
                      color: isProTier(roomMeta?.tier) ? '#5b54c7' : '#8a8ca3',
                    }}
                  >
                    PRO
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void exportAsBundle()}
                  disabled={exportBusy !== null}
                  title={
                    isProTier(roomMeta?.tier)
                      ? 'ZIP with PDF + PNG + SVG + JSON'
                      : 'Requires a Pro or Enterprise room tier'
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: exportBusy ? 'wait' : 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    opacity:
                      exportBusy && exportBusy !== 'zip'
                        ? 0.5
                        : !isProTier(roomMeta?.tier)
                          ? 0.75
                          : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Bundle ZIP
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: isProTier(roomMeta?.tier)
                        ? '#ede9ff'
                        : '#f1f0f6',
                      color: isProTier(roomMeta?.tier) ? '#5b54c7' : '#8a8ca3',
                    }}
                  >
                    PRO
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void exportAsGif()}
                  disabled={exportBusy !== null}
                  title={
                    isProTier(roomMeta?.tier)
                      ? 'Animated build-up replay of the board'
                      : 'Requires a Pro or Enterprise room tier'
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: exportBusy ? 'wait' : 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    opacity:
                      exportBusy && exportBusy !== 'gif'
                        ? 0.5
                        : !isProTier(roomMeta?.tier)
                          ? 0.75
                          : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Replay GIF
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: isProTier(roomMeta?.tier)
                        ? '#ede9ff'
                        : '#f1f0f6',
                      color: isProTier(roomMeta?.tier) ? '#5b54c7' : '#8a8ca3',
                    }}
                  >
                    PRO
                  </span>
                </button>
                {exportProgress ? (
                  <div
                    role="status"
                    style={{
                      padding: '8px 14px 10px',
                      fontSize: 12,
                      color: '#6b6d85',
                    }}
                  >
                    {exportProgress}
                  </div>
                ) : null}
                <div
                  style={{
                    height: 1,
                    background: '#eeedf2',
                    margin: '0 10px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setExportMenuOpen(false);
                    setShowCreateRoom(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#35374a',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Square size={15} /> New board
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportMenuOpen(false);
                    if (
                      window.confirm(
                        'Delete this board and its history? This cannot be undone.',
                      )
                    ) {
                      const doomedRoomId = roomId;
                      if (!doomedRoomId || doomedRoomId.startsWith('local-')) {
                        // Local-only rooms have no server counterpart: just
                        // leave to a fresh board instead of 404ing the API.
                        router.replace('/board');
                        return;
                      }
                      // DELETE needs room access AND owner auth: thread the
                      // user token like updateRoom does, and surface the
                      // sign-in requirement instead of a bare 401 message.
                      void deleteRoom(
                        doomedRoomId,
                        getTicket(doomedRoomId),
                        resolveUserToken(),
                      )
                        .then(() => {
                          clearTicket(doomedRoomId);
                          // Replace (not push): Back must not land on the
                          // just-deleted room's missing state.
                          router.replace('/board');
                        })
                        .catch((error: unknown) => {
                          setBoardError(
                            error instanceof ApiError &&
                              error.code === 'AUTH_REQUIRED'
                              ? 'Sign in to delete this board — only its owner can.'
                              : error instanceof ApiError
                                ? error.message
                                : 'Could not delete the board.',
                          );
                        });
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#e5484d',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Minus size={15} /> Delete board
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="board-workspace" id="canvas">
        <aside className="board-toolbar" aria-label="Canvas tools">
          <div className="toolbar-group toolbar-group--primary">
            <ToolButton
              label="Select"
              active={activeTool === 'select'}
              onClick={() => selectTool('select')}
            >
              <MousePointer2 size={18} />
            </ToolButton>
            <ToolButton
              label="Pan canvas"
              active={activeTool === 'hand'}
              onClick={() => selectTool('hand')}
            >
              <Hand size={18} />
            </ToolButton>
            <span className="toolbar-rule" />
            <ToolButton
              label="Sticky note"
              active={activeTool === 'note'}
              onClick={() => selectTool('note')}
            >
              <StickyNote size={18} />
            </ToolButton>
            <ToolButton
              label="Rectangle"
              active={activeTool === 'rectangle'}
              onClick={() => selectTool('rectangle')}
            >
              <Square size={18} />
            </ToolButton>
            <ToolButton
              label="Ellipse"
              active={activeTool === 'ellipse'}
              onClick={() => selectTool('ellipse')}
            >
              <Circle size={18} />
            </ToolButton>
            <ToolButton
              label="Connector"
              active={activeTool === 'arrow'}
              onClick={() => selectTool('arrow')}
            >
              <ArrowRight size={18} />
            </ToolButton>
            <ToolButton
              label="Draw"
              active={activeTool === 'draw'}
              onClick={() => selectTool('draw')}
            >
              <Pencil size={18} />
            </ToolButton>
            <ToolButton
              label="Text"
              active={activeTool === 'text'}
              onClick={() => selectTool('text')}
            >
              <Type size={18} />
            </ToolButton>
          </div>

          <div className="toolbar-group toolbar-group--secondary">
            <ToolButton label="Add image" onClick={handleAddImage}>
              <ImageIcon size={17} />
            </ToolButton>
            <ToolButton
              label="Select all objects"
              onClick={() => setSelectedIds(selectAllIds())}
            >
              <Layers2 size={17} />
            </ToolButton>
          </div>

          <div className="toolbar-footer">
            <div className="color-swatch-row" aria-label="Quick colors">
              <button
                className="color-swatch color-swatch--ink"
                type="button"
                aria-label="Use ink color"
                onClick={() => setActiveColor('#25263a')}
              />
              <button
                className="color-swatch color-swatch--orange"
                type="button"
                aria-label="Use orange color"
                onClick={() => setActiveColor('#ef8c52')}
              />
              <button
                className="color-swatch color-swatch--blue"
                type="button"
                aria-label="Use blue color"
                onClick={() => setActiveColor('#4a86c6')}
              />
              <button
                className="color-swatch color-swatch--yellow"
                type="button"
                aria-label="Use yellow color"
                onClick={() => setActiveColor('#f7d66f')}
              />
            </div>
            <span className="toolbar-rule" />
            <button
              className="help-button"
              type="button"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
            >
              ?
            </button>
          </div>
        </aside>

        <section className="board-stage" aria-label="Infinite canvas">
          <div className="board-floating-toolbar" aria-label="Drawing tools">
            <button
              className={`floating-tool floating-tool--quiet ${locked ? 'is-active' : ''}`}
              type="button"
              aria-label={locked ? 'Unlock canvas' : 'Lock canvas'}
              title={locked ? 'Unlock canvas' : 'Lock canvas'}
              onClick={() => setLocked((value) => !value)}
            >
              <LockKeyhole size={15} />
            </button>
            <span className="floating-rule" />
            <ToolButton
              label="Select"
              active={activeTool === 'select'}
              onClick={() => selectTool('select')}
            >
              <MousePointer2 size={17} />
            </ToolButton>
            <ToolButton
              label="Pan canvas"
              active={activeTool === 'hand'}
              onClick={() => selectTool('hand')}
            >
              <Hand size={17} />
            </ToolButton>
            <ToolButton
              label="Sticky note"
              active={activeTool === 'note'}
              onClick={() => selectTool('note')}
            >
              <StickyNote size={17} />
            </ToolButton>
            <ToolButton
              label="Rectangle"
              active={activeTool === 'rectangle'}
              onClick={() => selectTool('rectangle')}
            >
              <Square size={17} />
            </ToolButton>
            <ToolButton
              label="Ellipse"
              active={activeTool === 'ellipse'}
              onClick={() => selectTool('ellipse')}
            >
              <Circle size={17} />
            </ToolButton>
            <ToolButton
              label="Connector"
              active={activeTool === 'arrow'}
              onClick={() => selectTool('arrow')}
            >
              <ArrowRight size={17} />
            </ToolButton>
            <ToolButton
              label="Draw"
              active={activeTool === 'draw'}
              onClick={() => selectTool('draw')}
            >
              <Pencil size={17} />
            </ToolButton>
            <ToolButton
              label="Text"
              active={activeTool === 'text'}
              onClick={() => selectTool('text')}
            >
              <Type size={17} />
            </ToolButton>
            <ToolButton label="Add image" onClick={handleAddImage}>
              <ImageIcon size={17} />
            </ToolButton>
            <span className="floating-rule" />
            <button
              className="floating-tool floating-tool--quiet"
              type="button"
              aria-label="Open D2 source"
              title="Open D2 source"
              onClick={() => setShowCode((value) => !value)}
            >
              <Code2 size={16} />
            </button>
          </div>

          {stylePanelOpen ? (
            <aside
              className="board-style-panel"
              aria-label="Selected object style"
            >
              <div className="style-panel-title">
                <div>
                  <span>Style</span>
                  <small>
                    {selectedNode && selectedId
                      ? selectedNode.label
                      : 'Nothing selected'}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label="Close style panel"
                  onClick={() => setStylePanelOpen(false)}
                >
                  <Ellipsis size={16} />
                </button>
              </div>
              <fieldset
                disabled={locked}
                style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
              >
                <div className="style-section">
                  <span className="style-label">Stroke</span>
                  <div className="style-swatch-row">
                    <button
                      className="style-swatch style-swatch--ink is-selected"
                      type="button"
                      aria-label="Ink stroke"
                      onClick={() => applySelectedColor('#25263a', 'mint')}
                    />
                    <button
                      className="style-swatch style-swatch--red"
                      type="button"
                      aria-label="Red stroke"
                      onClick={() => applySelectedColor('#df4c54', 'orange')}
                    />
                    <button
                      className="style-swatch style-swatch--green"
                      type="button"
                      aria-label="Green stroke"
                      onClick={() => applySelectedColor('#3caa62', 'mint')}
                    />
                    <button
                      className="style-swatch style-swatch--blue"
                      type="button"
                      aria-label="Blue stroke"
                      onClick={() => applySelectedColor('#4a86c6', 'blue')}
                    />
                    <button
                      className="style-swatch style-swatch--orange"
                      type="button"
                      aria-label="Orange stroke"
                      onClick={() => applySelectedColor('#ef8c52', 'orange')}
                    />
                    <button
                      className="style-swatch style-swatch--yellow"
                      type="button"
                      aria-label="Yellow stroke"
                      onClick={() => applySelectedColor('#f7d66f', 'yellow')}
                    />
                  </div>
                </div>
                <div className="style-section">
                  <span className="style-label">Background</span>
                  <div className="style-swatch-row">
                    <button
                      className="style-swatch style-swatch--transparent"
                      type="button"
                      aria-label="Transparent background"
                      onClick={() => updateSelectedNodes({ fill: 'none' })}
                    />
                    <button
                      className="style-swatch style-swatch--lavender"
                      type="button"
                      aria-label="Lavender background"
                      onClick={() => updateSelectedNodes({ fill: '#dbd7fa' })}
                    />
                    <button
                      className="style-swatch style-swatch--peach"
                      type="button"
                      aria-label="Peach background"
                      onClick={() => updateSelectedNodes({ fill: '#ffc8be' })}
                    />
                    <button
                      className="style-swatch style-swatch--mint"
                      type="button"
                      aria-label="Mint background"
                      onClick={() => updateSelectedNodes({ fill: '#b9ebcf' })}
                    />
                    <button
                      className="style-swatch style-swatch--sky"
                      type="button"
                      aria-label="Sky background"
                      onClick={() => updateSelectedNodes({ fill: '#badff3' })}
                    />
                    <button
                      className="style-swatch style-swatch--lemon"
                      type="button"
                      aria-label="Lemon background"
                      onClick={() => updateSelectedNodes({ fill: '#ffe895' })}
                    />
                  </div>
                </div>
                <div className="style-section style-section--split">
                  <div>
                    <span className="style-label">Stroke width</span>
                    <div className="style-choice-row">
                      <button
                        className="style-choice"
                        type="button"
                        aria-label="Thin stroke"
                        onClick={() =>
                          updateSelectedNodes({ strokeWidth: 1.5 })
                        }
                      >
                        <Minus size={16} />
                      </button>
                      <button
                        className="style-choice is-selected"
                        type="button"
                        aria-label="Medium stroke"
                        onClick={() => updateSelectedNodes({ strokeWidth: 2 })}
                      >
                        <Minus size={16} strokeWidth={2.6} />
                      </button>
                      <button
                        className="style-choice"
                        type="button"
                        aria-label="Thick stroke"
                        onClick={() => updateSelectedNodes({ strokeWidth: 4 })}
                      >
                        <Minus size={16} strokeWidth={4} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="style-label">Stroke style</span>
                    <div className="style-choice-row">
                      <button
                        className="style-choice is-selected"
                        type="button"
                        aria-label="Solid stroke"
                        onClick={() => updateSelectedNodes({ dashed: false })}
                      >
                        <Minus size={16} />
                      </button>
                      <button
                        className="style-choice"
                        type="button"
                        aria-label="Dashed stroke"
                        onClick={() => updateSelectedNodes({ dashed: true })}
                      >
                        <Minus size={16} strokeDasharray="3 3" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="style-section">
                  <span className="style-label">Connector routing</span>
                  <div className="style-choice-row">
                    {(
                      [
                        { id: 'straight', label: 'Straight' },
                        { id: 'orthogonal', label: 'Orthogonal' },
                        { id: 'curved', label: 'Curved' },
                      ] as Array<{ id: ArrowRouting; label: string }>
                    ).map((option) => {
                      const isActive =
                        (selectedArrowRouting ?? arrowRouting) === option.id;
                      return (
                        <button
                          key={option.id}
                          className={`style-choice ${isActive ? 'is-selected' : ''}`}
                          type="button"
                          aria-label={`${option.label} routing`}
                          aria-pressed={isActive}
                          title={
                            selectedArrowCount > 0
                              ? `Apply ${option.label.toLowerCase()} routing to selection`
                              : `New arrows use ${option.label.toLowerCase()} routing`
                          }
                          onClick={() => applyArrowRouting(option.id)}
                        >
                          <svg
                            width="22"
                            height="14"
                            viewBox="0 0 22 14"
                            aria-hidden="true"
                          >
                            {option.id === 'straight' && (
                              <line
                                x1="2"
                                y1="12"
                                x2="20"
                                y2="2"
                                stroke="currentColor"
                                strokeWidth="2"
                              />
                            )}
                            {option.id === 'orthogonal' && (
                              <path
                                d="M 2 12 L 2 7 L 20 7 L 20 2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              />
                            )}
                            {option.id === 'curved' && (
                              <path
                                d="M 2 12 C 8 12, 14 2, 20 2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              />
                            )}
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="style-section style-section--split">
                  <div>
                    <span className="style-label">Brush size</span>
                    <div className="style-choice-row">
                      {[
                        { size: 4, label: 'Fine pen' },
                        { size: 8, label: 'Medium pen' },
                        { size: 16, label: 'Thick pen' },
                      ].map((option) => (
                        <button
                          key={option.size}
                          className={`style-choice ${brushSize === option.size ? 'is-selected' : ''}`}
                          type="button"
                          aria-label={option.label}
                          aria-pressed={brushSize === option.size}
                          title={
                            selectedStrokeCount > 0
                              ? `Apply ${option.label.toLowerCase()} to selection`
                              : `New strokes use ${option.label.toLowerCase()}`
                          }
                          onClick={() => applyBrushSize(option.size)}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              display: 'block',
                              width: Math.min(18, 4 + option.size),
                              height: Math.min(18, 4 + option.size),
                              borderRadius: '50%',
                              background: 'currentColor',
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="style-label-row">
                      <span className="style-label">Pressure</span>
                      <span className="style-value">
                        {Math.round(brushThinning * 100)}
                      </span>
                    </div>
                    <input
                      className="opacity-input"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(brushThinning * 100)}
                      aria-label="Pressure sensitivity"
                      onChange={(event) =>
                        applyBrushThinning(Number(event.target.value) / 100)
                      }
                    />
                  </div>
                </div>
                <div className="style-section">
                  <div className="style-label-row">
                    <span className="style-label">Opacity</span>
                    <span className="style-value">{selectedOpacity}</span>
                  </div>
                  <input
                    className="opacity-input"
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={selectedOpacity}
                    aria-label="Opacity"
                    disabled={!selectedNode || locked}
                    onChange={(event) =>
                      updateSelectedNodes({
                        opacity: Number(event.target.value) / 100,
                      })
                    }
                  />
                </div>
                <div className="style-section">
                  <span className="style-label">Layers</span>
                  <div className="style-choice-row style-choice-row--wide">
                    <button
                      className="style-choice"
                      type="button"
                      aria-label="Bring forward"
                      onClick={() => moveSelectedLayer('forward')}
                    >
                      <Layers2 size={16} />
                    </button>
                    <button
                      className="style-choice"
                      type="button"
                      aria-label="Send backward"
                      onClick={() => moveSelectedLayer('backward')}
                    >
                      <Layers2 size={16} />
                    </button>
                    <button
                      className="style-choice"
                      type="button"
                      aria-label="Bring to front"
                      onClick={() => moveSelectedLayer('front')}
                    >
                      <Layers2 size={16} />
                    </button>
                    <button
                      className="style-choice"
                      type="button"
                      aria-label="Send to back"
                      onClick={() => moveSelectedLayer('back')}
                    >
                      <Layers2 size={16} />
                    </button>
                  </div>
                </div>
              </fieldset>
              <div className="style-panel-footer">
                <span>Selected object</span>
                <span>⌘ K</span>
              </div>
            </aside>
          ) : (
            <button
              className="style-panel-reopen"
              type="button"
              aria-label="Open style panel"
              title="Open style panel"
              onClick={() => setStylePanelOpen(true)}
            >
              <PanelRight size={15} />
            </button>
          )}

          <div className="stage-toolbar">
            <div className="stage-breadcrumb">
              <span className="stage-breadcrumb__root">
                {roomMeta?.name ?? 'Board'}
              </span>
              <ArrowRight size={13} />
              <span>Canvas</span>
            </div>
            <div className="stage-actions">
              <button
                className="stage-action"
                type="button"
                onClick={() => setShowCode((value) => !value)}
              >
                <Code2 size={15} />
                {showCode ? 'Hide D2' : 'Open D2'}
              </button>
              <button
                className="stage-action"
                type="button"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((value) => !value)}
              >
                <RotateCcw size={15} />
                History
              </button>
              <button
                className="stage-action stage-action--icon"
                type="button"
                aria-label="Reset canvas view"
                title="Reset canvas view"
                onClick={resetCamera}
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>

          <div className="canvas-viewport">
            {showHistory && roomId ? (
              <HistoryPanel
                key={roomId}
                roomId={roomId}
                ticket={resolveRoomTicket()}
                onClose={() => setShowHistory(false)}
              />
            ) : null}
            {showSearch ? (
              <SearchPalette
                nodes={nodes}
                onClose={() => setShowSearch(false)}
                onJump={(node) => {
                  const center = nodeCenter(node);
                  setCamera((current) => ({
                    ...current,
                    x: center.x,
                    y: center.y,
                  }));
                  setSelectedIds([node.id]);
                  setShowSearch(false);
                }}
              />
            ) : null}
            {boardError && (
              <div className="board-error" role="alert">
                <span>{boardError}</span>
                {boardError.includes('needs a Pro layout engine') ? (
                  <button
                    type="button"
                    onClick={() => router.push('/pricing')}
                    style={{
                      marginLeft: 8,
                      border: 0,
                      borderRadius: 999,
                      padding: '4px 12px',
                      background: '#5b54c7',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Upgrade to Pro
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Dismiss message"
                  onClick={() => setBoardError(null)}
                >
                  <Check size={13} />
                </button>
              </div>
            )}
            <div className="canvas-caption">
              <div>
                <span className="canvas-caption__title">
                  {roomMeta?.name ?? boardTitle}
                </span>
                <span className="canvas-caption__meta">
                  {nodes.length} objects · {connectors.length + arrows.length}{' '}
                  connections ·{' '}
                  {syncStatus === 'connected' ? 'synced' : 'local mode'}
                </span>
              </div>
              <span className="canvas-caption__tag">
                <Cloud size={13} />{' '}
                {syncStatus === 'connected'
                  ? 'Live room'
                  : syncStatus === 'offline'
                    ? 'Local room'
                    : 'Connecting'}
              </span>
            </div>

            <svg
              ref={canvasRef}
              className="board-canvas"
              viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
              role="application"
              aria-label="Architecture whiteboard. Drag empty space to select, drag shapes to move, double-click a shape to edit its label."
              aria-describedby="canvas-hint"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={(event) => {
                broadcastCursor(event);
                handleCanvasPointerMove(event);
              }}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerCancel}
              onPointerLeave={clearBroadcastCursor}
              onDragStart={(event) => event.preventDefault()}
              onContextMenu={(event) => {
                // Let right-clicks open the native menu; never start a board gesture.
                if (interactionRef.current) {
                  cancelInteraction();
                }
                event.stopPropagation();
              }}
            >
              <defs>
                <pattern
                  id="dotGrid"
                  width="24"
                  height="24"
                  patternUnits="userSpaceOnUse"
                >
                  <circle className="canvas-grid" cx="12" cy="12" r="1" />
                </pattern>
                <marker
                  id="arrowhead"
                  markerWidth="11"
                  markerHeight="11"
                  refX="8"
                  refY="4"
                  orient="auto"
                >
                  <path d="M 0 0 L 9 4 L 0 8 z" fill="#6b7192" />
                </marker>
                {[...arrowMarkerIds.entries()].map(([color, id]) => (
                  <marker
                    key={id}
                    id={id}
                    markerWidth="11"
                    markerHeight="11"
                    refX="8"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M 0 0 L 9 4 L 0 8 z" fill={color} />
                  </marker>
                ))}
                <filter
                  id="softShadow"
                  x="-20%"
                  y="-20%"
                  width="140%"
                  height="160%"
                >
                  <feDropShadow
                    dx="0"
                    dy="5"
                    stdDeviation="6"
                    floodColor="#222544"
                    floodOpacity="0.12"
                  />
                </filter>
              </defs>
              <rect
                className="canvas-background"
                x={viewBox.minX - 2000}
                y={viewBox.minY - 2000}
                width={viewBox.width + 4000}
                height={viewBox.height + 4000}
              />
              <rect
                x={viewBox.minX - 2000}
                y={viewBox.minY - 2000}
                width={viewBox.width + 4000}
                height={viewBox.height + 4000}
                fill="url(#dotGrid)"
                style={{ pointerEvents: 'none' }}
              />
              <g className="canvas-main">
                <g filter="url(#softShadow)">
                  {connectors.map((connector) => (
                    <Connector
                      key={`${connector.from}-${connector.to}`}
                      path={connector.path}
                      label={connector.label}
                      labelX={connector.labelPosition.x}
                      labelY={connector.labelPosition.y}
                      dashed={connector.dashed}
                    />
                  ))}
                </g>
                <g className="board-freehand-layer">
                  {visibleStrokes.map((stroke) => {
                    const isSelected = selectedIds.includes(stroke.id);
                    // Pressure ink renders as a filled variable-width
                    // outline; legacy centerline strokes keep the uniform
                    // look. Computed once per stroke per render.
                    const inkD = inkOutlinePath(stroke);
                    const isOutline = inkD.endsWith('Z');
                    return (
                      <g
                        key={stroke.id}
                        className={`stroke-group ${isSelected ? 'is-selected' : ''}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          handleElementPointerDown(event, stroke.id);
                        }}
                      >
                        <path
                          d={isOutline ? inkD : smoothPath(stroke.points)}
                          fill={isOutline ? 'transparent' : 'none'}
                          stroke="transparent"
                          strokeWidth="18"
                          style={{
                            cursor:
                              activeTool === 'select' ? 'pointer' : 'default',
                          }}
                        />
                        {isOutline ? (
                          <path
                            d={inkD}
                            fill={stroke.color}
                            fillOpacity={stroke.opacity ?? 1}
                            stroke="none"
                          />
                        ) : (
                          <path
                            d={smoothPath(stroke.points)}
                            fill="none"
                            stroke={stroke.color}
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        {isSelected && (
                          <path
                            d={isOutline ? inkD : smoothPath(stroke.points)}
                            fill="none"
                            stroke="#6965db"
                            strokeWidth={isOutline ? 2 : 6}
                            strokeDasharray="4 4"
                            opacity="0.7"
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
                <g className="board-arrow-layer">
                  {visibleArrows.map((arrow) => {
                    const isSelected = selectedIds.includes(arrow.id);
                    const markerId =
                      arrowMarkerIds.get(arrow.color) ?? 'arrowhead';
                    const routedD = arrowPath(arrow);
                    return (
                      <g
                        key={arrow.id}
                        className={`arrow-group ${isSelected ? 'is-selected' : ''}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          handleElementPointerDown(event, arrow.id);
                        }}
                      >
                        <path
                          d={routedD}
                          fill="none"
                          stroke="transparent"
                          strokeWidth="18"
                          style={{
                            cursor:
                              activeTool === 'select' ? 'pointer' : 'default',
                          }}
                        />
                        <path
                          d={routedD}
                          fill="none"
                          stroke={arrow.color}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          markerEnd={`url(#${markerId})`}
                        />
                        {isSelected && (
                          <>
                            <path
                              d={routedD}
                              fill="none"
                              stroke="#6965db"
                              strokeWidth="5"
                              strokeDasharray="4 4"
                              opacity="0.6"
                            />
                            <circle
                              cx={arrow.start.x}
                              cy={arrow.start.y}
                              r="6"
                              fill="#ffffff"
                              stroke="#6965db"
                              strokeWidth="2.5"
                              style={{ cursor: 'move' }}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                handleArrowEndpointPointerDown(
                                  event,
                                  arrow.id,
                                  'start',
                                );
                              }}
                            />
                            <circle
                              cx={arrow.end.x}
                              cy={arrow.end.y}
                              r="6"
                              fill="#ffffff"
                              stroke="#6965db"
                              strokeWidth="2.5"
                              style={{ cursor: 'move' }}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                handleArrowEndpointPointerDown(
                                  event,
                                  arrow.id,
                                  'end',
                                );
                              }}
                            />
                          </>
                        )}
                      </g>
                    );
                  })}
                </g>
                {visibleNodes.map((node) => (
                  <CanvasNode
                    key={node.id}
                    node={node}
                    selected={selectedIds.includes(node.id)}
                    onPointerDown={(event) =>
                      handleNodePointerDown(event, node)
                    }
                    onDoubleClick={() => handleNodeEdit(node.id)}
                    onKeySelect={(event, target) =>
                      handleNodeKeySelect(event, target)
                    }
                    onImageError={handleImageError}
                  />
                ))}
              </g>
              <g className="canvas-interactive" data-interactive>
                {selectedNodeBounds && !locked && (
                  <>
                    <rect
                      className="selection-outline"
                      x={selectedNodeBounds.minX - 8}
                      y={selectedNodeBounds.minY - 8}
                      width={
                        selectedNodeBounds.maxX - selectedNodeBounds.minX + 16
                      }
                      height={
                        selectedNodeBounds.maxY - selectedNodeBounds.minY + 16
                      }
                      rx="8"
                    />
                    <line
                      className="rotation-stem"
                      x1={
                        (selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2
                      }
                      y1={selectedNodeBounds.minY - 8}
                      x2={
                        (selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2
                      }
                      y2={selectedNodeBounds.minY - 31}
                    />
                    <circle
                      className="rotation-handle"
                      cx={
                        (selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2
                      }
                      cy={selectedNodeBounds.minY - 37}
                      r="7"
                      style={{ cursor: 'grab', pointerEvents: 'all' }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        handleRotatePointerDown(event);
                      }}
                    >
                      <title>Drag to rotate (Shift snaps to 15°)</title>
                    </circle>
                    {resizeHandles(selectedNodeBounds).map((handle) => (
                      <rect
                        key={handle.id}
                        className="transform-handle"
                        x={handle.x - 5}
                        y={handle.y - 5}
                        width="10"
                        height="10"
                        rx="2"
                        onPointerDown={(event) =>
                          handleResizePointerDown(event, handle.id)
                        }
                      />
                    ))}
                  </>
                )}
                {marquee && (
                  <rect
                    className="marquee-selection"
                    x={marquee.minX}
                    y={marquee.minY}
                    width={marquee.maxX - marquee.minX}
                    height={marquee.maxY - marquee.minY}
                  />
                )}
                {peerSelectionOutlines.map((outline) => (
                  <g key={outline.key} pointerEvents="none">
                    <rect
                      className="peer-selection-outline"
                      x={outline.bounds.minX - 6}
                      y={outline.bounds.minY - 6}
                      width={outline.bounds.maxX - outline.bounds.minX + 12}
                      height={outline.bounds.maxY - outline.bounds.minY + 12}
                      rx="8"
                      fill="none"
                      stroke={outline.color}
                      strokeWidth="2"
                      strokeDasharray="6 4"
                      opacity="0.85"
                    >
                      <title>{`${outline.name} is editing this`}</title>
                    </rect>
                  </g>
                ))}
                <RemoteCursors peers={peers} />
                {createPreview &&
                  (() => {
                    const px = Math.min(
                      createPreview.start.x,
                      createPreview.end.x,
                    );
                    const py = Math.min(
                      createPreview.start.y,
                      createPreview.end.y,
                    );
                    const pw = Math.abs(
                      createPreview.end.x - createPreview.start.x,
                    );
                    const ph = Math.abs(
                      createPreview.end.y - createPreview.start.y,
                    );
                    if (pw < 2 && ph < 2) return null;
                    if (createPreview.tool === 'ellipse') {
                      return (
                        <ellipse
                          cx={px + pw / 2}
                          cy={py + ph / 2}
                          rx={pw / 2}
                          ry={ph / 2}
                          fill="none"
                          stroke={createPreview.color}
                          strokeWidth="2"
                          strokeDasharray="6 4"
                          opacity="0.6"
                        />
                      );
                    }
                    return (
                      <rect
                        x={px}
                        y={py}
                        width={pw}
                        height={ph}
                        rx={createPreview.tool === 'note' ? 2 : 6}
                        fill="none"
                        stroke={createPreview.color}
                        strokeWidth="2"
                        strokeDasharray="6 4"
                        opacity="0.6"
                      />
                    );
                  })()}
              </g>
            </svg>

            {/* In-place text editing overlay */}
            {activeEditingNode && editingNode && activeEditingNodeScreenPos && (
              <input
                ref={(el) => {
                  if (el) el.focus();
                }}
                type="text"
                value={editingNode.value}
                placeholder={
                  activeEditingNode.shape === 'text'
                    ? 'Type text...'
                    : 'Edit label...'
                }
                onChange={(e) =>
                  setEditingNode({ ...editingNode, value: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') cancelEdit();
                  e.stopPropagation();
                }}
                onBlur={commitEdit}
                style={{
                  position: 'absolute',
                  left: activeEditingNodeScreenPos.x,
                  top: activeEditingNodeScreenPos.y,
                  minWidth: Math.max(
                    activeEditingNode.width * camera.zoom,
                    120,
                  ),
                  height: Math.max(activeEditingNode.height * camera.zoom, 36),
                  fontSize: Math.max(13 * camera.zoom, 12),
                  fontFamily:
                    activeEditingNode.shape === 'note'
                      ? "'Excalifont', 'Comic Sans MS', cursive"
                      : "'Inter', system-ui, sans-serif",
                  fontWeight: 600,
                  textAlign:
                    activeEditingNode.shape === 'text' ? 'left' : 'center',
                  border: '2px solid #6965db',
                  borderRadius: 6,
                  outline: 'none',
                  background: 'rgba(255,255,255,0.98)',
                  color: '#25263a',
                  padding: '4px 8px',
                  zIndex: 100,
                  boxShadow: '0 4px 16px rgba(105,101,219,0.22)',
                }}
              />
            )}

            {selectedNode && selectedId && (
              <div className="selection-popover" role="status">
                <div className="selection-popover__title">
                  <span
                    className={`selection-tone selection-tone--${selectedNode.tone}`}
                  />
                  {selectedNode.label}
                </div>
                <span className="selection-popover__meta">
                  D2 node · editable
                </span>
                <button
                  type="button"
                  aria-label="Open node properties"
                  onClick={() => setShowCode(true)}
                >
                  <PanelRight size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="stage-footer">
            <div className="zoom-control" aria-label="Zoom controls">
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => adjustZoom(-8)}
              >
                <ZoomOut size={16} />
              </button>
              <button
                className="zoom-value"
                type="button"
                onClick={resetCamera}
              >
                {zoomLabel(camera.zoom * 100)}
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => adjustZoom(8)}
              >
                <ZoomIn size={16} />
              </button>
              <span className="zoom-divider" />
              <button
                type="button"
                aria-label="Fit canvas"
                title="Fit canvas"
                onClick={resetCamera}
              >
                <Maximize2 size={15} />
              </button>
            </div>
            <div className="canvas-hint" id="canvas-hint">
              <Hand size={14} /> Drag to move · scroll to zoom
            </div>
            <div className="history-control">
              <button
                type="button"
                aria-label="Undo"
                title="Undo"
                onClick={undo}
                disabled={undoDepth === 0}
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo"
                onClick={redo}
                disabled={redoDepth === 0}
              >
                <Redo2 size={16} />
              </button>
            </div>
          </div>
        </section>

        {showCode && (
          <aside className="code-panel" aria-label="D2 code editor">
            <div className="code-panel-header">
              <div className="code-panel-heading">
                <div className="code-icon">
                  <Code2 size={16} />
                </div>
                <div>
                  <span className="code-panel-title">D2 source</span>
                  <span className="code-panel-subtitle">
                    native diagram layer
                  </span>
                </div>
              </div>
              <button
                className="code-close"
                type="button"
                aria-label="Close D2 editor"
                title="Close D2 editor"
                onClick={() => setShowCode(false)}
              >
                <PanelRight size={16} />
              </button>
            </div>
            <div className="code-panel-status">
              <span
                className={`code-status-dot code-status-dot--${compileState}`}
              />
              <span>
                {compileState === 'draft'
                  ? 'Draft changes'
                  : compileState === 'compiling'
                    ? 'Compiling…'
                    : compileState === 'compiled'
                      ? 'Compiled successfully'
                      : 'Ready to compile'}
              </span>
              <span className="code-line-count">
                {code.split('\n').length} lines
              </span>
            </div>
            <form
              className="code-ai-row"
              style={{ display: 'flex', gap: 8, padding: '8px 12px' }}
              onSubmit={(event) => {
                event.preventDefault();
                void generateWithAi();
              }}
            >
              <div style={{ position: 'relative', flex: 1 }}>
                <Sparkles
                  size={14}
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    opacity: 0.55,
                    pointerEvents: 'none',
                  }}
                />
                <input
                  aria-label="Describe a diagram to generate"
                  placeholder="Describe a diagram… (AI)"
                  value={aiPrompt}
                  maxLength={4000}
                  disabled={aiBusy}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px 8px 30px',
                    borderRadius: 10,
                    border: '1px solid #e3e2ea',
                    fontSize: 13,
                  }}
                />
              </div>
              <button
                type="submit"
                className="compile-button"
                disabled={aiBusy || !aiPrompt.trim()}
                title={
                  aiQuota
                    ? `AI quota: ${aiQuota.used}/${aiQuota.limit} this month`
                    : 'Generate D2 from description'
                }
              >
                {aiBusy ? 'Dreaming…' : 'Generate'}
              </button>
            </form>
            <div className="code-editor-wrap">
              <D2Editor value={code} onChange={handleCodeChange} />
            </div>
            <div className="code-panel-footer">
              <div className="code-footer-copy">
                <span className="code-key">⌘</span>
                <span>Changes compile after a short pause</span>
              </div>
              <label className="engine-picker">
                <span className="engine-picker-label">Layout</span>
                <select
                  aria-label="Layout engine"
                  value={engine}
                  onChange={(event) =>
                    selectEngine(event.target.value as 'dagre' | 'elk' | 'tala')
                  }
                >
                  <option value="dagre">Dagre</option>
                  <option value="elk">ELK (Pro)</option>
                  <option value="tala">Tala (Pro)</option>
                </select>
              </label>
              <button
                className="compile-button"
                type="button"
                onClick={compileCode}
                disabled={compileState === 'compiling'}
              >
                <span className="compile-button__dot" />
                Compile
              </button>
            </div>
          </aside>
        )}
      </main>
      {showRoomSettings && roomMeta && roomId ? (
        <RoomSettingsDialog
          room={roomMeta}
          ticket={resolveRoomTicket()}
          userToken={resolveUserToken()}
          onUpdated={(meta) => {
            setRoomMeta(meta);
            setBoardTitle(meta.name);
          }}
          onClose={() => setShowRoomSettings(false)}
        />
      ) : null}
      {showWorkspaces ? (
        <WorkspacePanel
          userToken={resolveUserToken()}
          userId={session?.user.id ?? null}
          currentRoomId={roomId}
          onOpenRoom={(nextRoomId) => {
            setShowWorkspaces(false);
            if (nextRoomId !== roomId) {
              router.push(`/board?room=${encodeURIComponent(nextRoomId)}`);
            }
          }}
          onClose={() => setShowWorkspaces(false)}
        />
      ) : null}
      {showCreateRoom ? (
        <CreateRoomDialog
          userToken={resolveUserToken()}
          onCreated={(meta) => {
            setShowCreateRoom(false);
            router.push(`/board?room=${encodeURIComponent(meta.id)}`);
          }}
          onClose={() => setShowCreateRoom(false)}
          recentRooms={showCreateRoom ? getRecentRooms() : []}
          currentRoomId={roomId}
          onOpenRoom={(nextRoomId) => {
            setShowCreateRoom(false);
            if (nextRoomId !== roomId) {
              router.push(`/board?room=${encodeURIComponent(nextRoomId)}`);
            }
          }}
        />
      ) : null}
    </div>
  );
}

export default WhiteboardPage;
