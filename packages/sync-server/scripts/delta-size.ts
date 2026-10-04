/**
 * NFR-5 network-efficiency probe: Yjs binary delta sizes per op type.
 *
 * Measures `Y.encodeStateAsUpdate` byte lengths for the canonical canvas
 * ops — shape move, recolor, text edit, node add — over 50 samples each.
 *
 * Run: `bun scripts/delta-size.ts [--samples=50] [--json]`
 * from `packages/sync-server/`. Budgets (SLO, initial): p95 < 2KB for a
 * shape move, p95 < 1KB for a recolor; text edit and node add are reported
 * without a hard gate. Non-zero exit on breach so per-PR CI can gate.
 */
import * as Y from "yjs";

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
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

const samples = Math.floor(arg("samples", 50));
const emitJson = process.argv.includes("--json");
const MOVE_BUDGET = 2048;
const RECOLOR_BUDGET = 1024;

type Op = "move" | "recolor" | "text" | "add";

function applyOp(doc: Y.Doc, op: Op, i: number): void {
  const board = doc.getMap("board");
  if (op === "move") {
    board.set(`n-${i % 200}`, { x: i * 7.5, y: i * 3.25, w: 180, h: 90 });
  } else if (op === "recolor") {
    board.set(`color-${i % 200}`, {
      color: `#${((i * 1234567) % 0xffffff).toString(16).padStart(6, "0")}`,
    });
  } else if (op === "text") {
    board.set(`label-${i % 200}`, {
      label: `updated label text iteration ${i}`,
    });
  } else {
    board.set(`new-${i}`, { x: i, y: i, w: 180, h: 90, label: `node ${i}` });
  }
}

const results: Record<Op, number[]> = {
  move: [],
  recolor: [],
  text: [],
  add: [],
};
for (const op of Object.keys(results) as Op[]) {
  // Fresh doc per op with a warmed baseline of 200 entities. Each sample
  // diffs against the immediately-preceding state vector, so the measured
  // bytes are the true per-op wire cost (steady-state traffic), not the
  // cumulative history since baseline.
  const doc = new Y.Doc();
  for (let i = 0; i < 200; i++) applyOp(doc, op, i);
  for (let i = 0; i < samples; i++) {
    const baseline = Y.encodeStateVector(doc);
    applyOp(doc, op, 200 + i);
    const update = Y.encodeStateAsUpdate(doc, baseline);
    results[op].push(update.length);
  }
}

let failed = false;
const summary: Record<
  string,
  { p50: number; p95: number; max: number; budget?: number; pass?: boolean }
> = {};
for (const op of Object.keys(results) as Op[]) {
  const sorted = [...results[op]].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1];
  const budget =
    op === "move" ? MOVE_BUDGET : op === "recolor" ? RECOLOR_BUDGET : undefined;
  const pass = budget === undefined ? true : p95 <= budget;
  summary[op] = {
    p50,
    p95,
    max,
    ...(budget !== undefined ? { budget, pass } : {}),
  };
  console.log(
    `delta ${op} n=${samples}: p50=${p50}B p95=${p95}B max=${max}B` +
      (budget !== undefined
        ? ` (budget p95 < ${budget}B)`
        : " (reported, no gate)"),
  );
  if (!pass) {
    console.error(`GATE FAIL: ${op} p95 ${p95}B exceeds ${budget}B (NFR-5)`);
    failed = true;
  }
}
if (emitJson)
  console.log(
    `RESULT ${JSON.stringify({ nfr: "NFR-5", samples, ops: summary, pass: !failed })}`,
  );
if (failed) process.exitCode = 1;
else console.log("done.");
