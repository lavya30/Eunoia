/**
 * D2 compile-pipeline benchmark: parse + reconcile for a 50-node diagram.
 *
 * Run with: `bun run bench` (or `bun benchmarks/compile.bench.ts`) from `frontend/`.
 *
 * CI gate (NFR-3: compile + reconciliation + render under 500ms for a
 * 50-node diagram): parse + reconcile must stay far below that budget.
 * Breaches set a non-zero exit code so CI fails.
 *
 * E2E mode (`--e2e`, nightly): measures the full API-start →
 * canvas-update-complete path against a live sync server —
 * `POST {syncUrl}/api/compile` (Go layout when `D2_COMPILER_URL` is set,
 * local fallback otherwise) + parse + reconcile. The per-iteration total
 * must stay under the same 500ms budget at p95. When no server is reachable
 * at `--sync-url` (default `http://127.0.0.1:3001`) it logs SKIP and exits
 * 0 so per-PR runs stay green; the nightly workflow boots the stack.
 */

import {
  parseCompileResponse,
  reconcileDiagram,
} from '../src/lib/whiteboard/d2-adapter';
import type { BoardNode } from '../src/lib/whiteboard/board-types';

// Bun runtime global (frontend has no @types/bun; keep this structural).
declare const Bun: {
  spawn(
    cmd: string[],
    opts: {
      cwd: string;
      env: Record<string, string | undefined>;
      stdout: string;
      stderr: string;
    },
  ): { kill(): void };
};

const NODE_COUNT = 50;
const BUDGET_MS = 500;

function buildPayload(nodeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    key: `n${i}`,
    label: `node ${i}`,
    x: (i % 10) * 220,
    y: Math.floor(i / 10) * 160,
    width: 180,
    height: 90,
    shape: 'rectangle',
    style: { fill: '#ffffff', stroke: '#5b54c7' },
    strokeWidth: 2,
  }));
  const edges = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    key: `n${i}->n${i + 1}`,
    source: `n${i}`,
    target: `n${i + 1}`,
    label: '',
    color: '#6b7192',
  }));
  return { nodes, edges, engine: 'dagre' };
}

const anchorOf = (node: BoardNode, _target: { x: number; y: number }) => ({
  x: node.x + node.width / 2,
  y: node.y + node.height / 2,
});
const centerOf = (node: BoardNode) => ({
  x: node.x + node.width / 2,
  y: node.y + node.height / 2,
});

function benchParse(iterations: number, payload: unknown): number {
  for (let i = 0; i < 5; i++) parseCompileResponse(payload);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) parseCompileResponse(payload);
  return (performance.now() - start) / iterations;
}

function benchReconcile(
  iterations: number,
  payload: ReturnType<typeof buildPayload>,
): number {
  const diagram = parseCompileResponse(payload);
  if (!diagram) throw new Error('bench payload failed to parse');
  for (let i = 0; i < 5; i++)
    reconcileDiagram([], [], diagram, anchorOf, centerOf);
  const start = performance.now();
  for (let i = 0; i < iterations; i++)
    reconcileDiagram([], [], diagram, anchorOf, centerOf);
  return (performance.now() - start) / iterations;
}

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  for (const token of process.argv.slice(2)) {
    if (token.startsWith(prefix)) return token.slice(prefix.length);
  }
  return fallback;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

function buildSource(nodeCount: number): string {
  // Chain + labels: exercises the real compiler path, not just the fallback.
  const lines = Array.from({ length: nodeCount }, (_, i) => `n${i}: node ${i}`);
  for (let i = 0; i < nodeCount - 1; i++) lines.push(`n${i} -> n${i + 1}`);
  return lines.join('\n');
}

async function runE2e(): Promise<void> {
  const spawn = process.argv.includes('--spawn');
  const iterations = Number(arg('iterations', '20'));
  const source = buildSource(NODE_COUNT);
  let syncUrl = arg(
    'sync-url',
    process.env.SYNC_URL ?? 'http://127.0.0.1:3001',
  );
  let child: ReturnType<typeof Bun.spawn> | undefined;

  const reachable = async (url: string): Promise<boolean> => {
    try {
      const probe = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return probe.ok;
    } catch {
      return false;
    }
  };

  try {
    if (spawn || !(await reachable(syncUrl))) {
      if (!spawn) {
        console.log(
          `compile E2E SKIP: no sync server at ${syncUrl}. Start it with \`bun run dev:sync\` or pass \`--spawn\` for a self-booted measurement.`,
        );
        return;
      }
      // Self-boot a test server with the Community node cap raised: NFR-3
      // needs a 50-node diagram, which exceeds the default cap of 30.
      const port = 18937 + Math.floor(Math.random() * 1000);
      syncUrl = `http://127.0.0.1:${port}`;
      const serverDir = new URL('../../packages/sync-server/', import.meta.url)
        .pathname;
      child = Bun.spawn(['bun', 'src/index.ts'], {
        cwd: serverDir,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          D2_COMMUNITY_NODE_LIMIT: '100',
        },
        stdout: 'ignore',
        stderr: 'ignore',
      });
      let up = false;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await reachable(syncUrl)) {
          up = true;
          break;
        }
      }
      if (!up) {
        console.error(
          'GATE FAIL: spawned sync server did not become healthy (NFR-3 E2E)',
        );
        process.exitCode = 1;
        return;
      }
    }
    const totals: number[] = [];
    let engine = 'unknown';
    let fallback = false;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await fetch(`${syncUrl}/api/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, engine: 'dagre' }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(
          `GATE FAIL: /api/compile answered ${res.status} (NFR-3 E2E)`,
        );
        process.exitCode = 1;
        return;
      }
      const body = (await res.json()) as Record<string, unknown>;
      engine = typeof body.engine === 'string' ? body.engine : engine;
      fallback = body.fallback === true;
      const diagram = parseCompileResponse(body);
      if (!diagram) {
        console.error('GATE FAIL: E2E compile payload failed to parse (NFR-3)');
        process.exitCode = 1;
        return;
      }
      reconcileDiagram([], [], diagram, anchorOf, centerOf);
      totals.push(performance.now() - start);
    }
    totals.sort((a, b) => a - b);
    const p50 = percentile(totals, 50);
    const p95 = percentile(totals, 95);
    console.log(
      `compile E2E N=${NODE_COUNT} engine=${engine}${fallback ? ' (fallback layout)' : ''} ` +
        `n=${iterations}: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (budget p95 < ${BUDGET_MS}ms)`,
    );
    if (p95 > BUDGET_MS) {
      console.error(
        `GATE FAIL: E2E p95 ${p95.toFixed(1)}ms exceeds ${BUDGET_MS}ms (NFR-3)`,
      );
      process.exitCode = 1;
    } else {
      console.log('done.');
    }
  } finally {
    child?.kill();
  }
}

if (process.argv.includes('--e2e')) {
  await runE2e();
} else {
  const payload = buildPayload(NODE_COUNT);
  const parseMs = benchParse(50, payload);
  const reconcileMs = benchReconcile(50, payload);
  const totalMs = parseMs + reconcileMs;

  console.log(
    `compile pipeline N=${NODE_COUNT}: parse=${parseMs.toFixed(3)}ms reconcile=${reconcileMs.toFixed(3)}ms total=${totalMs.toFixed(3)}ms (budget ${BUDGET_MS}ms)`,
  );

  if (totalMs > BUDGET_MS) {
    console.error(
      `GATE FAIL: parse+reconcile ${totalMs.toFixed(1)}ms exceeds ${BUDGET_MS}ms (NFR-3)`,
    );
    process.exitCode = 1;
  } else {
    console.log('done.');
  }
}
