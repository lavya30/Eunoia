/**
 * NFR-2 sync-latency probe: end-to-end peer mutation broadcast.
 *
 * Boots an in-memory sync server, joins WS clients to room(s), and relays
 * timestamped Yjs updates from a sender to the receivers. Reports p50/p95
 * of send-to-receive deltas (client A → server → client B).
 *
 * Run: `bun scripts/latency-probe.ts [--samples=100] [--budget-ms=50]
 *   [--clients=2] [--rooms=1] [--payload=mixed] [--json]`
 * from `packages/sync-server/`. Exit code is non-zero when p95 exceeds
 * the budget so nightly CI can gate on it.
 *
 * Matrix axes (nightly): --clients=5 (one sender, four receivers, worst
 * receiver per probe), --rooms=10 (round-robin across rooms, noisy
 * neighbor), --payload=move|recolor|mixed. --json emits a machine-readable
 * `RESULT {...}` summary line for week-over-week regression tracking
 * (alert on >20% regression, not just budget breach).
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import WebSocket from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { createSyncServer } from "../src/index.js";
import { MemorySnapshotStore } from "../src/RoomLoader.js";

const WS_MESSAGE_SYNC = 0;
const WS_SYNC_UPDATE = 2;

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

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[rank];
}

const samples = Math.floor(arg("samples", 100));
const budgetMs = arg("budget-ms", 50);
const clientCount = Math.max(2, Math.floor(arg("clients", 2)));
const roomCount = Math.max(1, Math.floor(arg("rooms", 1)));
const payloadArg = process.argv
  .find((t) => t.startsWith("--payload="))
  ?.slice("--payload=".length);
const payload: "move" | "recolor" | "mixed" =
  payloadArg === "move" || payloadArg === "recolor" ? payloadArg : "mixed";
const emitJson = process.argv.includes("--json");

const app = createSyncServer(
  {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    snapshotDebounceMs: 10_000,
    roomIdleTimeoutMs: 60_000,
    d2CommunityNodeLimit: 30,
    snapshotMaxPerRoom: 100,
    snapshotRetentionDays: 30,
    roomTicketTtlSec: 86400,
    userTokenTtlSec: 604800,
    r2MaxUploadBytes: 10_000_000,
    r2UrlExpiresInSec: 900,
  },
  new MemorySnapshotStore(),
);
await new Promise<void>((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const address = app.server.address();
if (!address || typeof address === "string")
  throw new Error("Server did not bind");

/** Wait for the next bare sync-update message on a socket. */
function waitForUpdate(socket: WebSocket, probeId: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`probe ${probeId} timed out`));
    }, 2000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      const bytes = new Uint8Array(data as Buffer);
      try {
        const decoder = decoding.createDecoder(bytes);
        if (
          decoding.readVarUint(decoder) !== WS_MESSAGE_SYNC ||
          decoding.readVarUint(decoder) !== WS_SYNC_UPDATE
        )
          return;
      } catch {
        return;
      }
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(performance.now());
    };
    socket.on("message", onMessage);
  });
}

try {
  // One sender + (clients-1) receivers per room; probes round-robin rooms.
  const rooms: { sender: WebSocket; receivers: WebSocket[]; doc: Y.Doc }[] = [];
  for (let r = 0; r < roomCount; r++) {
    const id = roomCount === 1 ? "latency-probe" : `latency-probe-${r}`;
    await app.manager.createRoom({ id, name: "Latency probe" });
    const url = `ws://127.0.0.1:${address.port}/sync/${id}`;
    const sender = await open(url);
    const receivers: WebSocket[] = [];
    for (let c = 1; c < clientCount; c++) receivers.push(await open(url));
    rooms.push({ sender, receivers, doc: new Y.Doc() });
  }
  // Let initial sync step1/step2 chatter settle before measuring.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const latencies: number[] = [];
  for (let i = 0; i < samples; i++) {
    const room = rooms[i % rooms.length];
    const kind =
      payload === "mixed" ? (i % 2 === 0 ? "move" : "recolor") : payload;
    const key = kind === "move" ? `probe-${i}` : "recolor-target";
    if (kind === "move") {
      room.doc
        .getMap("canvas")
        .set(key, { x: i * 7, y: i * 3, ts: Date.now() });
    } else {
      room.doc
        .getMap("canvas")
        .set(key, {
          color: `#${((i * 1234567) % 0xffffff).toString(16).padStart(6, "0")}`,
        });
    }
    const pending = room.receivers.map((socket) => waitForUpdate(socket, i));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(room.doc));
    const sentAt = performance.now();
    room.sender.send(encoding.toUint8Array(encoder));
    const arrived = await Promise.all(pending);
    // Worst receiver per probe: the broadcast is only as fast as its tail.
    latencies.push(Math.max(...arrived) - sentAt);
    // Small gap so each probe is a distinct server relay, not a batch.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies[latencies.length - 1];
  console.log(
    `sync latency rooms=${roomCount} clients=${clientCount} payload=${payload} n=${samples}: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms (budget p95 < ${budgetMs}ms, NFR-2)`,
  );
  if (emitJson) {
    console.log(
      `RESULT ${JSON.stringify({ nfr: "NFR-2", rooms: roomCount, clients: clientCount, payload, samples, p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)), max: Number(max.toFixed(2)), budgetMs, pass: p95 <= budgetMs })}`,
    );
  }
  for (const room of rooms) {
    room.sender.close();
    for (const socket of room.receivers) socket.close();
  }
  if (p95 > budgetMs) {
    console.error(
      `GATE FAIL: p95 ${p95.toFixed(2)}ms exceeds ${budgetMs}ms (NFR-2)`,
    );
    process.exitCode = 1;
  }
} finally {
  await app.close();
}
