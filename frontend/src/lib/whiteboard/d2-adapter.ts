import type { Point } from './geometry';
import type { BoardArrow, BoardNode } from './board-types';

/**
 * Adapter + reconciler for D2 compiler output.
 *
 * The external Go compiler returns loose records
 * (`{ nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }`),
 * so every field is validated here before it can reach canvas state.
 * Managed elements carry stable `d2:` IDs; freehand/user shapes are never
 * touched by reconciliation.
 */

export const D2_NODE_ID_PREFIX = 'd2:';
export const D2_EDGE_ID_PREFIX = 'd2:edge:';

const MAX_NODES = 1000;
const MAX_EDGES = 2000;

export type D2AdaptedNode = Omit<BoardNode, 'id'> & { key: string };

export type D2AdaptedEdge = {
  key: string;
  fromKey: string;
  toKey: string;
  label: string;
  color: string;
};

export type D2ParsedDiagram = {
  nodes: D2AdaptedNode[];
  edges: D2AdaptedEdge[];
  placeholder: boolean;
  engine?: string;
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeKey(value: unknown): string | null {
  // Capped so `d2:<key>` node ids survive the 120-char board sanitizer
  // after reload (prefix + margin).
  const raw = asString(value).trim().slice(0, 100);
  if (!raw) return null;
  const clean = raw.replace(/[^a-zA-Z0-9 _\-/.]/g, '-');
  return clean || null;
}

export function d2NodeId(key: string): string {
  return `${D2_NODE_ID_PREFIX}${key}`;
}

export function isD2NodeId(id: string): boolean {
  return id.startsWith(D2_NODE_ID_PREFIX);
}

export function isD2EdgeId(id: string): boolean {
  return id.startsWith(D2_EDGE_ID_PREFIX);
}

function toneForD2Fill(fill: string | undefined): BoardNode['tone'] {
  switch ((fill ?? '').toLowerCase()) {
    case '#ede8ff':
    case '#ede9ff':
    case '#dbd7fa':
      return 'violet';
    case '#ffe0c8':
    case '#ffe0ca':
    case '#ffc8be':
      return 'orange';
    case '#d9ebf8':
    case '#dceefa':
    case '#badff3':
      return 'blue';
    case '#fff0b8':
    case '#fff0b9':
    case '#ffe895':
      return 'yellow';
    default:
      return 'mint';
  }
}

function shapeForD2Shape(shape: string | undefined): BoardNode['shape'] {
  switch ((shape ?? '').toLowerCase()) {
    case 'ellipse':
    case 'circle':
    case 'oval':
      return 'ellipse';
    case 'cylinder':
    case 'database':
    case 'stored_data':
      return 'cylinder';
    case 'note':
      return 'note';
    case 'text':
    case 'null':
      return 'text';
    default:
      return 'round';
  }
}

function readStyle(record: Record<string, unknown>): {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
} {
  const style =
    record.style && typeof record.style === 'object'
      ? (record.style as Record<string, unknown>)
      : null;
  const fillRaw = asString(record.fill ?? style?.fill ?? style?.['fill-color']);
  const strokeRaw = asString(record.stroke ?? style?.stroke);
  const strokeWidthRaw = asFinite(
    record.strokeWidth ?? style?.['stroke-width'],
  );
  return {
    fill: fillRaw ? fillRaw.slice(0, 32) : undefined,
    stroke: strokeRaw ? strokeRaw.slice(0, 32) : undefined,
    strokeWidth:
      strokeWidthRaw === null ? undefined : clamp(strokeWidthRaw, 0.5, 24),
  };
}

function adaptNode(
  record: Record<string, unknown>,
  fallbackIndex: number,
): D2AdaptedNode | null {
  const key = sanitizeKey(record.key ?? record.id ?? record.label);
  if (!key) return null;
  const label = asString(record.label, key).slice(0, 500);
  const detail = asString(
    record.detail ?? record.description ?? record.subtitle,
  ).slice(0, 500);
  const { fill, stroke, strokeWidth } = readStyle(record);
  // Fall back to a staggered grid slot when the compiler omits coordinates
  // so nodes never stack invisibly at the origin.
  const fallbackX = 120 + (fallbackIndex % 5) * 240;
  const fallbackY = 160 + Math.floor(fallbackIndex / 5) * 160;
  const x = clamp(asFinite(record.x) ?? fallbackX, -100000, 100000);
  const y = clamp(asFinite(record.y) ?? fallbackY, -100000, 100000);
  const width = clamp(asFinite(record.width) ?? 190, 24, 4000);
  const height = clamp(asFinite(record.height) ?? 90, 16, 4000);
  return {
    key,
    label,
    detail,
    x,
    y,
    width,
    height,
    tone: toneForD2Fill(fill),
    shape: shapeForD2Shape(asString(record.shape)),
    fill,
    stroke,
    strokeWidth,
  };
}

function adaptEdge(
  record: Record<string, unknown>,
  seenIds: Set<string>,
): D2AdaptedEdge | null {
  const fromKey = sanitizeKey(
    record.source ?? record.from ?? record.sourceKey ?? record.src,
  );
  const toKey = sanitizeKey(
    record.target ?? record.to ?? record.targetKey ?? record.dst,
  );
  if (!fromKey || !toKey) return null;
  let key = `${fromKey}->${toKey}`;
  let suffix = 2;
  while (seenIds.has(key)) {
    key = `${fromKey}->${toKey}#${suffix}`;
    suffix += 1;
  }
  seenIds.add(key);
  return {
    key,
    fromKey,
    toKey,
    label: asString(record.label).slice(0, 200),
    color: asString(record.color || record.stroke, '#6b7192').slice(0, 32),
  };
}

/**
 * Validate an unknown `/api/compile` payload. Returns `null` when the
 * payload is unusable — callers must keep the current board in that case.
 */
export function parseCompileResponse(payload: unknown): D2ParsedDiagram | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) return null;
  const placeholder = body.placeholder === true;
  const engine = typeof body.engine === 'string' ? body.engine : undefined;

  const nodes: D2AdaptedNode[] = [];
  for (const raw of body.nodes.slice(0, MAX_NODES)) {
    if (!raw || typeof raw !== 'object') continue;
    const adapted = adaptNode(raw as Record<string, unknown>, nodes.length);
    if (adapted) nodes.push(adapted);
  }

  const seenEdges = new Set<string>();
  const edges: D2AdaptedEdge[] = [];
  for (const raw of body.edges.slice(0, MAX_EDGES)) {
    if (!raw || typeof raw !== 'object') continue;
    const adapted = adaptEdge(raw as Record<string, unknown>, seenEdges);
    if (adapted) edges.push(adapted);
  }

  return { nodes, edges, placeholder, engine };
}

export type D2AnchorResolver = (node: BoardNode, targetPoint: Point) => Point;

export type D2CenterResolver = (node: BoardNode) => Point;

/**
 * Merge compiler output into board state. D2-managed elements (stable
 * `d2:` IDs) are updated in place to avoid flicker and preserve array
 * order; everything else passes through untouched.
 */
export function reconcileDiagram(
  prevNodes: BoardNode[],
  prevArrows: BoardArrow[],
  diagram: D2ParsedDiagram,
  anchorOf: D2AnchorResolver,
  centerOf: D2CenterResolver,
): { nodes: BoardNode[]; arrows: BoardArrow[] } {
  const adaptedByKey = new Map(diagram.nodes.map((node) => [node.key, node]));
  const nextNodes: BoardNode[] = [];
  const nodeById = new Map<string, BoardNode>();

  for (const node of prevNodes) {
    if (!isD2NodeId(node.id)) {
      nextNodes.push(node);
      nodeById.set(node.id, node);
      continue;
    }
    const adapted = adaptedByKey.get(node.id.slice(D2_NODE_ID_PREFIX.length));
    if (!adapted) continue; // Removed from D2 source — delete.
    const merged: BoardNode = {
      ...node,
      label: adapted.label,
      detail: adapted.detail,
      x: adapted.x,
      y: adapted.y,
      width: adapted.width,
      height: adapted.height,
      tone: adapted.tone,
      shape: adapted.shape,
      // Compiler output wins when present, but a recompile that omits a
      // field must not wipe a manual customization.
      fill: adapted.fill ?? node.fill,
      stroke: adapted.stroke ?? node.stroke,
      strokeWidth: adapted.strokeWidth ?? node.strokeWidth,
    };
    nextNodes.push(merged);
    nodeById.set(merged.id, merged);
  }

  for (const adapted of diagram.nodes) {
    const id = d2NodeId(adapted.key);
    if (nodeById.has(id)) continue;
    const created: BoardNode = {
      id,
      label: adapted.label,
      detail: adapted.detail,
      x: adapted.x,
      y: adapted.y,
      width: adapted.width,
      height: adapted.height,
      tone: adapted.tone,
      shape: adapted.shape,
      fill: adapted.fill,
      stroke: adapted.stroke,
      strokeWidth: adapted.strokeWidth,
    };
    nextNodes.push(created);
    nodeById.set(id, created);
  }

  const nodeIdByKey = new Map<string, string>();
  for (const node of nextNodes) {
    if (isD2NodeId(node.id)) {
      nodeIdByKey.set(node.id.slice(D2_NODE_ID_PREFIX.length), node.id);
    }
  }

  const adaptedEdgeById = new Map(
    diagram.edges.map((edge) => [`${D2_EDGE_ID_PREFIX}${edge.key}`, edge]),
  );
  const nextArrows: BoardArrow[] = [];

  for (const arrow of prevArrows) {
    if (!isD2EdgeId(arrow.id)) {
      nextArrows.push(arrow);
      continue;
    }
    const adapted = adaptedEdgeById.get(arrow.id);
    if (!adapted) continue; // Removed from D2 source — delete.
    const rebound = bindEdge(
      adapted,
      nodeById,
      nodeIdByKey,
      anchorOf,
      centerOf,
    );
    // A dangling edge (endpoint deleted) is dropped like a deleted node —
    // keeping stale geometry would leave an unselectable ghost.
    if (!rebound) continue;
    nextArrows.push({ ...arrow, ...rebound });
  }

  for (const adapted of diagram.edges) {
    const id = `${D2_EDGE_ID_PREFIX}${adapted.key}`;
    if (nextArrows.some((arrow) => arrow.id === id)) continue;
    const rebound = bindEdge(
      adapted,
      nodeById,
      nodeIdByKey,
      anchorOf,
      centerOf,
    );
    if (!rebound) continue; // Endpoint missing — skip dangling edges.
    nextArrows.push({ id, color: adapted.color, ...rebound });
  }

  return { nodes: nextNodes, arrows: nextArrows };
}

function bindEdge(
  adapted: D2AdaptedEdge,
  nodeById: Map<string, BoardNode>,
  nodeIdByKey: Map<string, string>,
  anchorOf: D2AnchorResolver,
  centerOf: D2CenterResolver,
): {
  start: Point;
  end: Point;
  startNodeId?: string;
  endNodeId?: string;
} | null {
  const startId = nodeIdByKey.get(adapted.fromKey);
  const endId = nodeIdByKey.get(adapted.toKey);
  const startNode = startId ? nodeById.get(startId) : undefined;
  const endNode = endId ? nodeById.get(endId) : undefined;
  if (!startNode || !endNode) return null;
  return {
    start: anchorOf(startNode, centerOf(endNode)),
    end: anchorOf(endNode, centerOf(startNode)),
    startNodeId: startNode.id,
    endNodeId: endNode.id,
  };
}
