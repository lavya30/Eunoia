/**
 * NFR-7 snapshot-flush bench: p95 write latency for a ~1MB snapshot.
 *
 * Builds a Y.Doc whose compressed snapshot is ≈1MB, then times debounced
 * `SnapshotWorker` flushes plus a final pre-evict `dispose()` flush,
 * mirroring the production write path (encode → fflate compress → store).
 *
 * Run: `bun scripts/snapshot-flush.bench.ts [--rounds=20] [--json]`
 * from `packages/sync-server/`. Budget (SLO, initial): p95 < 1000ms per
 * flush. The memory store measures encode+compress cost; PostgreSQL
 * BYTEA write time is covered in production via
 * `eunoia_snapshot_flush_duration_ms_*`. Nightly CI; advisory until two
 * green windows, then blocking.
 */
import * as Y from 'yjs';
import { MemorySnapshotStore } from '../src/RoomLoader.js';
import { SnapshotWorker } from '../src/SnapshotWorker.js';

function arg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  for (const token of process.argv.slice(2)) {
    if (token.startsWith(prefix)) {
      const value = Number(token.slice(prefix.length));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return fallback;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const rounds = Math.floor(arg('rounds', 20));
const budgetMs = arg('budget-ms', 1000);
const emitJson = process.argv.includes('--json');

// Grow a doc until its compressed snapshot is ≈1MB (cap iterations to
// avoid runaway generation on highly compressible filler).
const doc = new Y.Doc();
const board = doc.getMap('board');
let seed = 0;
{
  const probe = new Y.Doc();
  const prng = (n: number) => {
    let x = n;
    return () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x7fffffff;
    };
  };
  const rand = prng(42);
  while (seed < 20000) {
    board.set(`fill-${seed}`, {
      label: `node ${seed} ${rand().toString(36).slice(2)}`,
      x: rand() * 12000,
      y: rand() * 8000,
      w: 40 + rand() * 260,
      h: 30 + rand() * 160,
      color: `#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0')}`,
    });
    seed++;
    if (seed % 2000 === 0) {
      probe.getMap('b').clear();
      for (const [k, v] of board.entries()) probe.getMap('b').set(k, v);
      const { compressSync } = await import('fflate');
      if (compressSync(Y.encodeStateAsUpdate(probe)).length >= 1_000_000) break;
    }
  }
}

const store = new MemorySnapshotStore();
const snapshots = await store.listSnapshots('flush-bench');
void snapshots;

const durations: number[] = [];
let bytes = 0;
for (let i = 0; i < rounds; i++) {
  board.set(`round-${i}`, { round: i, ts: Date.now(), jitter: Math.random().toString(36) });
  const worker = new SnapshotWorker('flush-bench', store, 0, (report) => {
    durations.push(report.durationMs);
    bytes = report.bytes;
  });
  worker.schedule(doc);
  await worker.dispose(doc);
}

durations.sort((a, b) => a - b);
const p50 = percentile(durations, 50);
const p95 = percentile(durations, 95);
const max = durations[durations.length - 1];
console.log(
  `snapshot flush n=${rounds} bytes=${(bytes / 1024).toFixed(0)}KB: ` +
    `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms ` +
    `(budget p95 < ${budgetMs}ms, NFR-7)`,
);
if (emitJson) {
  console.log(
    `RESULT ${JSON.stringify({ nfr: 'NFR-7', rounds, bytes, p50, p95, max, budgetMs, pass: p95 <= budgetMs })}`,
  );
}
if (p95 > budgetMs) {
  console.error(`GATE FAIL: flush p95 ${p95.toFixed(1)}ms exceeds ${budgetMs}ms (NFR-7)`);
  process.exitCode = 1;
} else {
  console.log('done.');
}
