import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSyncServer, type SyncServer } from "../src/index.js";
import { MemorySnapshotStore } from "../src/RoomLoader.js";
import {
  issuePasswordResetToken,
  issueUserToken,
  verifyPasswordResetToken,
  verifyUserToken,
} from "../src/user-auth.js";

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
    expect(
      verifyUserToken("other-secret-32-chars-long-!!!!", token),
    ).toBeNull();
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

  test("password reset round-trips: forgot → reset → login", async () => {
    await register("reset@test.com");
    const forgot = await fetch(`${baseUrl}/api/auth/forgot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reset@test.com" }),
    });
    expect(forgot.status).toBe(200);
    const forgotBody = (await forgot.json()) as { resetToken?: string };
    // Non-production returns the token inline (no mailer configured).
    expect(typeof forgotBody.resetToken).toBe("string");
    const reset = await fetch(`${baseUrl}/api/auth/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: forgotBody.resetToken,
        password: "newpassword123",
      }),
    });
    expect(reset.status).toBe(200);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "reset@test.com",
        password: "newpassword123",
      }),
    });
    expect(login.status).toBe(200);
    const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "reset@test.com",
        password: "password123",
      }),
    });
    expect(oldLogin.status).toBe(401);
  });

  test("forgot never enumerates accounts", async () => {
    const res = await fetch(`${baseUrl}/api/auth/forgot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@test.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resetToken).toBeUndefined();
    expect(body.message).toBeDefined();
  });

  test("reset rejects forged tokens and PATCH /me updates the name", async () => {
    const { token } = await register("profile@test.com");
    const bad = await fetch(`${baseUrl}/api/auth/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "pw1.evil.9999999999.evil",
        password: "newpassword123",
      }),
    });
    expect(bad.status).toBe(401);
    const patched = await fetch(`${baseUrl}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: "Ada" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe("Ada");
    const anon = await fetch(`${baseUrl}/api/auth/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Eve" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("password reset tokens", () => {
  test("round-trips and rejects cross-domain tokens", () => {
    const { token } = issuePasswordResetToken(SECRET, "Ada@Test.com");
    expect(verifyPasswordResetToken(SECRET, token)).toBe("ada@test.com");
    // Session tokens must never validate as reset tokens.
    const session = issueUserToken(SECRET, "user-1", 3600);
    expect(verifyPasswordResetToken(SECRET, session.token)).toBeNull();
    expect(
      verifyPasswordResetToken("other-secret-32-chars-long-!!!!", token),
    ).toBeNull();
  });
});
