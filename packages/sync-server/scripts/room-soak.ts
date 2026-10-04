/**
 * NFR-6 server-throughput soak: many rooms × 5 users on one instance.
 *
 * Boots an in-memory sync server, joins `--rooms` rooms with 5 WS clients
 * each (one sender, four receivers), relays one mutation per room per round,
 * and reports relay p95 plus server RSS.
 *
 * Run: `bun scripts/room-soak.ts [--rooms=100] [--rounds=5] [--json]`
 * from `packages/sync-server/`. Target (SLO, initial): 500 rooms × 5 users
 * on a 16GB instance without relay p95 regression vs the single-room probe
 * (budget p95 < 50ms). Nightly CI; advisory until two green windows, then
 * blocking.
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

const roomCount = Math.floor(arg("rooms", 100));
const rounds = Math.floor(arg("rounds", 5));
const budgetMs = arg("budget-ms", 50);
const emitJson = process.argv.includes("--json");
const USERS_PER_ROOM = 5;

const app = createSyncServer(
  {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    snapshotDebounceMs: 10_000,
    roomIdleTimeoutMs: 120_000,
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

try {
  const rooms: { sender: WebSocket; receivers: WebSocket[]; doc: Y.Doc }[] = [];
  for (let r = 0; r < roomCount; r++) {
    const id = `soak-${r}`;
    await app.manager.createRoom({ id, name: "Soak room" });
    const url = `ws://127.0.0.1:${address.port}/sync/${id}`;
    const sender = await open(url);
    const receivers: WebSocket[] = [];
    for (let c = 1; c < USERS_PER_ROOM; c++) receivers.push(await open(url));
    rooms.push({ sender, receivers, doc: new Y.Doc() });
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  const latencies: number[] = [];
  for (let round = 0; round < rounds; round++) {
    for (let r = 0; r < rooms.length; r++) {
      const room = rooms[r];
      room.doc
        .getMap("canvas")
        .set(`soak-${round}`, { round, room: r, ts: Date.now() });
      const pending = room.receivers.map(
        (socket) =>
          new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => {
              socket.off("message", onMessage);
              reject(new Error(`soak r${r} round ${round} timed out`));
            }, 5000);
            const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
              if (!isBinary) return;
              try {
                const decoder = decoding.createDecoder(
                  new Uint8Array(data as Buffer),
                );
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
          }),
      );
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(room.doc));
      const sentAt = performance.now();
      room.sender.send(encoding.toUint8Array(encoder));
      const arrived = await Promise.all(pending);
      latencies.push(Math.max(...arrived) - sentAt);
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const max = latencies[latencies.length - 1];
  const rssMB = process.memoryUsage().rss / 1024 / 1024;
  console.log(
    `room soak rooms=${roomCount} usersPerRoom=${USERS_PER_ROOM} relays=${latencies.length}: ` +
      `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms rss=${rssMB.toFixed(1)}MB ` +
      `(budget p95 < ${budgetMs}ms, NFR-6)`,
  );
  if (emitJson) {
    console.log(
      `RESULT ${JSON.stringify({ nfr: "NFR-6", rooms: roomCount, usersPerRoom: USERS_PER_ROOM, relays: latencies.length, p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)), max: Number(max.toFixed(2)), rssMB: Number(rssMB.toFixed(1)), budgetMs, pass: p95 <= budgetMs })}`,
    );
  }
  for (const room of rooms) {
    room.sender.close();
    for (const socket of room.receivers) socket.close();
  }
  if (p95 > budgetMs) {
    console.error(
      `GATE FAIL: soak p95 ${p95.toFixed(2)}ms exceeds ${budgetMs}ms (NFR-6)`,
    );
    process.exitCode = 1;
  } else {
    console.log("done.");
  }
} finally {
  await app.close();
}
