/**
 * NFR-1 render-FPS bench: continuous pan/zoom over a 3,000-shape board.
 *
 * What it measures (per frame): RBush viewport search + per-visible-node
 * screen transform (the CPU work the SVG renderer does before DOM diffing).
 * DOM paint itself is browser-only, so this is the CI-runnable proxy; the
 * full Playwright rAF measurement is the nightly variant (see below).
 *
 * Run with: `bun benchmarks/render-fps.bench.ts` from `frontend/`.
 * CI gate (NFR-1: 60 FPS pan/zoom at 3,000+ shapes): p95 frame must stay
 * under 16.7ms and no sustained <55 FPS window (3 consecutive frames over
 * 18.2ms) may occur. Breaches set a non-zero exit code so CI fails.
 *
 * Nightly browser variant: set `PLAYWRIGHT=1` with `playwright` installed
 * and a served `/board` fixture — the script then drives real pan/zoom and
 * collects rAF deltas instead of the synthetic proxy. Until that fixture
 * exists it logs a skip notice and runs the proxy.
 */

import { createRequire } from 'node:module';
import { SpatialIndex } from '../src/lib/whiteboard/spatial-index';
import type { Aabb } from '../src/lib/whiteboard/geometry';

type Entry = Aabb & { id: string; w: number; h: number };

const SHAPE_COUNT = 3000;
const FRAME_BUDGET_MS = 16.7;
const SUSTAINED_SLOW_MS = 18.2; // ~55 FPS
const FRAMES = 600;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBoard(size: number): Entry[] {
  const rand = mulberry32(7);
  const entries: Entry[] = [];
  for (let i = 0; i < size; i++) {
    const clustered = rand() < 0.7;
    const cx = clustered
      ? Math.floor(rand() * 8) * 600 + rand() * 400
      : rand() * 12000;
    const cy = clustered
      ? Math.floor(rand() * 6) * 500 + rand() * 350
      : rand() * 8000;
    const w = 40 + rand() * 260;
    const h = 30 + rand() * 160;
    entries.push({ id: `n-${i}`, minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2, w, h });
  }
  return entries;
}

/** Pan across the board while zooming in and out (one smooth loop). */
function viewportForFrame(frame: number, total: number): Aabb {
  const t = frame / total;
  const panX = -1000 + t * 9000;
  const panY = -800 + Math.sin(t * Math.PI * 2) * 2200;
  const zoom = 1 + 0.85 * Math.sin(t * Math.PI * 4);
  const vw = 1440 / zoom;
  const vh = 900 / zoom;
  return { minX: panX, minY: panY, maxX: panX + vw, maxY: panY + vh };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function maybeBrowserVariant(): Promise<boolean> {
  if (process.env.PLAYWRIGHT !== '1') return false;
  let resolved = false;
  try {
    createRequire(import.meta.url).resolve('playwright');
    resolved = true;
  } catch {
    resolved = false;
  }
  if (!resolved) {
    console.log('PLAYWRIGHT=1 but playwright is not installed — running synthetic proxy instead.');
    return false;
  }
  console.log('Playwright browser variant: no served /board fixture yet — running synthetic proxy instead.');
  return false;
}

const board = buildBoard(SHAPE_COUNT);
const index = new SpatialIndex<Entry>();
index.rebuild(board.map((e) => ({ ...e, value: e })));

await maybeBrowserVariant();

// Warmup.
for (let f = 0; f < 10; f++) {
  const vp = viewportForFrame(f, FRAMES);
  const visible = index.search(vp);
  let acc = 0;
  for (const n of visible) acc += (n.maxX - vp.minX) * 0.001 + (n.maxY - vp.minY) * 0.001;
  if (acc < 0) console.log('unreachable');
}

const frameMs: number[] = [];
let totalVisible = 0;
for (let f = 0; f < FRAMES; f++) {
  const vp = viewportForFrame(f, FRAMES);
  const start = performance.now();
  const visible = index.search(vp);
  // Per-visible-node screen transform: world→screen + rect emit, the same
  // arithmetic the SVG layer performs per node before DOM diffing.
  const scale = 1440 / (vp.maxX - vp.minX);
  let sink = 0;
  for (const n of visible) {
    const sx = (n.minX - vp.minX) * scale;
    const sy = (n.minY - vp.minY) * scale;
    const sw = n.w * scale;
    const sh = n.h * scale;
    sink += sx + sy + sw + sh;
  }
  totalVisible += visible.length;
  frameMs.push(performance.now() - start);
  if (sink < 0) console.log('unreachable');
}

frameMs.sort((a, b) => a - b);
const p50 = percentile(frameMs, 50);
const p95 = percentile(frameMs, 95);
const p99 = percentile(frameMs, 99);
const max = frameMs[frameMs.length - 1];
const avgVisible = Math.round(totalVisible / FRAMES);

// Sustained-slow window: 3 consecutive frames each over ~55 FPS pace,
// checked in frame order (adjacency matters, so the sorted array is not used).
let sustained = 0;
let run = 0;
{
  const ordered: number[] = [];
  // Re-run cheaply in order to check adjacency (search dominates anyway).
  for (let f = 0; f < FRAMES; f++) {
    const vp = viewportForFrame(f, FRAMES);
    const start = performance.now();
    const visible = index.search(vp);
    const scale = 1440 / (vp.maxX - vp.minX);
    let sink = 0;
    for (const n of visible) sink += (n.minX - vp.minX) * scale + n.w * scale;
    ordered.push(performance.now() - start);
    if (sink < 0) console.log('unreachable');
  }
  for (const ms of ordered) {
    run = ms > SUSTAINED_SLOW_MS ? run + 1 : 0;
    if (run === 3) sustained++;
  }
}

console.log(
  `render-fps N=${SHAPE_COUNT} frames=${FRAMES} avgVisible=${avgVisible}: ` +
    `p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms ` +
    `(budget p95 < ${FRAME_BUDGET_MS}ms, sustained-slow-windows=${sustained})`,
);

let failed = false;
if (p95 > FRAME_BUDGET_MS) {
  console.error(`GATE FAIL: p95 ${p95.toFixed(3)}ms exceeds ${FRAME_BUDGET_MS}ms (NFR-1)`);
  failed = true;
}
if (sustained > 0) {
  console.error(`GATE FAIL: ${sustained} sustained <55 FPS window(s) (NFR-1)`);
  failed = true;
}
if (failed) process.exitCode = 1;
else console.log('done.');
