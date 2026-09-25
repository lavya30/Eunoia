import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as encoding from "lib0/encoding";
import WebSocket from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  assertEngineAllowed,
  assertNodeCountAllowed,
  TierUpgradeError,
} from "../src/d2-compiler.js";
import { MemoryImageStore, MemoryR2Client } from "../src/images.js";
import { createSyncServer, type SyncServer } from "../src/index.js";
import { Room } from "../src/Room.js";
import {
  applyRetention,
  MemorySnapshotStore,
  type StoredSnapshot,
} from "../src/RoomLoader.js";
import {
  hashPassword,
  issueTicket,
  isValidPassword,
  verifyPassword,
  verifyTicket,
} from "../src/room-auth.js";
import { SnapshotWorker } from "../src/SnapshotWorker.js";
import type { RoomClient } from "../src/types.js";

describe("HTTP API", () => {
  let app: SyncServer;
  let baseUrl: string;

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
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
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => app.close());

  test("creates rooms and returns a development D2 placeholder", async () => {
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Architecture" }),
    });
    expect(roomResponse.status).toBe(201);
    const room = (await roomResponse.json()) as { id: string; name: string };
    expect(room.name).toBe("Architecture");

    const compileResponse = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "a -> b" }),
    });
    expect(compileResponse.status).toBe(200);
    expect((await compileResponse.json()).placeholder).toBe(true);
  });

  test("returns structured validation errors for malformed requests", async () => {
    const badRoom = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   ", unexpected: true }),
    });
    expect(badRoom.status).toBe(400);
    const roomPayload = (await badRoom.json()) as {
      code: string;
      issues: { path: string; code: string }[];
    };
    expect(roomPayload.code).toBe("VALIDATION_ERROR");
    expect(roomPayload.issues.some((issue) => issue.path === "name")).toBe(
      true,
    );

    const badCompile = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "", extra: true }),
    });
    expect(badCompile.status).toBe(400);
    const compilePayload = (await badCompile.json()) as {
      code: string;
      issues: { path: string; code: string }[];
    };
    expect(compilePayload.code).toBe("VALIDATION_ERROR");
    expect(compilePayload.issues.some((issue) => issue.path === "source")).toBe(
      true,
    );
    expect(
      compilePayload.issues.some((issue) => issue.code === "unrecognized_keys"),
    ).toBe(true);
  });

  test("rejects Pro-only engines for Community callers", async () => {
    for (const engine of ["elk", "tala"]) {
      const response = await fetch(`${baseUrl}/api/compile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "a -> b", engine }),
      });
      expect(response.status).toBe(403);
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload.code).toBe("TIER_UPGRADE_REQUIRED");
    }
  });

  test("ignores a client-asserted Pro tier without a room", async () => {
    const response = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "a -> b", engine: "tala", tier: "PRO" }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      "TIER_UPGRADE_REQUIRED",
    );
  });

  test("rejects unknown engines and rooms", async () => {
    const badEngine = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "a -> b", engine: "graphviz" }),
    });
    expect(badEngine.status).toBe(400);
    expect(((await badEngine.json()) as Record<string, unknown>).code).toBe(
      "INVALID_ENGINE",
    );

    const missingRoom = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "a -> b", roomId: "no-such-room" }),
    });
    expect(missingRoom.status).toBe(404);
  });

  test("resolves the tier from the room for Pro compiles", async () => {
    // HTTP creation caps tiers at the caller's, so PRO fixtures go through
    // the trusted manager layer (as a DB edit would).
    const room = await app.manager.createRoom({
      name: "Pro diagrams",
      tier: "PRO",
    });

    const compileResponse = await fetch(`${baseUrl}/api/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "a -> b",
        engine: "elk",
        roomId: room.id,
      }),
    });
    expect(compileResponse.status).toBe(200);
    const payload = (await compileResponse.json()) as {
      engine: string;
      placeholder: boolean;
    };
    expect(payload.engine).toBe("elk");
    expect(payload.placeholder).toBe(true);
  });

  test("rejects room tiers above the caller's on creation", async () => {
    const response = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sneaky", tier: "PRO" }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      "TIER_UPGRADE_REQUIRED",
    );
  });
});

describe("D2 tier limits", () => {
  test("allows dagre on every tier and elk/tala on Pro and Enterprise", () => {
    expect(() => assertEngineAllowed("dagre", "COMMUNITY")).not.toThrow();
    expect(() => assertEngineAllowed("elk", "PRO")).not.toThrow();
    expect(() => assertEngineAllowed("tala", "ENTERPRISE")).not.toThrow();
    expect(() => assertEngineAllowed("elk", "COMMUNITY")).toThrow(
      TierUpgradeError,
    );
    expect(() => assertEngineAllowed("tala", "COMMUNITY")).toThrow(
      TierUpgradeError,
    );
  });

  test("caps Community diagrams at the node limit", () => {
    expect(() => assertNodeCountAllowed(30, "COMMUNITY", 30)).not.toThrow();
    expect(() => assertNodeCountAllowed(31, "COMMUNITY", 30)).toThrow(
      TierUpgradeError,
    );
    expect(() => assertNodeCountAllowed(500, "PRO", 30)).not.toThrow();
    expect(() => assertNodeCountAllowed(500, "ENTERPRISE", 30)).not.toThrow();
  });
});

describe("Room images", () => {
  let app: SyncServer;
  let baseUrl: string;
  let roomId: string;

  const post = (path: string, payload: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
        userTokenTtlSec: 604800,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
      },
      new MemorySnapshotStore(),
      { imageStore: new MemoryImageStore(), r2: new MemoryR2Client() },
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const roomResponse = await post("/api/rooms", { name: "Gallery" });
    expect(roomResponse.status).toBe(201);
    roomId = ((await roomResponse.json()) as { id: string }).id;
  });

  afterEach(async () => app.close());

  async function upload(
    contentType = "image/png",
    kind = "image",
    size = 1024,
  ) {
    const requestResponse = await post(
      `/api/rooms/${roomId}/images/request-upload`,
      { contentType, kind },
    );
    expect(requestResponse.status).toBe(200);
    const { key } = (await requestResponse.json()) as { key: string };
    expect(key.startsWith(`rooms/${roomId}/`)).toBe(true);
    const confirmResponse = await post(`/api/rooms/${roomId}/images/confirm`, {
      key,
      contentType,
      size,
      kind,
    });
    return { key, confirmResponse };
  }

  test("runs the full upload-confirm-list-url-delete lifecycle", async () => {
    const { key, confirmResponse } = await upload();
    expect(confirmResponse.status).toBe(201);
    const image = (await confirmResponse.json()) as {
      id: string;
      roomId: string;
      key: string;
      url: string;
      contentType: string;
      size: number;
      kind: string;
    };
    expect(image.key).toBe(key);
    expect(image.roomId).toBe(roomId);
    expect(image.contentType).toBe("image/png");
    expect(image.size).toBe(1024);

    const list = await fetch(`${baseUrl}/api/rooms/${roomId}/images`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const url = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images/${image.id}/url`,
    );
    expect(url.status).toBe(200);
    expect(typeof ((await url.json()) as { url: string }).url).toBe("string");

    const remove = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images/${image.id}`,
      { method: "DELETE" },
    );
    expect(remove.status).toBe(204);

    const afterDelete = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images/${image.id}/url`,
    );
    expect(afterDelete.status).toBe(404);
  });

  test("rejects bad input, foreign keys, duplicates, and oversize uploads", async () => {
    const badType = await post(`/api/rooms/${roomId}/images/request-upload`, {
      contentType: "text/html",
    });
    expect(badType.status).toBe(400);

    const missingRoom = await post(
      "/api/rooms/no-such-room/images/request-upload",
      { contentType: "image/png" },
    );
    expect(missingRoom.status).toBe(404);

    const missingObject = await post(`/api/rooms/${roomId}/images/confirm`, {
      key: `rooms/${roomId}/never-uploaded.png`,
      size: 10,
    });
    expect(missingObject.status).toBe(404);

    const { key, confirmResponse } = await upload();
    expect(confirmResponse.status).toBe(201);
    const duplicate = await post(`/api/rooms/${roomId}/images/confirm`, {
      key,
      size: 10,
    });
    expect(duplicate.status).toBe(409);

    const oversize = await upload("image/png", "image", 11_000_000);
    expect(oversize.confirmResponse.status).toBe(413);
  });

  test("scopes keys to rooms and filters listings by kind", async () => {
    await upload("image/png", "thumbnail");
    await upload("image/jpeg", "image");

    const other = await post("/api/rooms", { name: "Other" });
    const otherId = ((await other.json()) as { id: string }).id;
    const foreign = await post(`/api/rooms/${otherId}/images/request-upload`, {
      contentType: "image/png",
    });
    const foreignKey = ((await foreign.json()) as { key: string }).key;
    const smuggled = await post(`/api/rooms/${roomId}/images/confirm`, {
      key: foreignKey,
      size: 10,
    });
    expect(smuggled.status).toBe(400);

    const thumbnails = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images?kind=thumbnail`,
    );
    expect(thumbnails.status).toBe(200);
    const items = (await thumbnails.json()) as { kind: string }[];
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("thumbnail");

    const badKind = await fetch(
      `${baseUrl}/api/rooms/${roomId}/images?kind=document`,
    );
    expect(badKind.status).toBe(400);
  });

  test("returns 503 when R2 is not configured", async () => {
    const bare = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
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
      bare.server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = bare.server.address();
      if (!address || typeof address === "string")
        throw new Error("Server did not bind");
      const url = `http://127.0.0.1:${address.port}`;
      const roomResponse = await fetch(`${url}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Bare" }),
      });
      const bareRoomId = ((await roomResponse.json()) as { id: string }).id;
      const response = await fetch(
        `${url}/api/rooms/${bareRoomId}/images/request-upload`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentType: "image/png" }),
        },
      );
      expect(response.status).toBe(503);
      expect(((await response.json()) as Record<string, unknown>).code).toBe(
        "R2_NOT_CONFIGURED",
      );
    } finally {
      await bare.close();
    }
  });
});

describe("Snapshot history", () => {
  let app: SyncServer;
  let baseUrl: string;
  let wsUrl: string;
  let roomId: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
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
    baseUrl = `http://127.0.0.1:${address.port}`;
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "History" }),
    });
    expect(roomResponse.status).toBe(201);
    roomId = ((await roomResponse.json()) as { id: string }).id;
    wsUrl = `ws://127.0.0.1:${address.port}/sync/${roomId}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
  });

  /** Push a canvas mutation through the sync protocol and await its flush. */
  async function pushUpdate(value: unknown): Promise<WebSocket> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    sockets.push(socket);
    const doc = new Y.Doc();
    doc.getMap("canvas").set("a", value);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    socket.send(encoding.toUint8Array(encoder));
    await new Promise((resolve) => setTimeout(resolve, 60));
    return socket;
  }

  async function list(query = "") {
    const response = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots${query}`,
    );
    return {
      status: response.status,
      items: (await response.json()) as {
        id: string;
        docVersion: string;
        createdAt: string;
        data?: unknown;
      }[],
    };
  }

  test("lists snapshots newest-first without document bytes", async () => {
    expect((await list()).items).toEqual([]);
    await pushUpdate(1);
    const { status, items } = await list();
    expect(status).toBe(200);
    expect(items.length).toBe(1);
    expect(items[0].id).toBeString();
    expect(items[0].docVersion).toBeString();
    expect(items[0].createdAt).toBeString();
    expect(items[0].data).toBeUndefined();
  });

  test("paginates with limit and before", async () => {
    await pushUpdate(1);
    await pushUpdate(2);
    await pushUpdate(3);
    const full = (await list()).items;
    expect(full.length).toBe(3);

    const limited = await list("?limit=2");
    expect(limited.items.length).toBe(2);
    expect(limited.items.map((item) => item.id)).toEqual(
      full.slice(0, 2).map((item) => item.id),
    );

    const older = await list(
      `?before=${encodeURIComponent(full[0].createdAt)}`,
    );
    expect(older.items.map((item) => item.id)).toEqual(
      full.slice(1).map((item) => item.id),
    );

    const badLimit = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots?limit=500`,
    );
    expect(badLimit.status).toBe(400);
    const badBefore = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots?before=not-a-date`,
    );
    expect(badBefore.status).toBe(400);
    const missing = await fetch(`${baseUrl}/api/rooms/no-such-room/snapshots`);
    expect(missing.status).toBe(404);
  });

  test("restores a snapshot, keeps a safety copy, and drops peers", async () => {
    await pushUpdate(1);
    const peer = await pushUpdate(2);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      peer.once("close", (code: number, reason: Buffer) =>
        resolve({ code, reason: reason.toString() }),
      );
    });

    const before = (await list()).items;
    expect(before.length).toBe(2);

    const restore = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots/${before[1].id}/restore`,
      { method: "POST" },
    );
    expect(restore.status).toBe(200);
    const receipt = (await restore.json()) as {
      restored: string;
      restoredAt: string;
    };
    expect(receipt.restored).toBe(before[1].id);

    // Safety flush of the pre-restore state plus the restored state.
    const after = (await list()).items;
    expect(after.length).toBeGreaterThanOrEqual(3);

    // Peers holding newer state are dropped so they resync from scratch.
    const { code } = await Promise.race([
      closed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("peer was not dropped")), 1000),
      ),
    ]);
    expect(code).toBe(4100);

    const unknown = await fetch(
      `${baseUrl}/api/rooms/${roomId}/snapshots/no-such-id/restore`,
      { method: "POST" },
    );
    expect(unknown.status).toBe(404);
  });

  test("room content actually rolls back", async () => {
    const store = new MemorySnapshotStore();
    const doc = new Y.Doc();
    doc.getMap("canvas").set("a", 1);
    const worker = new SnapshotWorker("rollback-room", store, 0);
    worker.schedule(doc);
    await worker.flush(doc);

    const room = new Room("rollback-room", doc, worker);
    const [first] = await store.listSnapshots("rollback-room");
    doc.getMap("canvas").set("a", 2);
    worker.schedule(doc);
    await worker.flush(doc);

    const closed: { code: number; reason: string }[] = [];
    const fakeSocket = {
      close: (code: number, reason: string) => closed.push({ code, reason }),
    };
    const client: RoomClient = {
      id: "peer",
      socket: fakeSocket as unknown as RoomClient["socket"],
      send: () => undefined,
    };
    room.addClient(client);
    await room.restoreSnapshot(first);
    expect(room.doc.getMap("canvas").get("a")).toBe(1);
    expect(closed.length).toBe(1);
    expect(closed[0].code).toBe(4100);
    await room.dispose();
  });
});

describe("Snapshot retention", () => {
  const now = Date.now();
  const snap = (id: string, ageMs: number): StoredSnapshot => ({
    id,
    roomId: "retention-room",
    docVersion: "v",
    data: new Uint8Array(),
    createdAt: new Date(now - ageMs),
  });

  test("keeps the newest, the newest-K, and the retention window", () => {
    const day = 86_400_000;
    const snapshots = [
      snap("ancient", 40 * day),
      snap("old", 20 * day),
      snap("mid", 10 * day),
      snap("fresh", day),
      snap("newest", 0),
    ];
    const kept = applyRetention(snapshots, now, {
      maxPerRoom: 2,
      retentionDays: 30,
    }).map((s) => s.id);
    // newest + newest-2 + everything inside 30 days (ancient drops).
    expect(kept.sort()).toEqual(["fresh", "mid", "newest", "old"]);
  });

  test("never drops the only snapshot", () => {
    const snapshots = [snap("lonely", 400 * 86_400_000)];
    expect(
      applyRetention(snapshots, now, { maxPerRoom: 1, retentionDays: 1 }),
    ).toEqual(snapshots);
    expect(
      applyRetention([], now, { maxPerRoom: 1, retentionDays: 1 }),
    ).toEqual([]);
  });

  test("memory store prunes on save", async () => {
    const day = 86_400_000;
    const store = new MemorySnapshotStore({ maxPerRoom: 3, retentionDays: 30 });
    const ages = [40 * day, 39 * day, 38 * day, day, 0];
    for (let i = 0; i < ages.length; i++)
      await store.saveSnapshot(snap(`s${i}`, ages[i]));
    const listed = await store.listSnapshots("retention-room");
    expect(listed.map((s) => s.id)).toEqual(["s4", "s3", "s2"]);
    expect(await store.getLatestSnapshot("retention-room")).toMatchObject({
      id: "s4",
    });
  });
});

describe("Room passwords", () => {
  let app: SyncServer;
  let baseUrl: string;
  let wsBase: string;
  let lockedId: string;
  let openId: string;
  let ticket: string;

  const post = (path: string, payload: unknown, auth?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(payload),
    });

  const get = (path: string, auth?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });

  function wsConnect(room: string, withTicket?: string): Promise<string> {
    return new Promise((resolve) => {
      const socket = new WebSocket(
        `${wsBase}/sync/${room}${withTicket ? `?ticket=${withTicket}` : ""}`,
      );
      socket.once("open", () => {
        socket.close();
        resolve("open");
      });
      // A non-101 upgrade response emits this instead of 'error'.
      socket.once(
        "unexpected-response",
        (_request: unknown, response: { statusCode: number }) => {
          socket.close();
          resolve(`rejected:${response.statusCode}`);
        },
      );
      socket.once("error", () => resolve("error"));
      socket.once("close", () => resolve("close"));
    });
  }

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
        roomTicketTtlSec: 86400,
        userTokenTtlSec: 604800,
      },
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsBase = `ws://127.0.0.1:${address.port}`;

    const locked = await post("/api/rooms", {
      name: "Locked",
      password: "s3cret-pass",
    });
    expect(locked.status).toBe(201);
    const lockedBody = (await locked.json()) as Record<string, unknown>;
    expect(lockedBody.hasPassword).toBe(true);
    expect(lockedBody.passwordHash).toBeUndefined();
    lockedId = lockedBody.id as string;

    const open = await post("/api/rooms", { name: "Open" });
    openId = ((await open.json()) as { id: string }).id;

    const unlock = await post(`/api/rooms/${lockedId}/unlock`, {
      password: "s3cret-pass",
    });
    expect(unlock.status).toBe(200);
    ticket = ((await unlock.json()) as { ticket: string }).ticket;
  });

  afterEach(async () => app.close());

  test("rejects short passwords at creation", async () => {
    const response = await post("/api/rooms", {
      name: "Weak",
      password: "short",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      "INVALID_PASSWORD",
    );
  });

  test("gates room metadata behind a ticket", async () => {
    expect((await get(`/api/rooms/${lockedId}`)).status).toBe(401);
    const denied = (await (
      await get(`/api/rooms/${lockedId}`)
    ).json()) as Record<string, unknown>;
    expect(denied.code).toBe("ROOM_LOCKED");

    expect((await get(`/api/rooms/${lockedId}`, ticket)).status).toBe(200);
    expect((await get(`/api/rooms/${lockedId}?ticket=${ticket}`)).status).toBe(
      200,
    );
    expect((await get(`/api/rooms/${openId}`)).status).toBe(200);
  });

  test("unlock rejects wrong passwords", async () => {
    const response = await post(`/api/rooms/${lockedId}/unlock`, {
      password: "wrong-pass",
    });
    expect(response.status).toBe(403);
    const missing = await post("/api/rooms/no-such-room/unlock", {
      password: "s3cret-pass",
    });
    expect(missing.status).toBe(404);
  });

  test("gates compile, images, and snapshots for locked rooms", async () => {
    const compile = await post("/api/compile", {
      source: "a -> b",
      roomId: lockedId,
    });
    expect(compile.status).toBe(401);

    const authedCompile = await post(
      "/api/compile",
      { source: "a -> b", roomId: lockedId },
      ticket,
    );
    expect(authedCompile.status).toBe(200);

    const images = await post(`/api/rooms/${lockedId}/images/request-upload`, {
      contentType: "image/png",
    });
    expect(images.status).toBe(401);

    const snapshots = await get(`/api/rooms/${lockedId}/snapshots`);
    expect(snapshots.status).toBe(401);
    const authedSnapshots = await get(
      `/api/rooms/${lockedId}/snapshots`,
      ticket,
    );
    expect(authedSnapshots.status).toBe(200);
  });

  test("gates the sync socket behind a ticket", async () => {
    expect(await wsConnect(lockedId)).toBe("rejected:401");
    expect(await wsConnect(lockedId, ticket)).toBe("open");
    expect(await wsConnect(openId)).toBe("open");
    expect(await wsConnect(lockedId, "forged.ticket.here")).toBe(
      "rejected:401",
    );
    expect(await wsConnect("no-such-room")).toBe("rejected:404");
  });

  test("accepts sync tickets as Bearer headers", async () => {
    const outcome: string = await new Promise((resolve) => {
      const socket = new WebSocket(`${wsBase}/sync/${lockedId}`, {
        headers: { authorization: `Bearer ${ticket}` },
      });
      socket.once("open", () => {
        socket.close();
        resolve("open");
      });
      socket.once(
        "unexpected-response",
        (_request: unknown, response: { statusCode: number }) => {
          socket.close();
          resolve(`rejected:${response.statusCode}`);
        },
      );
      socket.once("error", () => resolve("error"));
      socket.once("close", () => resolve("close"));
    });
    expect(outcome).toBe("open");
  });

  test("tickets bind room, expiry, version, and reject tampering", async () => {
    const secret = "test-secret";
    const { ticket: issued } = issueTicket(secret, "room-a", 0, 60, 1_000);
    expect(verifyTicket(secret, issued, "room-a", 1_030)).toBe(0);
    expect(verifyTicket(secret, issued, "room-b", 1_030)).toBeNull();
    expect(verifyTicket(secret, issued, "room-a", 1_061)).toBeNull();
    expect(verifyTicket(secret, `${issued}x`, "room-a", 1_030)).toBeNull();
    expect(verifyTicket("other-secret", issued, "room-a", 1_030)).toBeNull();
    expect(verifyTicket(secret, "v1.a.b.c", "room-a", 1_030)).toBeNull();
    const rotated = issueTicket(secret, "room-a", 1, 60, 1_000).ticket;
    expect(verifyTicket(secret, rotated, "room-a", 1_030)).toBe(1);
  });

  test("passwords hash with unique salts and reject malformed hashes", async () => {
    expect(isValidPassword("short")).toBe(false);
    expect(isValidPassword("long-enough")).toBe(true);
    const a = hashPassword("s3cret-pass");
    const b = hashPassword("s3cret-pass");
    expect(a).not.toBe(b);
    expect(verifyPassword("s3cret-pass", a)).toBe(true);
    expect(verifyPassword("wrong-pass", a)).toBe(false);
    expect(verifyPassword("s3cret-pass", "garbage")).toBe(false);
  });
});

describe("Room updates", () => {
  let app: SyncServer;
  let baseUrl: string;
  let openId: string;
  let userToken: string;
  let userId: string;

  const request = (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, init);

  const patch = (path: string, payload: unknown, auth?: string) =>
    request(path, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(payload),
    });

  const register = async (email: string) => {
    const response = await request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "s3cret-pass" }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      user: { id: string };
      token: string;
    };
  };

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
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
    baseUrl = `http://127.0.0.1:${address.port}`;

    const created = await request("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Before" }),
    });
    openId = ((await created.json()) as { id: string }).id;
    const me = await register("owner@example.com");
    userToken = me.token;
    userId = me.user.id;
  });

  afterEach(async () => app.close());

  test("claims anonymous rooms and patches owned rooms", async () => {
    const response = await patch(
      `/api/rooms/${openId}`,
      { name: "After" },
      userToken,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: openId,
      name: "After",
      ownerId: userId,
      tier: "COMMUNITY",
      hasPassword: false,
    });
  });

  test("requires login and ownership", async () => {
    expect((await patch(`/api/rooms/${openId}`, { name: "X" })).status).toBe(
      401,
    );
    const denied = (await (
      await patch(`/api/rooms/${openId}`, { name: "X" })
    ).json()) as Record<string, unknown>;
    expect(denied.code).toBe("AUTH_REQUIRED");

    // Claim as the owner first.
    expect(
      (await patch(`/api/rooms/${openId}`, { name: "Mine" }, userToken)).status,
    ).toBe(200);
    const stranger = await register("stranger@example.com");
    const forbidden = await patch(
      `/api/rooms/${openId}`,
      { name: "Theirs" },
      stranger.token,
    );
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as Record<string, unknown>).code).toBe(
      "FORBIDDEN",
    );
  });

  test("caps tiers at the caller's tier", async () => {
    const response = await patch(
      `/api/rooms/${openId}`,
      { tier: "ENTERPRISE" },
      userToken,
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      "TIER_UPGRADE_REQUIRED",
    );
  });

  test("sets, replaces, and clears passwords", async () => {
    const set = await patch(
      `/api/rooms/${openId}`,
      { password: "new-secret-pass" },
      userToken,
    );
    expect(set.status).toBe(200);
    expect(((await set.json()) as Record<string, unknown>).hasPassword).toBe(
      true,
    );
    // Locked without a ticket now.
    expect((await request(`/api/rooms/${openId}`)).status).toBe(401);

    const unlock = await request(`/api/rooms/${openId}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "new-secret-pass" }),
    });
    expect(unlock.status).toBe(200);
    const ticket = ((await unlock.json()) as { ticket: string }).ticket;

    const cleared = await patch(
      `/api/rooms/${openId}`,
      { password: null },
      // Room ticket alone is not enough: mutation needs the owner token.
      undefined,
    );
    expect(cleared.status).toBe(401);

    const clearedOwned = await patch(
      `/api/rooms/${openId}?ticket=${ticket}`,
      { password: null },
      userToken,
    );
    expect(clearedOwned.status).toBe(200);
    expect(
      ((await clearedOwned.json()) as Record<string, unknown>).hasPassword,
    ).toBe(false);
    expect((await request(`/api/rooms/${openId}`)).status).toBe(200);
    expect(ticket.length).toBeGreaterThan(0);
  });

  test("rotation invalidates previously minted tickets", async () => {
    await patch(`/api/rooms/${openId}`, { password: "first-secret" }, userToken);
    const first = await request(`/api/rooms/${openId}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "first-secret" }),
    });
    const firstTicket = ((await first.json()) as { ticket: string }).ticket;
    expect(
      (await request(`/api/rooms/${openId}?ticket=${firstTicket}`)).status,
    ).toBe(200);

    await patch(
      `/api/rooms/${openId}?ticket=${firstTicket}`,
      { password: "second-secret" },
      userToken,
    );
    expect(
      (await request(`/api/rooms/${openId}?ticket=${firstTicket}`)).status,
    ).toBe(401);
  });

  test("rejects empty updates, short passwords, and missing rooms", async () => {
    expect((await patch(`/api/rooms/${openId}`, {}, userToken)).status).toBe(
      400,
    );

    const weak = await patch(
      `/api/rooms/${openId}`,
      { password: "short" },
      userToken,
    );
    expect(weak.status).toBe(400);
    expect(((await weak.json()) as Record<string, unknown>).code).toBe(
      "INVALID_PASSWORD",
    );

    const missing = await patch(
      "/api/rooms/no-such-room",
      { name: "X" },
      userToken,
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as Record<string, unknown>).code).toBe(
      "ROOM_NOT_FOUND",
    );
  });

  test("refuses to mint tickets for open rooms", async () => {
    const response = await request(`/api/rooms/${openId}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Record<string, unknown>).code).toBe(
      "ROOM_NOT_LOCKED",
    );
  });

  test("deletes owned rooms and rejects strangers", async () => {
    const remove = (id: string, auth?: string) =>
      request(`/api/rooms/${id}`, {
        method: "DELETE",
        headers: auth ? { authorization: `Bearer ${auth}` } : {},
      });
    expect((await remove(openId)).status).toBe(401);
    const stranger = await register("deleter@example.com");
    // Anonymous rooms are deletable by any signed-in caller.
    expect((await remove(openId, stranger.token)).status).toBe(204);
    expect((await request(`/api/rooms/${openId}`)).status).toBe(404);

    const owned = await request("/api/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ name: "Owned" }),
    });
    const ownedId = ((await owned.json()) as { id: string }).id;
    expect((await remove(ownedId, stranger.token)).status).toBe(403);
    expect((await remove(ownedId, userToken)).status).toBe(204);
  });
});

describe("User auth", () => {
  let app: SyncServer;
  let baseUrl: string;

  const post = (path: string, payload: unknown, auth?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(payload),
    });

  const get = (path: string, auth?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });

  beforeEach(async () => {
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
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
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => app.close());

  test("registers, rejects duplicates, and gates login and me", async () => {
    const registered = await post("/api/auth/register", {
      email: "Ada@Example.com",
      password: "s3cret-pass",
      name: "Ada",
    });
    expect(registered.status).toBe(201);
    const created = (await registered.json()) as {
      user: { id: string; email: string; name: string; tier: string };
      token: string;
      expiresIn: number;
    };
    // Emails normalize; hashes never leak.
    expect(created.user.email).toBe("ada@example.com");
    expect(created.user.tier).toBe("COMMUNITY");
    expect(
      (created as unknown as Record<string, unknown>).passwordHash,
    ).toBeUndefined();
    expect(typeof created.token).toBe("string");

    const duplicate = await post("/api/auth/register", {
      email: "ada@example.com",
      password: "other-secret-pass",
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as Record<string, unknown>).code).toBe(
      "USER_EXISTS",
    );

    const weak = await post("/api/auth/register", {
      email: "new@example.com",
      password: "short",
    });
    expect(weak.status).toBe(400);

    const badLogin = await post("/api/auth/login", {
      email: "ada@example.com",
      password: "wrong-pass",
    });
    expect(badLogin.status).toBe(401);
    const unknownLogin = await post("/api/auth/login", {
      email: "nobody@example.com",
      password: "s3cret-pass",
    });
    expect(unknownLogin.status).toBe(401);
    expect(((await unknownLogin.json()) as Record<string, unknown>).code).toBe(
      "INVALID_CREDENTIALS",
    );

    const login = await post("/api/auth/login", {
      email: "ada@example.com",
      password: "s3cret-pass",
    });
    expect(login.status).toBe(200);
    const session = (await login.json()) as { token: string };
    expect(typeof session.token).toBe("string");

    const me = await get("/api/auth/me", session.token);
    expect(me.status).toBe(200);
    expect(((await me.json()) as Record<string, unknown>).id).toBe(
      created.user.id,
    );
    expect((await get("/api/auth/me")).status).toBe(401);
    expect((await get("/api/auth/me", "garbage")).status).toBe(401);
  });

  test("authenticated rooms inherit owner and tier", async () => {
    const registered = await post("/api/auth/register", {
      email: "owner@example.com",
      password: "s3cret-pass",
    });
    const { user, token } = (await registered.json()) as {
      user: { id: string };
      token: string;
    };

    const roomResponse = await post("/api/rooms", { name: "Owned" }, token);
    expect(roomResponse.status).toBe(201);
    const room = (await roomResponse.json()) as Record<string, unknown>;
    expect(room.ownerId).toBe(user.id);
    expect(room.tier).toBe("COMMUNITY");

    // Tiers above the caller's are rejected, and forged owners ignored.
    const escalate = await post(
      "/api/rooms",
      { name: "Sneaky", tier: "ENTERPRISE", ownerId: "victim" },
      token,
    );
    expect(escalate.status).toBe(403);
    expect(((await escalate.json()) as Record<string, unknown>).code).toBe(
      "TIER_UPGRADE_REQUIRED",
    );

    // Anonymous creation still defaults as before.
    const anon = await post("/api/rooms", { name: "Anon" });
    expect(((await anon.json()) as Record<string, unknown>).ownerId).toBe(
      "anonymous",
    );
  });
});

describe("Persistence safety", () => {
  let app: SyncServer;
  let store: MemorySnapshotStore;

  beforeEach(async () => {
    store = new MemorySnapshotStore();
    app = createSyncServer(
      {
        port: 0,
        host: "127.0.0.1",
        nodeEnv: "test",
        snapshotDebounceMs: 10,
        roomIdleTimeoutMs: 10,
        d2CommunityNodeLimit: 30,
        snapshotMaxPerRoom: 100,
        snapshotRetentionDays: 30,
        roomTicketTtlSec: 86400,
        userTokenTtlSec: 604800,
        r2MaxUploadBytes: 10_000_000,
        r2UrlExpiresInSec: 900,
      },
      store,
    );
  });

  afterEach(async () => app.close());

  test("rejects non-postgres DATABASE_URL instead of silently going in-memory", () => {
    expect(() =>
      createSyncServer(
        {
          port: 0,
          host: "127.0.0.1",
          nodeEnv: "test",
          databaseUrl: "file:./dev.db",
          snapshotDebounceMs: 10,
          roomIdleTimeoutMs: 10,
          d2CommunityNodeLimit: 30,
          snapshotMaxPerRoom: 100,
          snapshotRetentionDays: 30,
          roomTicketTtlSec: 86400,
          userTokenTtlSec: 604800,
          r2MaxUploadBytes: 10_000_000,
          r2UrlExpiresInSec: 900,
        },
        new MemorySnapshotStore(),
      ),
    ).toThrow(/Unsupported DATABASE_URL/);
  });

  test("corrupt snapshots throw without bricking the live room", async () => {
    const room = await app.manager.getOrCreate("corrupt-room");
    room.doc.getMap<string>("m").set("k", "v");
    await store.saveSnapshot({
      id: "bad-snapshot",
      roomId: "corrupt-room",
      docVersion: "x",
      data: new Uint8Array([1, 2, 3]),
      createdAt: new Date(),
    });
    const bad = await store.getSnapshot("bad-snapshot");
    expect(bad).not.toBeNull();
    await expect(
      room.restoreSnapshot(bad as StoredSnapshot),
    ).rejects.toThrow(/corrupt/);
    // Live state survived: doc content intact, awareness untouched (a fresh
    // Awareness always carries exactly one self-state).
    expect(room.doc.getMap<string>("m").get("k")).toBe("v");
    expect(room.awareness.getStates().size).toBe(1);
  });

  test("forceFlush drains chained saves before resolving", async () => {
    const memory = new MemorySnapshotStore();
    let saves = 0;
    let releaseGate: (() => void) | null = null;
    const original = memory.saveSnapshot.bind(memory);
    memory.saveSnapshot = async (snapshot) => {
      saves += 1;
      if (saves === 1)
        await new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
      return original(snapshot);
    };
    const worker = new SnapshotWorker("drain-room", memory, 1000);
    const doc = new Y.Doc();
    doc.getMap<string>("m").set("a", "1");
    worker.schedule(doc);
    const pending = worker.forceFlush(doc);
    // Mark dirty again while the first save is gated.
    await new Promise((resolve) => setTimeout(resolve, 10));
    doc.getMap<string>("m").set("b", "2");
    worker.schedule(doc);
    releaseGate?.();
    await pending;
    expect(saves).toBe(2);
    await worker.dispose(doc);
    doc.destroy();
  });
});

const pgUrl = process.env.DATABASE_URL;
const describePg =
  pgUrl?.startsWith("postgres") && process.env.RUN_PG_TESTS === "1"
    ? describe
    : describe.skip;

describePg("Prisma store safety", () => {
  test("re-ensure never clobbers existing room metadata", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaSnapshotStore } = await import("../src/RoomLoader.js");
    const prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
    try {
      const prismaStore = new PrismaSnapshotStore(prisma);
      const id = `pg-ensure-${Date.now()}`;
      await prismaStore.ensureRoom({
        id,
        name: "Real name",
        ownerId: "user-1",
        tier: "PRO",
        hasPassword: false,
      });
      // Cold load passes defaults — they must not overwrite.
      await prismaStore.ensureRoom({
        id,
        name: "Untitled room",
        ownerId: "anonymous",
        tier: "COMMUNITY",
        hasPassword: false,
      });
      expect(await prismaStore.getRoom(id)).toMatchObject({
        name: "Real name",
        ownerId: "user-1",
        tier: "PRO",
      });
      await prismaStore.deleteRoom(id);
    } finally {
      await prisma.$disconnect();
    }
  });
});
