/**
 * Culling benchmark: custom grid SpatialIndex vs rbush vs brute force.
 *
 * Run with: `bun benchmarks/culling.bench.ts` from `frontend/`.
 *
 * Measures index rebuild + viewport search across corpus sizes and zoom
 * levels so index changes (cell size, rbush adoption) are decided by
 * numbers, not intuition. CI gate guidance (PRD §5.1): 60 FPS pan/zoom
 * at 3,000+ shapes; investigate when p50 search exceeds ~2ms or rebuild
 * exceeds ~8ms at 3k.
 */

import RBush from 'rbush';
import { SpatialIndex } from '../src/lib/whiteboard/spatial-index';
import type { Aabb } from '../src/lib/whiteboard/geometry';

type Entry = Aabb & { id: string };

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

function generateCorpus(size: number, seed: number): Entry[] {
  const rand = mulberry32(seed);
  const entries: Entry[] = [];
  for (let i = 0; i < size; i++) {
    // Mix: 70% clustered (diagram-like groups), 30% uniform scatter.
    const clustered = rand() < 0.7;
    const cx = clustered
      ? Math.floor(rand() * 8) * 600 + rand() * 400
      : rand() * 12000;
    const cy = clustered
      ? Math.floor(rand() * 6) * 500 + rand() * 350
      : rand() * 8000;
    const w = 40 + rand() * 260;
    const h = 30 + rand() * 160;
    const x = cx - w / 2;
    const y = cy - h / 2;
    entries.push({ id: `n-${i}`, minX: x, minY: y, maxX: x + w, maxY: y + h });
  }
  return entries;
}

const VIEWPORTS: Array<{ name: string; bounds: Aabb }> = [
  {
    name: 'close-up',
    bounds: { minX: 500, minY: 400, maxX: 1700, maxY: 1100 },
  },
  {
    name: 'wide (zoomed out)',
    bounds: { minX: -2000, minY: -2000, maxX: 14000, maxY: 10000 },
  },
];

function intersects(a: Aabb, b: Aabb): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

function bench(
  name: string,
  iterations: number,
  fn: () => number,
): { name: string; avgMs: number; hits: number } {
  // Warmup.
  for (let i = 0; i < Math.min(5, iterations); i++) fn();
  let hits = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) hits += fn();
  const total = performance.now() - start;
  return { name, avgMs: total / iterations, hits };
}

function runCorpus(size: number): void {
  const corpus = generateCorpus(size, 42);
  console.log(`\n=== corpus N=${size} ===`);

  // Grid index (current implementation).
  const grid = new SpatialIndex<Entry>();
  const gridBuild = bench('grid rebuild', 10, () => {
    grid.rebuild(corpus.map((e) => ({ ...e, value: e })));
    return 0;
  });
  grid.rebuild(corpus.map((e) => ({ ...e, value: e })));

  // rbush bulk load.
  let tree = new RBush<Entry>();
  const rbushBuild = bench('rbush bulk-load', 10, () => {
    tree = new RBush<Entry>();
    tree.load(corpus);
    return 0;
  });
  tree = new RBush<Entry>();
  tree.load(corpus);

  console.log(
    `  build: grid=${gridBuild.avgMs.toFixed(2)}ms rbush=${rbushBuild.avgMs.toFixed(2)}ms`,
  );

  for (const viewport of VIEWPORTS) {
    // Correctness: single-run counts must agree.
    const gridCount = grid.search(viewport.bounds).length;
    const rbushCount = tree.search(viewport.bounds).length;
    let bruteCount = 0;
    for (const e of corpus) if (intersects(e, viewport.bounds)) bruteCount++;
    if (gridCount !== rbushCount || gridCount !== bruteCount) {
      console.error(
        `  MISMATCH ${viewport.name}: grid=${gridCount} rbush=${rbushCount} brute=${bruteCount}`,
      );
      process.exitCode = 1;
    }
    const gridSearch = bench(`grid search ${viewport.name}`, 50, () => {
      return grid.search(viewport.bounds).length;
    });
    const rbushSearch = bench(`rbush search ${viewport.name}`, 50, () => {
      return tree.search(viewport.bounds).length;
    });
    const bruteSearch = bench(`brute-force ${viewport.name}`, 10, () => {
      let count = 0;
      for (const e of corpus) if (intersects(e, viewport.bounds)) count++;
      return count;
    });
    console.log(
      `  search ${viewport.name}: grid=${gridSearch.avgMs.toFixed(3)}ms rbush=${rbushSearch.avgMs.toFixed(3)}ms brute=${bruteSearch.avgMs.toFixed(3)}ms (${gridCount} visible)`,
    );
  }
}

for (const size of [500, 3000, 5000, 10000]) {
  runCorpus(size);
}
console.log('\ndone.');
