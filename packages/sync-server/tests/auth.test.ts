import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSyncServer, type SyncServer } from "../src/index.js";
import { MemorySnapshotStore } from "../src/RoomLoader.js";
import { issueUserToken, verifyUserToken } from "../src/user-auth.js";

const SECRET = "test-secret-32-chars-long-secret!!";

describe("user tokens", () => {
  test("round-trips a valid token", () => {
    const { token } = issueUserToken(SECRET, "user-1", 3600);
    expect(verifyUserToken(SECRET, token)).toBe("user-1");
  });

  test("rejects tokens with trailing segments", () => {
    const { token } = issueUserToken(SECRET, "user-1", 3600);
    // Room tickets require exactly 5 parts; user tokens exactly 4.
    // Appended garbage must never validate even with a valid prefix.
    expect(verifyUserToken(SECRET, `${token}.evil`)).toBeNull();
    expect(verifyUserToken(SECRET, `${token}.a.b.c`)).toBeNull();
  });

  test("rejects wrong-secret and expired tokens", () => {
    const { token } = issueUserToken(SECRET, "user-1", 3600);
    expect(verifyUserToken("other-secret-32-chars-long-!!!!", token)).toBeNull();
    const expired = issueUserToken(SECRET, "user-1", -10);
    expect(verifyUserToken(SECRET, expired.token)).toBeNull();
  });
});

describe("room ownership authorization", () => {
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

  async function register(email: string) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { user: { id: string }; token: string };
  }

  test("anonymous creation cannot claim an arbitrary ownerId", async () => {
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sneaky", ownerId: "victim" }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { ownerId: string }).ownerId).toBe(
      "anonymous",
    );
  });

  test("owner transfer to an unknown user is rejected", async () => {
    const { token } = await register("owner@test.com");
    const roomRes = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: "Mine" }),
    });
    const room = (await roomRes.json()) as { id: string };
    const patch = await fetch(`${baseUrl}/api/rooms/${room.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ownerId: "ghost-user" }),
    });
    expect(patch.status).toBe(400);
    expect(((await patch.json()) as { code: string }).code).toBe(
      "INVALID_OWNER",
    );
  });

  test("unlock of a missing room carries ROOM_NOT_FOUND", async () => {
    const res = await fetch(`${baseUrl}/api/rooms/nope/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "whatever123" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe(
      "ROOM_NOT_FOUND",
    );
  });
});
