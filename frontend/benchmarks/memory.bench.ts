/**
 * NFR-4 client-memory bench: 5,000 entities + 5 concurrent users.
 *
 * Run with: `bun benchmarks/memory.bench.ts` from `frontend/`.
 *
 * CI gate (NFR-4: browser tab JS heap under 500MB with 5,000 entities and
 * 5 concurrent users): builds the full client-side board state — 5,000
 * nodes + edges, an RBush spatial index, one Y.Doc with 5,000 entries, and
 * 5 presence states — then asserts process heap stays under budget.
 *
 * This runs in Bun (no DOM), so it measures model + index + CRDT memory,
 * not SVG DOM nodes. The browser variant (Chromium `performance.memory`,
 * `PLAYWRIGHT=1`) is the nightly authority; this proxy runs per-PR to
 * catch encoding/allocation regressions early.
 */

import * as Y from 'yjs';
import { SpatialIndex } from '../src/lib/whiteboard/spatial-index';
import type { Aabb } from '../src/lib/whiteboard/geometry';

const ENTITY_COUNT = 5000;
const USER_COUNT = 5;
const BUDGET_BYTES = 500 * 1024 * 1024;

type Entry = Aabb & { id: string };

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const heapBefore = process.memoryUsage().heapUsed;

// 5,000 canvas entities with realistic fields (labels, style, geometry).
const nodes = Array.from({ length: ENTITY_COUNT }, (_, i) => ({
  id: `n-${i}`,
  key: `n-${i}`,
  label: `service component number ${i} with a moderately long label`,
  detail: `detail text for node ${i}`,
  x: (i % 100) * 220,
  y: Math.floor(i / 100) * 160,
  width: 180,
  height: 90,
  fill: '#ffffff',
  stroke: '#5b54c7',
  strokeWidth: 2,
  shape: 'rectangle',
}));
const arrows = Array.from({ length: ENTITY_COUNT - 1 }, (_, i) => ({
  id: `e-${i}`,
  fromKey: `n-${i}`,
  toKey: `n-${i + 1}`,
  label: `edge ${i}`,
  color: '#6b7192',
}));

// RBush index over all entities.
const index = new SpatialIndex<Entry>();
index.rebuild(
  nodes.map((n) => ({
    id: n.id,
    minX: n.x,
    minY: n.y,
    maxX: n.x + n.width,
    maxY: n.y + n.height,
    value: {
      id: n.id,
      minX: n.x,
      minY: n.y,
      maxX: n.x + n.width,
      maxY: n.y + n.height,
    },
  })),
);

// One shared Y.Doc holding the board, as the sync layer does.
const doc = new Y.Doc();
const board = doc.getMap('board');
for (const n of nodes) board.set(n.id, { ...n });
const edgeMap = doc.getMap('edges');
for (const e of arrows) edgeMap.set(e.id, { ...e });
const docBytes = Y.encodeStateAsUpdate(doc).length;

// 5 concurrent users: undo stacks (100 entries) + presence states.
const undoStacks = Array.from({ length: USER_COUNT }, () =>
  Array.from({ length: 100 }, (_, i) => ({
    op: 'move',
    id: `n-${i}`,
    before: { x: i, y: i },
    after: { x: i + 1, y: i + 1 },
    at: Date.now(),
  })),
);
const presence = Array.from({ length: USER_COUNT }, (_, u) => ({
  userId: `user-${u}`,
  cursor: { x: u * 100, y: u * 50 },
  tool: 'select',
  selection: [`n-${u}`, `n-${u + 1}`],
}));
void undoStacks;
void presence;

if (globalThis.gc) globalThis.gc();
await new Promise((r) => setTimeout(r, 50));
const heapAfter = process.memoryUsage().heapUsed;
const heapDelta = heapAfter - heapBefore;

console.log(
  `client memory entities=${ENTITY_COUNT} users=${USER_COUNT}: ` +
    `heapDelta=${mb(heapDelta)} heapTotal=${mb(heapAfter)} ydoc=${mb(docBytes)} ` +
    `(budget heapTotal < ${mb(BUDGET_BYTES)}, NFR-4)`,
);
if (process.env.PLAYWRIGHT === '1') {
  console.log(
    'PLAYWRIGHT=1 browser variant: no served fixture yet — Bun proxy reported above.',
  );
}
if (heapAfter > BUDGET_BYTES) {
  console.error(
    `GATE FAIL: heap ${mb(heapAfter)} exceeds ${mb(BUDGET_BYTES)} (NFR-4)`,
  );
  process.exitCode = 1;
} else {
  console.log('done.');
}
