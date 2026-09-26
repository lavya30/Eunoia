import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryAuditStore } from "../src/audit.js";
import { createSyncServer, type SyncServer } from "../src/index.js";
import { MemorySnapshotStore } from "../src/RoomLoader.js";
import { MemoryWorkspaceStore } from "../src/workspaces.js";

describe("MemoryAuditStore", () => {
  test("records and filters with limits", async () => {
    const store = new MemoryAuditStore();
    await store.recordEvent({ actorId: "u1", action: "room.delete" });
    await store.recordEvent({
      actorId: "u1",
      workspaceId: "w1",
      action: "workspace.member.invite",
      target: "u2",
    });
    await store.recordEvent({
      actorId: "u2",
      workspaceId: "w1",
      action: "room.delete",
    });

    expect((await store.listEvents()).length).toBe(3);
    expect(
      (await store.listEvents({ workspaceId: "w1" })).length,
    ).toBe(2);
    expect((await store.listEvents({ actorId: "u2" })).length).toBe(1);
    expect((await store.listEvents({ limit: 1 })).length).toBe(1);
    // Newest first.
    expect((await store.listEvents())[0].action).toBe("room.delete");
  });
});

describe("GET /api/audit", () => {
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
      undefined,
      undefined,
      undefined,
      undefined,
      new MemoryWorkspaceStore(),
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

  async function register(email: string) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { user: { id: string }; token: string };
  }

  function auth(token: string) {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
  }

  test("requires auth and a scope", async () => {
    const anon = await fetch(`${baseUrl}/api/audit?mine=1`);
    expect(anon.status).toBe(401);

    const { token } = await register("audit-scope@test.com");
    const unscoped = await fetch(`${baseUrl}/api/audit`, {
      headers: auth(token),
    });
    expect(unscoped.status).toBe(400);
  });

  test("workspace audit is ADMIN-gated and records invites", async () => {
    const owner = await register("audit-owner@test.com");
    const member = await register("audit-member@test.com");

    const wsRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: "Audited" }),
    });
    const { workspace } = (await wsRes.json()) as { workspace: { id: string } };

    // Non-member cannot read workspace audit.
    const forbidden = await fetch(
      `${baseUrl}/api/audit?workspaceId=${workspace.id}`,
      { headers: auth(member.token) },
    );
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { code: string }).code).toBe(
      "FORBIDDEN",
    );
  });

  test("mine=1 returns the caller's own actions", async () => {
    const owner = await register("audit-mine@test.com");
    const wsRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(wsRes.status).toBe(201);

    const roomRes = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: "Doomed" }),
    });
    const room = (await roomRes.json()) as { id: string };
    const deleted = await fetch(`${baseUrl}/api/rooms/${room.id}`, {
      method: "DELETE",
      headers: auth(owner.token),
    });
    expect(deleted.status).toBe(204);

    const mine = await fetch(`${baseUrl}/api/audit?mine=1`, {
      headers: auth(owner.token),
    });
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as {
      events: Array<{ action: string; target: string | null }>;
    };
    expect(
      body.events.some(
        (event) =>
          event.action === "room.delete" && event.target === room.id,
      ),
    ).toBe(true);
  });
});
