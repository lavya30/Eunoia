import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  MemoryBillingStore,
  MemoryBillingEventStore,
} from "../src/billing-store.js";
import {
  StubBillingProvider,
  handleBillingWebhook,
  signStubWebhook,
  type BillingDeps,
} from "../src/billing.js";
import { MemoryUserStore } from "../src/users.js";
import { createSyncServer, type SyncServer } from "../src/index.js";
import { loadConfig } from "../src/config.js";

describe("Billing Unit & Integration Tests", () => {
  describe("MemoryBillingStore & MemoryBillingEventStore", () => {
    test("creates and retrieves subscriptions by userId", async () => {
      const store = new MemoryBillingStore();
      const existing = await store.findByUserId("user_1");
      expect(existing).toBeNull();

      const created = await store.upsertByUserId({
        userId: "user_1",
        provider: "stub",
        customerId: "cus_123",
        providerSubId: "sub_123",
        status: "active",
        priceKey: "pro",
        seats: 2,
      });

      expect(created.userId).toBe("user_1");
      expect(created.seats).toBe(2);
      expect(created.status).toBe("active");

      const fetched = await store.findByUserId("user_1");
      expect(fetched).not.toBeNull();
      expect(fetched?.customerId).toBe("cus_123");
    });

    test("enforces event idempotency", async () => {
      const eventStore = new MemoryBillingEventStore();
      const first = await eventStore.recordEvent("evt_1", "checkout.completed");
      expect(first).toBe(true);

      const duplicate = await eventStore.recordEvent(
        "evt_1",
        "checkout.completed",
      );
      expect(duplicate).toBe(false);
    });
  });

  describe("StubBillingProvider", () => {
    const config = loadConfig({
      STRIPE_WEBHOOK_SECRET: "test-secret",
      BILLING_SUCCESS_URL: "http://localhost:3000/billing?checkout=success",
      BILLING_CANCEL_URL: "http://localhost:3000/pricing",
    });
    const provider = new StubBillingProvider(config);

    test("returns Pro plans", () => {
      const plans = provider.plans();
      expect(plans).toHaveLength(1);
      expect(plans[0].key).toBe("pro");
      expect(plans[0].pricePerSeat).toBe(1200);
    });

    test("creates checkout and portal sessions", async () => {
      const checkout = await provider.createCheckoutSession("usr_1", "pro", 3);
      expect(checkout.url).toContain("checkout=success");
      expect(checkout.sessionId).toBeDefined();

      const portal = await provider.createPortalSession("cus_1");
      expect(portal.url).toContain("customer=cus_1");
    });

    test("verifies webhook signature correctly", () => {
      const payload = { eventId: "evt_test", type: "checkout.completed" };
      const { body, signature } = signStubWebhook(payload, "test-secret");
      expect(provider.verifyWebhook(body, signature)).toBe(true);
      expect(provider.verifyWebhook(body, "wrong-signature")).toBe(false);
    });
  });

  describe("handleBillingWebhook", () => {
    let userStore: MemoryUserStore;
    let subscriptionStore: MemoryBillingStore;
    let billingEventStore: MemoryBillingEventStore;
    let provider: StubBillingProvider;
    let deps: BillingDeps;

    beforeEach(async () => {
      userStore = new MemoryUserStore();
      subscriptionStore = new MemoryBillingStore();
      billingEventStore = new MemoryBillingEventStore();
      const config = loadConfig({ STRIPE_WEBHOOK_SECRET: "whsec_test" });
      provider = new StubBillingProvider(config);
      deps = {
        provider,
        subscriptionStore,
        billingEventStore,
        userStore,
      };
    });

    test("upgrades user tier on checkout.completed", async () => {
      const user = await userStore.createUser({
        email: "alice@example.com",
        passwordHash: "hash",
      });
      expect(user).not.toBeNull();
      expect(user?.tier).toBe("COMMUNITY");

      const payload = {
        eventId: "evt_chk_1",
        type: "checkout.completed",
        userId: user!.id,
        customerId: "cus_alice",
        subscriptionId: "sub_alice",
        seats: 3,
        status: "active",
      };

      const { body, signature } = signStubWebhook(payload, "whsec_test");
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("upgraded");

      const updatedUser = await userStore.findById(user!.id);
      expect(updatedUser?.tier).toBe("PRO");

      const sub = await subscriptionStore.findByUserId(user!.id);
      expect(sub?.status).toBe("active");
      expect(sub?.seats).toBe(3);
    });

    test("downgrades user tier on subscription.deleted", async () => {
      const user = await userStore.createUser({
        email: "bob@example.com",
        passwordHash: "hash",
      });
      await userStore.updateTier(user!.id, "PRO");

      const payload = {
        eventId: "evt_del_1",
        type: "subscription.deleted",
        userId: user!.id,
        status: "canceled",
      };

      const { body, signature } = signStubWebhook(payload, "whsec_test");
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("downgraded");

      const updatedUser = await userStore.findById(user!.id);
      expect(updatedUser?.tier).toBe("COMMUNITY");
    });

    test("rejects webhooks with an invalid signature", async () => {
      const user = await userStore.createUser({
        email: "mallory@example.com",
        passwordHash: "hash",
      });
      const payload = {
        eventId: "evt_bad_sig",
        type: "checkout.completed",
        userId: user!.id,
        status: "active",
      };
      const { body } = signStubWebhook(payload, "whsec_test");
      const result = await handleBillingWebhook(body, "wrong-signature", deps);

      expect(result.status).toBe(401);
      expect(result.body.code).toBe("INVALID_SIGNATURE");

      const untouched = await userStore.findById(user!.id);
      expect(untouched?.tier).toBe("COMMUNITY");
    });

    test("rejects malformed webhook payloads", async () => {
      // Sign the actual raw bytes so verification passes and parsing fails.
      const raw = new TextEncoder().encode("not-json{{{");
      const { createHmac } = await import("node:crypto");
      const validSig = createHmac("sha256", "whsec_test")
        .update(raw)
        .digest("hex");
      const result = await handleBillingWebhook(raw, validSig, deps);

      expect(result.status).toBe(400);
      expect(result.body.code).toBe("PARSE_ERROR");
    });

    test("subscription.updated without a status never mints PRO", async () => {
      const user = await userStore.createUser({
        email: "dave@example.com",
        passwordHash: "hash",
      });
      const payload = {
        eventId: "evt_nostatus_1",
        type: "subscription.updated",
        userId: user!.id,
        customerId: "cus_dave",
      };
      const { body, signature } = signStubWebhook(payload, "whsec_test");
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.skipped).toBe("no status");

      const untouched = await userStore.findById(user!.id);
      expect(untouched?.tier).toBe("COMMUNITY");
      expect(await subscriptionStore.findByUserId(user!.id)).toBeNull();
    });

    test("replays of the same event are idempotent", async () => {
      const user = await userStore.createUser({
        email: "carol@example.com",
        passwordHash: "hash",
      });
      const payload = {
        eventId: "evt_replay_1",
        type: "checkout.completed",
        userId: user!.id,
        customerId: "cus_carol",
        subscriptionId: "sub_carol",
        seats: 2,
        status: "active",
      };
      const { body, signature } = signStubWebhook(payload, "whsec_test");

      const first = await handleBillingWebhook(body, signature, deps);
      expect(first.status).toBe(200);
      expect(first.body.action).toBe("upgraded");

      const replay = await handleBillingWebhook(body, signature, deps);
      expect(replay.status).toBe(200);
      expect(replay.body.duplicate).toBe(true);

      const updatedUser = await userStore.findById(user!.id);
      expect(updatedUser?.tier).toBe("PRO");
    });
  });

  describe("HTTP API Endpoints", () => {
    let app: SyncServer;
    let baseUrl: string;

    beforeEach(async () => {
      const config = loadConfig({
        PORT: "3099",
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        SNAPSHOT_DEBOUNCE_MS: "10",
        ROOM_IDLE_TIMEOUT_MS: "10",
        ROOM_TICKET_SECRET: "test-secret-32-chars-long-secret!!",
        STRIPE_WEBHOOK_SECRET: "whsec_api_test",
      });
      app = createSyncServer(config);
      await new Promise<void>((resolve) => {
        app.server.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = app.server.address();
      if (!addr || typeof addr === "string")
        throw new Error("Server address failed");
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      await app.close();
    });

    test("GET /api/billing/prices returns available plans", async () => {
      const res = await fetch(`${baseUrl}/api/billing/prices`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { prices: Array<{ key: string }> };
      expect(json.prices).toHaveLength(1);
      expect(json.prices[0].key).toBe("pro");
    });

    test("POST /api/billing/checkout requires auth and returns session URL", async () => {
      // 1. Register a test user
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@test.com",
          password: "password123",
        }),
      });
      expect(regRes.status).toBe(201);
      const regJson = (await regRes.json()) as { token: string };

      // 2. Unauthenticated checkout fails
      const unauth = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceKey: "pro", seats: 2 }),
      });
      expect(unauth.status).toBe(401);

      // 3. Authenticated checkout succeeds
      const auth = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${regJson.token}`,
        },
        body: JSON.stringify({ priceKey: "pro", seats: 2 }),
      });
      expect(auth.status).toBe(200);
      const authJson = (await auth.json()) as {
        url: string;
        sessionId: string;
      };
      expect(authJson.url).toBeDefined();
      expect(authJson.sessionId).toBeDefined();
    });

    test("POST /api/billing/webhook raw body updates tier live", async () => {
      // 1. Register user
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "live@test.com",
          password: "password123",
        }),
      });
      const regJson = (await regRes.json()) as {
        user: { id: string };
        token: string;
      };

      // 2. Webhook payload
      const payload = {
        eventId: "evt_live_1",
        type: "checkout.completed",
        userId: regJson.user.id,
        customerId: "cus_live",
        subscriptionId: "sub_live",
        seats: 5,
        status: "active",
      };
      const { body, signature } = signStubWebhook(payload, "whsec_api_test");

      const webhookRes = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-billing-signature": signature,
        },
        body,
      });

      expect(webhookRes.status).toBe(200);

      // 3. Check subscription endpoint
      const subRes = await fetch(`${baseUrl}/api/billing/subscription`, {
        method: "GET",
        headers: { authorization: `Bearer ${regJson.token}` },
      });
      expect(subRes.status).toBe(200);
      const subJson = (await subRes.json()) as {
        userTier: string;
        subscription: { seats: number; customerId: string };
      };
      expect(subJson.userTier).toBe("PRO");
      expect(subJson.subscription.seats).toBe(5);
      expect(subJson.subscription.customerId).toBe("cus_live");
    });

    test("POST /api/billing/portal requires auth and a subscription", async () => {
      // 1. Unauthenticated portal access fails
      const unauth = await fetch(`${baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(unauth.status).toBe(401);

      // 2. Fresh user without a subscription gets NO_SUBSCRIPTION
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "nosub@test.com",
          password: "password123",
        }),
      });
      const regJson = (await regRes.json()) as {
        user: { id: string };
        token: string;
      };
      const empty = await fetch(`${baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${regJson.token}`,
        },
        body: JSON.stringify({}),
      });
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as { code: string }).code).toBe(
        "NO_SUBSCRIPTION",
      );

      // 3. After a webhook upgrade, the portal URL is issued
      const payload = {
        eventId: "evt_portal_1",
        type: "checkout.completed",
        userId: regJson.user.id,
        customerId: "cus_portal",
        subscriptionId: "sub_portal",
        seats: 1,
        status: "active",
      };
      const { body, signature } = signStubWebhook(payload, "whsec_api_test");
      const webhookRes = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-billing-signature": signature,
        },
        body,
      });
      expect(webhookRes.status).toBe(200);

      const portal = await fetch(`${baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${regJson.token}`,
        },
        body: JSON.stringify({}),
      });
      expect(portal.status).toBe(200);
      const portalJson = (await portal.json()) as { url: string };
      expect(portalJson.url).toContain("cus_portal");
    });

    test("POST /api/billing/checkout rejects unknown prices", async () => {
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "badprice@test.com", password: "password123" }),
      });
      const regJson = (await regRes.json()) as { token: string };
      const res = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${regJson.token}`,
        },
        body: JSON.stringify({ priceKey: "enterprise", seats: 1 }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe(
        "INVALID_PRICE",
      );
    });

    test("POST /api/billing/checkout rejects invalid input", async () => {
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "badinput@test.com",
          password: "password123",
        }),
      });
      const regJson = (await regRes.json()) as { token: string };
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${regJson.token}`,
      };

      // Empty priceKey and zero seats both fail strict validation
      const badPrice = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ priceKey: "", seats: 1 }),
      });
      expect(badPrice.status).toBe(400);

      const badSeats = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ priceKey: "pro", seats: 0 }),
      });
      expect(badSeats.status).toBe(400);
    });
  });
});
