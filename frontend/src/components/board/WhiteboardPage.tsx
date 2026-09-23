'use client';

import { D2Editor } from '@/components/editor';
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
  aabbFromRect,
  aabbIntersects,
  cameraViewBox,
  INITIAL_CAMERA,
  panCamera,
  resizeAabb,
  resizeHandles,
  screenToWorld,
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
import {
  createBoardSync,
  resolveSyncHttpUrl,
  resolveSyncServerUrl,
  type SyncBoardState,
  type SyncStatus,
} from '@/lib/whiteboard/sync';
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

type BoardNode = {
  id: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 'violet' | 'orange' | 'blue' | 'yellow' | 'mint' | 'note';
  shape?: 'round' | 'cylinder' | 'note' | 'ellipse' | 'text' | 'image';
  href?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
  fontSize?: number;
};

type BoardArrow = {
  id: string;
  start: Point;
  end: Point;
  color: string;
  startNodeId?: string;
  endNodeId?: string;
};

type BoardStroke = {
  id: string;
  points: Point[];
  color: string;
};

type BoardSnapshot = {
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
};

type Interaction =
  | { kind: 'pan'; pointerId: number; lastScreen: Point }
  | {
      kind: 'drag';
      pointerId: number;
      startWorld: Point;
      originNodes: Array<{ id: string; x: number; y: number }>;
      originArrows: Array<{ id: string; start: Point; end: Point }>;
      originStrokes: Array<{ id: string; points: Point[] }>;
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
      points: Point[];
      color: string;
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

const ROOM_ID = 'incident-room';
const BOARD_STORAGE_KEY = `eunoia:board:${ROOM_ID}:v1`;

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
  return { minX: minX - 6, minY: minY - 6, maxX: maxX + 6, maxY: maxY + 6 };
}

function arrowBounds(arrow: BoardArrow): Aabb {
  return {
    minX: Math.min(arrow.start.x, arrow.end.x) - 8,
    minY: Math.min(arrow.start.y, arrow.end.y) - 8,
    maxX: Math.max(arrow.start.x, arrow.end.x) + 8,
    maxY: Math.max(arrow.start.y, arrow.end.y) + 8,
  };
}

function nodeBounds(node: BoardNode): Aabb {
  return aabbFromRect(node.x, node.y, node.width, node.height);
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
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = targetPoint.x - cx;
  const dy = targetPoint.y - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: cx, y: cy };
  }

  if (node.shape === 'ellipse') {
    const rx = node.width / 2;
    const ry = node.height / 2;
    const angle = Math.atan2(dy, dx);
    return {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  }

  const hw = node.width / 2;
  const hh = node.height / 2;
  const tanX = Math.abs(hw / dx);
  const tanY = Math.abs(hh / dy);
  const t = Math.min(tanX, tanY);

  return {
    x: cx + dx * t,
    y: cy + dy * t,
  };
}

function findSnapNode(
  point: Point,
  nodes: BoardNode[],
  padding = 20,
): BoardNode | null {
  for (const node of nodes) {
    if (
      point.x >= node.x - padding &&
      point.x <= node.x + node.width + padding &&
      point.y >= node.y - padding &&
      point.y <= node.y + node.height + padding
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

const NODE_TONES = new Set(['violet', 'orange', 'blue', 'yellow', 'mint', 'note']);
const NODE_SHAPES = new Set(['round', 'cylinder', 'note', 'ellipse', 'text', 'image']);

function sanitizeNode(raw: unknown): BoardNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Partial<BoardNode>;
  if (typeof n.id !== 'string' || n.id.length === 0 || n.id.length > 120) return null;
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
    tone: (typeof n.tone === 'string' && NODE_TONES.has(n.tone) ? n.tone : 'mint') as BoardNode['tone'],
    shape: (typeof n.shape === 'string' && NODE_SHAPES.has(n.shape) ? n.shape : undefined) as BoardNode['shape'],
    href: typeof n.href === 'string' && n.href.startsWith('data:image/') ? n.href.slice(0, 8_000_000) : undefined,
    stroke: typeof n.stroke === 'string' ? n.stroke.slice(0, 32) : undefined,
    fill: typeof n.fill === 'string' ? n.fill.slice(0, 32) : undefined,
    strokeWidth: n.strokeWidth === undefined ? undefined : clampSize(finiteOr(n.strokeWidth, 2), 0.5, 24),
    dashed: n.dashed === true,
    opacity: n.opacity === undefined ? undefined : clampSize(finiteOr(n.opacity, 1), 0.05, 1),
    fontSize: n.fontSize === undefined ? undefined : clampSize(Math.round(finiteOr(n.fontSize, 16)), 8, 400),
  };
}

function sanitizePoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Point>;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: clampSize(p.x as number, -100000, 100000),
    y: clampSize(p.y as number, -100000, 100000),
  };
}

function sanitizeArrow(raw: unknown): BoardArrow | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<BoardArrow>;
  if (typeof a.id !== 'string' || a.id.length === 0 || a.id.length > 120) return null;
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
  };
}

function sanitizeStroke(raw: unknown): BoardStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<BoardStroke>;
  if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 120) return null;
  if (!Array.isArray(s.points)) return null;
  const points = s.points.slice(0, 2000).flatMap((p) => {
    const clean = sanitizePoint(p);
    return clean ? [clean] : [];
  });
  if (points.length === 0) return null;
  return {
    id: s.id,
    points,
    color: typeof s.color === 'string' ? s.color.slice(0, 32) : '#25263a',
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
      const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
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
        resolve({ href: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
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
  tone,
}: {
  initials: string;
  tone: string;
}) {
  // Decorative placeholder until real presence is wired via sync awareness.
  return (
    <span
      className={`presence-avatar presence-avatar--${tone}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
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
}: {
  node: BoardNode;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void;
  onDoubleClick: () => void;
  onKeySelect: (event: ReactKeyboardEvent<SVGGElement>, node: BoardNode) => void;
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

  return (
    <g
      className={`canvas-node canvas-node--${node.tone} ${isNote ? 'is-note' : ''} ${selected ? 'is-selected' : ''}`}
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
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            preserveAspectRatio="none"
            style={{ opacity: node.opacity ?? 1 }}
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
          y={node.y + (isText ? Math.round(node.height * 0.72) : isNote ? 42 : 43)}
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

export function WhiteboardPage() {
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
  const [persistenceState, setPersistenceState] = useState<
    'loading' | 'saving' | 'saved' | 'error'
  >('loading');
  const [hasHydrated, setHasHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const [syncReady, setSyncReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeColor, setActiveColor] = useState('#25263a');
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
  const historyRef = useRef<BoardSnapshot[]>([]);
  const futureRef = useRef<BoardSnapshot[]>([]);
  const historyRecordedRef = useRef(false);
  const syncRef = useRef<ReturnType<typeof createBoardSync> | null>(null);
  const compileAbortRef = useRef<AbortController | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const cameraRef = useRef<Camera>(camera);
  const nodesRef = useRef<BoardNode[]>(nodes);
  const arrowsRef = useRef<BoardArrow[]>(arrows);
  const strokesRef = useRef<BoardStroke[]>(strokes);
  const [svgPixelSize, setSvgPixelSize] = useState<{ width: number; height: number } | null>(null);
  const boardStateRef = useRef<SyncBoardState>({
    nodes,
    arrows,
    strokes,
    code,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate and persist an external browser store. */
  useEffect(() => {
    boardStateRef.current = { nodes, arrows, strokes, code };
  }, [arrows, code, nodes, strokes]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

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

  const snapshot = useCallback(
    (): BoardSnapshot => ({
      nodes,
      arrows,
      strokes,
    }),
    [arrows, nodes, strokes],
  );

  const recordHistory = useCallback(() => {
    historyRef.current = [...historyRef.current, snapshot()].slice(-40);
    futureRef.current = [];
  }, [snapshot]);

  const ensureHistory = useCallback(() => {
    if (historyRecordedRef.current) return;
    recordHistory();
    historyRecordedRef.current = true;
  }, [recordHistory]);

  const undo = useCallback(() => {
    const stack = historyRef.current;
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    historyRef.current = stack.slice(0, -1);
    futureRef.current = [...futureRef.current, snapshot()];
    setNodes(previous.nodes);
    setArrows(previous.arrows);
    setStrokes(previous.strokes);
    setSelectedIds([]);
  }, [snapshot]);

  const redo = useCallback(() => {
    const stack = futureRef.current;
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    futureRef.current = stack.slice(0, -1);
    historyRef.current = [...historyRef.current, snapshot()].slice(-40);
    setNodes(next.nodes);
    setArrows(next.arrows);
    setStrokes(next.strokes);
    setSelectedIds([]);
  }, [snapshot]);

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
    try {
      const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const clean = sanitizeBoardState(parsed);
        if (clean) {
          setNodes(clean.nodes.length > 0 ? clean.nodes : INITIAL_NODES);
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
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    setPersistenceState('saving');
    const timeoutId = window.setTimeout(() => {
      const fullPayload: PersistedBoard = { nodes, arrows, strokes, code };
      try {
        window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(fullPayload));
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
            window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(slimPayload));
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
  }, [arrows, code, hasHydrated, nodes, strokes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hasHydrated) return;
    const session = createBoardSync({
      roomId: ROOM_ID,
      serverUrl: resolveSyncServerUrl(),
      initialState: boardStateRef.current,
      getInitialState: () => boardStateRef.current,
      onReady: () => setSyncReady(true),
      onStatus: (status) => {
        setSyncStatus(status);
        if (status === 'offline') setSyncReady(false);
      },
      onError: (message) => setBoardError(message),
      onState: (state) => {
        const clean = sanitizeBoardState(state);
        if (!clean) {
          setBoardError(
            'The room sent an invalid board state. Local changes were kept.',
          );
          return;
        }
        setNodes(clean.nodes);
        setArrows(clean.arrows);
        setStrokes(clean.strokes);
        setCode(clean.code);
        setPersistenceState('saved');
      },
    });
    syncRef.current = session;
    return () => {
      setSyncReady(false);
      session.destroy();
      syncRef.current = null;
    };
  }, [hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || !syncReady) return;
    const timeoutId = window.setTimeout(() => {
      syncRef.current?.publish(boardStateRef.current);
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [arrows, code, hasHydrated, nodes, strokes, syncReady]);

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

  const viewBox = useMemo(
    () => cameraViewBox(camera, canvasViewport),
    [camera, canvasViewport],
  );

  const visibleNodes = useMemo(
    () => spatialIndex.search(viewBox),
    [spatialIndex, viewBox],
  );

  const visibleStrokes = useMemo(
    () => strokes.filter((stroke) => aabbIntersects(viewBox, strokeBounds(stroke))),
    [strokes, viewBox],
  );

  const visibleArrows = useMemo(
    () => arrows.filter((arrow) => aabbIntersects(viewBox, arrowBounds(arrow))),
    [arrows, viewBox],
  );

  // Per-color markers: `fill="context-stroke"` has spotty browser support,
  // so dynamic arrows get an explicit marker in their own color.
  const arrowMarkerIds = useMemo(() => {
    const ids = new Map<string, string>();
    for (const arrow of arrows) {
      if (!ids.has(arrow.color)) {
        ids.set(arrow.color, `ah-${arrow.color.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'ink'}`);
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
      recordHistory();
      setNodes((current) => current.filter((item) => item.id !== editingNode.id));
      setSelectedIds([]);
    } else if (trimmed && trimmed !== targetNode?.label) {
      recordHistory();
      setNodes((current) =>
        current.map((item) =>
          item.id === editingNode.id ? { ...item, label: trimmed } : item,
        ),
      );
    }
    setEditingNode(null);
  }, [editingNode, nodes, recordHistory]);

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
      recordHistory();
      setNodes((current) =>
        current.map((node) =>
          selectedIds.includes(node.id)
            ? { ...node, tone, stroke: color }
            : node,
        ),
      );
      setArrows((current) =>
        current.map((arrow) =>
          selectedIds.includes(arrow.id) ? { ...arrow, color } : arrow,
        ),
      );
      setStrokes((current) =>
        current.map((stroke) =>
          selectedIds.includes(stroke.id) ? { ...stroke, color } : stroke,
        ),
      );
    },
    [locked, recordHistory, selectedIds],
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
    recordHistory();
    setNodes((current) => current.filter((n) => !selectedIds.includes(n.id)));
    setArrows((current) => current.filter((a) => !selectedIds.includes(a.id)));
    setStrokes((current) => current.filter((s) => !selectedIds.includes(s.id)));
    setSelectedIds([]);
  }, [copySelected, locked, recordHistory, selectedIds]);

  const pasteClipboard = useCallback(() => {
    if (locked || !clipboardRef.current) return;
    const {
      nodes: cNodes,
      arrows: cArrows,
      strokes: cStrokes,
    } = clipboardRef.current;
    if (cNodes.length === 0 && cArrows.length === 0 && cStrokes.length === 0)
      return;

    recordHistory();
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
      points: s.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
    }));

    setNodes((current) => [...current, ...newNodes]);
    setArrows((current) => [...current, ...newArrows]);
    setStrokes((current) => [...current, ...newStrokes]);

    const newSelectedIds = [
      ...newNodes.map((n) => n.id),
      ...newArrows.map((a) => a.id),
      ...newStrokes.map((s) => s.id),
    ];
    setSelectedIds(newSelectedIds);
  }, [locked, recordHistory]);

  const duplicateSelected = useCallback(() => {
    copySelected();
    pasteClipboard();
  }, [copySelected, pasteClipboard]);

  const updateSelectedNodes = useCallback(
    (updates: Partial<BoardNode>) => {
      if (locked || selectedIds.length === 0) return;
      recordHistory();
      setNodes((current) =>
        current.map((node) =>
          selectedIds.includes(node.id) ? { ...node, ...updates } : node,
        ),
      );
    },
    [locked, recordHistory, selectedIds],
  );

  const moveSelectedLayer = useCallback(
    (direction: 'forward' | 'backward' | 'front' | 'back') => {
      if (locked || selectedIds.length === 0) return;
      recordHistory();
      setNodes((current) => reorderBySelection(current, selectedIds, direction));
      setArrows((current) => reorderBySelection(current, selectedIds, direction));
      setStrokes((current) => reorderBySelection(current, selectedIds, direction));
    },
    [locked, recordHistory, selectedIds],
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
      historyRecordedRef.current = false;
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

  const handleArrowEndpointPointerDown = useCallback(
    (
      event: ReactPointerEvent<SVGCircleElement>,
      arrowId: string,
      endpoint: 'start' | 'end',
    ) => {
      if (locked || !canvasRef.current || isAuxClick(event)) return;
      event.stopPropagation();
      event.preventDefault();
      historyRecordedRef.current = false;
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
      const worldPoint = screenToWorld(screenPoint, cameraRef.current, canvasViewport);

      if (activeTool === 'hand') {
        historyRecordedRef.current = false;
        interactionRef.current = {
          kind: 'pan',
          pointerId: event.pointerId,
          lastScreen: screenPoint,
        };
        canvasRef.current.setPointerCapture(event.pointerId);
        return;
      }

      if (locked) return;

      historyRecordedRef.current = false;
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
        ensureHistory();
        interactionRef.current = {
          kind: 'draw',
          pointerId: event.pointerId,
          points: [worldPoint],
          color: activeColor,
        };
      } else {
        ensureHistory();
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
      ensureHistory,
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
      historyRecordedRef.current = false;

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
        const startWorld = screenToWorld(screenPoint, cameraRef.current, canvasViewport);
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

      const worldPoint = screenToWorld(screenPoint, cameraRef.current, canvasViewport);
      if (activeTool === 'draw') {
        ensureHistory();
        interactionRef.current = {
          kind: 'draw',
          pointerId: event.pointerId,
          points: [worldPoint],
          color: activeColor,
        };
      } else {
        ensureHistory();
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
    [activeColor, activeTool, canvasViewport, ensureHistory, locked],
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
      const worldPoint = screenToWorld(screenPoint, currentCamera, canvasViewport);

      if (interaction.kind === 'arrowEndpoint') {
        ensureHistory();
        const currentArrow = arrowsRef.current.find((a) => a.id === interaction.arrowId);
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
          newPoint = getAnchorPoint(targetNode, otherPoint);
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
        ensureHistory();
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
                newStart = getAnchorPoint(sNode, nodeCenter(eNode));
                newEnd = getAnchorPoint(eNode, nodeCenter(sNode));
              } else if (sNode) {
                newStart = getAnchorPoint(sNode, arrow.end);
              } else if (eNode) {
                newEnd = getAnchorPoint(eNode, arrow.start);
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
              points: origin.points.map((p) => ({
                x: p.x + delta.x,
                y: p.y + delta.y,
              })),
            };
          }),
        );
        return;
      }

      if (interaction.kind === 'resize') {
        ensureHistory();
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
              newStart = getAnchorPoint(
                resizedNode,
                endNode ? nodeCenter(endNode) : arrow.end,
              );
            }
            if (arrow.endNodeId === targetId) {
              const startNode = currentNodes.find(
                (n) => n.id === (arrow.startNodeId ?? ''),
              );
              newEnd = getAnchorPoint(
                resizedNode,
                startNode ? nodeCenter(startNode) : arrow.start,
              );
            }
            return { ...arrow, start: newStart, end: newEnd };
          }),
        );
        return;
      }

      if (interaction.kind === 'draw') {
        const lastPoint = interaction.points[interaction.points.length - 1];
        const dx = worldPoint.x - lastPoint.x;
        const dy = worldPoint.y - lastPoint.y;
        if (dx * dx + dy * dy < 4) return; // Skip if < 2px distance
        const nextPoints = [...interaction.points, worldPoint];
        interactionRef.current = {
          ...interaction,
          points: nextPoints,
        };
        setStrokes((current) => {
          const last = current[current.length - 1];
          if (!last || last.id !== `draft-${interaction.pointerId}`) {
            return [
              ...current,
              {
                id: `draft-${interaction.pointerId}`,
                points: nextPoints,
                color: interaction.color,
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
    [canvasViewport, ensureHistory],
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
      const worldPoint = screenToWorld(screenPoint, currentCamera, canvasViewport);

      if (interaction.kind === 'draw') {
        const points = [...interaction.points, worldPoint];
        setStrokes((current) =>
          current.map((stroke) =>
            stroke.id === `draft-${interaction.pointerId}`
              ? { ...stroke, id: nextId('stroke'), points }
              : stroke,
          ),
        );
        interactionRef.current = null;
        setActiveTool('select');
        historyRecordedRef.current = false;
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
            finalStart = getAnchorPoint(startNode, nodeCenter(endNode));
            finalEnd = getAnchorPoint(endNode, nodeCenter(startNode));
          } else if (startNode) {
            finalStart = getAnchorPoint(startNode, rawEnd);
          } else if (endNode) {
            finalEnd = getAnchorPoint(endNode, start);
          }

          setArrows((current) => [
            ...current,
            {
              id: nextId('arrow'),
              start: finalStart,
              end: finalEnd,
              color: interaction.color,
              startNodeId: startNode?.id,
              endNodeId: endNode?.id,
            },
          ]);
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
          if (interaction.tool === 'text' || interaction.tool === 'note') {
            setEditingNode({
              id: node.id,
              value: interaction.tool === 'text' ? '' : node.label,
            });
          }
        }
        interactionRef.current = null;
        setActiveTool('select');
        historyRecordedRef.current = false;
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
      setMarquee(null);
      setCreatePreview(null);
      historyRecordedRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [canvasViewport],
  );

  const cancelInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    const stack = historyRef.current;
    const previous = stack[stack.length - 1];
    if (historyRecordedRef.current && previous) {
      setNodes(previous.nodes);
      setArrows(previous.arrows);
      setStrokes(previous.strokes);
      historyRef.current = stack.slice(0, -1);
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
    historyRecordedRef.current = false;
    viewportRectRef.current = null;
    setMarquee(null);
  }, []);

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
      const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
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

  /* ── Export helpers ── */
  const exportAsJSON = useCallback(() => {
    const data = { nodes, arrows, strokes, camera };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${boardFileSlug(boardTitle)}-board.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setExportMenuOpen(false);
  }, [arrows, boardTitle, camera, nodes, strokes]);

  const exportAsSVG = useCallback(() => {
    const svg = canvasRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Remove interactive elements from export
    clone.querySelectorAll('[data-interactive]').forEach((el) => el.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${boardFileSlug(boardTitle)}-board.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
    setExportMenuOpen(false);
  }, [boardTitle]);

  const exportAsPNG = useCallback(() => {
    const svg = canvasRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-interactive]').forEach((el) => el.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const canvas = document.createElement('canvas');
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = 2; // 2x for retina
    const maxPixels = 4096;
    const clampedScale = Math.min(
      scale,
      maxPixels / rect.width,
      maxPixels / rect.height,
    );
    canvas.width = Math.max(1, Math.round(rect.width * clampedScale));
    canvas.height = Math.max(1, Math.round(rect.height * clampedScale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(clampedScale, clampedScale);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${boardFileSlug(boardTitle)}-board.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      }, 'image/png');
    };
    img.onerror = () =>
      setBoardError('The board could not be exported as PNG. Try SVG instead.');
    img.src =
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    setExportMenuOpen(false);
  }, [boardTitle]);

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
        recordHistory();
        setNodes((current) =>
          current.filter((node) => !selectedIds.includes(node.id)),
        );
        setArrows((current) =>
          current.filter((arrow) => !selectedIds.includes(arrow.id)),
        );
        setStrokes((current) =>
          current.filter((stroke) => !selectedIds.includes(stroke.id)),
        );
        setSelectedIds([]);
      }
      // Tool & Layer shortcuts (only when no modifier keys or with shift).
      // Skip while focus sits on a button/link so Space/Enter keep working.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const focusOnControl =
        target !== null &&
        (target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.getAttribute('role') === 'button');
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !focusOnControl) {
        switch (event.key.toLowerCase()) {
          case 'v': selectTool('select'); break;
          case 'h': selectTool('hand'); break;
          case 'r': selectTool('rectangle'); break;
          case 'e': selectTool('ellipse'); break;
          case 'a': selectTool('arrow'); break;
          case 'd': selectTool('draw'); break;
          case 't': selectTool('text'); break;
          case 'n': selectTool('note'); break;
          case ']':
            moveSelectedLayer(event.shiftKey ? 'front' : 'forward');
            break;
          case '[':
            moveSelectedLayer(event.shiftKey ? 'back' : 'backward');
            break;
          case '=': case '+': adjustZoom(8); break;
          case '-': adjustZoom(-8); break;
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
    copySelected,
    cutSelected,
    duplicateSelected,
    editingNode,
    exportMenuOpen,
    locked,
    moveSelectedLayer,
    pasteClipboard,
    recordHistory,
    redo,
    resetCamera,
    selectAllIds,
    selectTool,
    selectedIds,
    undo,
  ]);

  const handleShare = useCallback(() => {
    const share = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
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
  }, []);

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
      if (!file.type.startsWith('image/')) {
        setBoardError('Choose a PNG, JPEG, WebP, GIF, or another image file.');
        return;
      }
      if (file.size > 5_000_000) {
        setBoardError('Images must be 5 MB or smaller.');
        return;
      }
      try {
        const rawHref = await readFileAsDataUrl(file);
        // Downscale large photos before storing: full-resolution data URLs
        // would blow up localStorage and the Yjs sync payload.
        const { href, width, height } = await downscaleImageToDataUrl(rawHref, 1024);
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
          href,
        };
        recordHistory();
        setNodes((current) => [...current, node]);
        setSelectedIds([node.id]);
        setActiveTool('select');
        setBoardError(null);
      } catch (error) {
        setBoardError(
          error instanceof Error
            ? error.message
            : 'The image could not be imported.',
        );
      }
    },
    [camera.x, camera.y, locked, recordHistory],
  );

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
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
    compileAbortRef.current?.abort();
    const controller = new AbortController();
    compileAbortRef.current = controller;
    setCompileState('compiling');
    try {
      const response = await fetch(`${serverUrl}/api/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: code,
          engine: 'dagre',
          roomId: ROOM_ID,
        }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : `D2 compilation failed (${response.status}).`;
        throw new Error(message);
      }
      setCompileState('compiled');
      setBoardError(null);
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
  }, [code]);

  useEffect(
    () => () => {
      compileAbortRef.current?.abort();
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const activeEditingNode = editingNode ? nodes.find((n) => n.id === editingNode.id) : null;
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

  // Close the export menu on outside click / Escape.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        exportMenuRef.current &&
        event.target instanceof Node &&
        !exportMenuRef.current.contains(event.target)
      ) {
        setExportMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportMenuOpen]);

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
          <a className="board-brand" href="#canvas" aria-label="Eunoia home">
            <span className="board-brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>Eunoia</span>
          </a>
          <span className="header-divider" aria-hidden="true" />
          <button
            className="board-title-control"
            type="button"
            onClick={() => {
              const newTitle = window.prompt('Rename diagram', boardTitle);
              const trimmed = newTitle?.trim().slice(0, 60);
              if (trimmed) setBoardTitle(trimmed);
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
          <span className="header-location">workspace / incident-room</span>
        </div>

        <div className="board-header-actions">
          <div
            className="presence-stack"
            role="status"
            aria-label={
              syncStatus === 'connected'
                ? 'Live room: connected'
                : syncStatus === 'offline'
                  ? 'Local room: changes stay in this browser'
                  : 'Room: connecting'
            }
            title={
              syncStatus === 'connected'
                ? 'Live room: connected'
                : syncStatus === 'offline'
                  ? 'Local room'
                  : 'Connecting…'
            }
          >
            <PresenceAvatar initials="AK" tone="violet" />
            <PresenceAvatar initials="JO" tone="orange" />
            <PresenceAvatar initials="MN" tone="blue" />
            <span className="presence-more" aria-hidden="true">
              {syncStatus === 'connected' ? '●' : '+2'}
            </span>
          </div>
          <button
            className="header-icon-button"
            type="button"
            aria-label="Search board"
            title="Search board"
          >
            <Search size={17} />
          </button>
          <button className="share-button" type="button" onClick={handleShare}>
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            {copied ? 'Link copied' : 'Share room'}
          </button>
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
                  onClick={exportAsPNG}
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
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Export as PNG
                </button>
                <button
                  type="button"
                  onClick={exportAsSVG}
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
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#f5f4fa')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <Download size={15} /> Export as SVG
                </button>
                <button
                  type="button"
                  onClick={exportAsJSON}
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
                      onClick={() => updateSelectedNodes({ strokeWidth: 1.5 })}
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
              <span className="stage-breadcrumb__root">Request flow</span>
              <ArrowRight size={13} />
              <span>Architecture map</span>
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
            {boardError && (
              <div className="board-error" role="alert">
                <span>{boardError}</span>
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
                  Production request flow
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
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerCancel}
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
                          d={smoothPath(stroke.points)}
                          fill="none"
                          stroke="transparent"
                          strokeWidth="18"
                          style={{
                            cursor:
                              activeTool === 'select' ? 'pointer' : 'default',
                          }}
                        />
                        <path
                          d={smoothPath(stroke.points)}
                          fill="none"
                          stroke={stroke.color}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {isSelected && (
                          <path
                            d={smoothPath(stroke.points)}
                            fill="none"
                            stroke="#6965db"
                            strokeWidth="6"
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
                    const markerId = arrowMarkerIds.get(arrow.color) ?? 'arrowhead';
                    return (
                      <g
                        key={arrow.id}
                        className={`arrow-group ${isSelected ? 'is-selected' : ''}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          handleElementPointerDown(event, arrow.id);
                        }}
                      >
                        <line
                          x1={arrow.start.x}
                          y1={arrow.start.y}
                          x2={arrow.end.x}
                          y2={arrow.end.y}
                          stroke="transparent"
                          strokeWidth="18"
                          style={{
                            cursor:
                              activeTool === 'select' ? 'pointer' : 'default',
                          }}
                        />
                        <path
                          d={`M ${arrow.start.x} ${arrow.start.y} L ${arrow.end.x} ${arrow.end.y}`}
                          fill="none"
                          stroke={arrow.color}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          markerEnd={`url(#${markerId})`}
                        />
                        {isSelected && (
                          <>
                            <line
                              x1={arrow.start.x}
                              y1={arrow.start.y}
                              x2={arrow.end.x}
                              y2={arrow.end.y}
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
                    onKeySelect={(event, target) => handleNodeKeySelect(event, target)}
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
                      width={selectedNodeBounds.maxX - selectedNodeBounds.minX + 16}
                      height={selectedNodeBounds.maxY - selectedNodeBounds.minY + 16}
                      rx="8"
                    />
                    <line
                      className="rotation-stem"
                      x1={(selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2}
                      y1={selectedNodeBounds.minY - 8}
                      x2={(selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2}
                      y2={selectedNodeBounds.minY - 31}
                    />
                    <circle
                      className="rotation-handle"
                      cx={(selectedNodeBounds.minX + selectedNodeBounds.maxX) / 2}
                      cy={selectedNodeBounds.minY - 37}
                      r="5"
                    />
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
                {createPreview && (() => {
                  const px = Math.min(createPreview.start.x, createPreview.end.x);
                  const py = Math.min(createPreview.start.y, createPreview.end.y);
                  const pw = Math.abs(createPreview.end.x - createPreview.start.x);
                  const ph = Math.abs(createPreview.end.y - createPreview.start.y);
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
                  activeEditingNode.shape === 'text' ? 'Type text...' : 'Edit label...'
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
                  minWidth: Math.max(activeEditingNode.width * camera.zoom, 120),
                  height: Math.max(activeEditingNode.height * camera.zoom, 36),
                  fontSize: Math.max(13 * camera.zoom, 12),
                  fontFamily:
                    activeEditingNode.shape === 'note'
                      ? "'Excalifont', 'Comic Sans MS', cursive"
                      : "'Inter', system-ui, sans-serif",
                  fontWeight: 600,
                  textAlign: activeEditingNode.shape === 'text' ? 'left' : 'center',
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
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo"
                onClick={redo}
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
            <div className="code-editor-wrap">
              <D2Editor value={code} onChange={handleCodeChange} />
            </div>
            <div className="code-panel-footer">
              <div className="code-footer-copy">
                <span className="code-key">⌘</span>
                <span>Changes compile after a short pause</span>
              </div>
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
    </div>
  );
}

export default WhiteboardPage;
