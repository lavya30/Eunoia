import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  MemoryBillingStore,
  MemoryBillingEventStore,
} from "../src/billing-store.js";
import {
  RazorpayBillingProvider,
  handleBillingWebhook,
  signWebhookBody,
  type BillingDeps,
  type RazorpayClient,
} from "../src/billing.js";
import { MemoryUserStore } from "../src/users.js";
import { MemorySnapshotStore } from "../src/RoomLoader.js";
import { createSyncServer, type SyncServer } from "../src/index.js";
import { loadConfig } from "../src/config.js";

const WEBHOOK_SECRET = "whsec_test";
const PLAN_PRO = "plan_test_pro";

function testConfig() {
  return loadConfig({
    RAZORPAY_KEY_ID: "rzp_test_x",
    RAZORPAY_KEY_SECRET: "test-key-secret",
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_PLAN_PRO: PLAN_PRO,
    BILLING_SUCCESS_URL: "http://localhost:3000/billing?success=true",
    BILLING_CANCEL_URL: "http://localhost:3000/pricing",
  });
}

type FakeCalls = {
  customers: unknown[];
  subscriptions: unknown[];
  cancels: Array<{ id: string; atEnd?: boolean }>;
};

function fakeRazorpay(): { calls: FakeCalls; client: RazorpayClient } {
  const calls: FakeCalls = { customers: [], subscriptions: [], cancels: [] };
  return {
    calls,
    client: {
      customers: {
        create: async (params: Record<string, unknown>) => {
          calls.customers.push(params);
          return { id: "cus_test_1" };
        },
      },
      subscriptions: {
        create: async (params: Record<string, unknown>) => {
          calls.subscriptions.push(params);
          return { id: "sub_test_1", short_url: "https://rzp.io/i/test123" };
        },
        cancel: async (id: string, atEnd?: boolean) => {
          calls.cancels.push({ id, atEnd });
          return { status: "cancelled" };
        },
      },
    },
  };
}

let envelopeCounter = 0;

function razorpayEnvelope(
  event: string,
  entity: Record<string, unknown>,
  createdAt?: number,
): { body: Buffer; signature: string } {
  envelopeCounter += 1;
  const payload = {
    account_id: "acc_test",
    event,
    contains: ["subscription"],
    payload: { subscription: { entity } },
    created_at: createdAt ?? 1700000000 + envelopeCounter,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return { body, signature: signWebhookBody(body, WEBHOOK_SECRET) };
}

function subscriptionEntity(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sub_test_1",
    customer_id: "cus_test_1",
    plan_id: PLAN_PRO,
    status: "active",
    quantity: 2,
    notes: {},
    current_end: 1800000000,
    ...overrides,
  };
}

describe("Billing Unit & Integration Tests", () => {
  describe("MemoryBillingStore & MemoryBillingEventStore", () => {
    test("creates and retrieves subscriptions by userId", async () => {
      const store = new MemoryBillingStore();
      const existing = await store.findByUserId("user_1");
      expect(existing).toBeNull();

      const created = await store.upsertByUserId({
        userId: "user_1",
        provider: "razorpay",
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
      const first = await eventStore.recordEvent(
        "evt_1",
        "subscription.activated",
      );
      expect(first).toBe(true);

      const duplicate = await eventStore.recordEvent(
        "evt_1",
        "subscription.activated",
      );
      expect(duplicate).toBe(false);
    });
  });

  describe("RazorpayBillingProvider", () => {
    test("returns Pro plans", () => {
      const { client } = fakeRazorpay();
      const provider = new RazorpayBillingProvider(testConfig(), client);
      const plans = provider.plans();
      expect(plans).toHaveLength(1);
      expect(plans[0].key).toBe("pro");
      expect(plans[0].pricePerSeat).toBe(1200);
    });

    test("creates checkout sessions via subscription links", async () => {
      const { calls, client } = fakeRazorpay();
      const provider = new RazorpayBillingProvider(testConfig(), client);
      const checkout = await provider.createCheckoutSession("usr_1", "pro", 3, {
        email: "usr@example.com",
      });
      expect(checkout.url).toContain("https://rzp.io/i/");
      expect(checkout.sessionId).toBe("sub_test_1");
      expect(calls.customers).toHaveLength(1);
      const subParams = calls.subscriptions[0] as Record<string, unknown>;
      expect(subParams.plan_id).toBe(PLAN_PRO);
      expect(subParams.quantity).toBe(3);
      expect(subParams.customer_notify).toBe(1);
    });

    test("rejects unknown prices before touching the API", async () => {
      const { client } = fakeRazorpay();
      const provider = new RazorpayBillingProvider(testConfig(), client);
      let error: unknown = null;
      try {
        await provider.createCheckoutSession("usr_1", "enterprise", 1);
      } catch (err) {
        error = err;
      }
      expect(error instanceof Error).toBe(true);
    });

    test("cancels at cycle end", async () => {
      const { calls, client } = fakeRazorpay();
      const provider = new RazorpayBillingProvider(testConfig(), client);
      const result = await provider.cancelSubscription("sub_9");
      expect(result.status).toBe("cancelled");
      expect(calls.cancels).toHaveLength(1);
      expect(calls.cancels[0]).toMatchObject({ id: "sub_9", atEnd: true });
    });

    test("verifies webhook signatures", () => {
      const { client } = fakeRazorpay();
      const provider = new RazorpayBillingProvider(testConfig(), client);
      const raw = Buffer.from(JSON.stringify({ event: "x" }), "utf8");
      const signature = createHmac("sha256", WEBHOOK_SECRET)
        .update(raw)
        .digest("hex");
      expect(provider.verifyWebhook(raw, signature)).toBe(true);
      expect(provider.verifyWebhook(raw, "wrong-signature")).toBe(false);
    });

    test("maps Razorpay envelopes to billing events", () => {
      const { client } = fakeRazorpay();
      const provider = new RazorpayBillingProvider(testConfig(), client);
      const { body } = razorpayEnvelope(
        "subscription.charged",
        subscriptionEntity({ notes: { userId: "user_7" }, quantity: 4 }),
        1700000042,
      );
      const event = provider.parseEvent(body);
      expect(event.type).toBe("subscription.charged");
      expect(event.eventId).toBe(
        "subscription.charged:sub_test_1:1700000042",
      );
      expect(event.userId).toBe("user_7");
      expect(event.customerId).toBe("cus_test_1");
      expect(event.subscriptionId).toBe("sub_test_1");
      expect(event.priceKey).toBe("pro");
      expect(event.seats).toBe(4);
      expect(event.status).toBe("active");
      expect(event.periodEnd?.getTime()).toBe(1800000000 * 1000);
    });
  });

  describe("handleBillingWebhook", () => {
    let userStore: MemoryUserStore;
    let subscriptionStore: MemoryBillingStore;
    let billingEventStore: MemoryBillingEventStore;
    let provider: RazorpayBillingProvider;
    let deps: BillingDeps;

    beforeEach(async () => {
      userStore = new MemoryUserStore();
      subscriptionStore = new MemoryBillingStore();
      billingEventStore = new MemoryBillingEventStore();
      provider = new RazorpayBillingProvider(
        testConfig(),
        fakeRazorpay().client,
      );
      deps = {
        provider,
        subscriptionStore,
        billingEventStore,
        userStore,
      };
    });

    test("upgrades on subscription.activated", async () => {
      const user = await userStore.createUser({
        email: "alice@example.com",
        passwordHash: "hash",
      });
      expect(user?.tier).toBe("COMMUNITY");

      const { body, signature } = razorpayEnvelope(
        "subscription.activated",
        subscriptionEntity({ notes: { userId: user!.id }, quantity: 3 }),
      );
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("upgraded");

      expect((await userStore.findById(user!.id))?.tier).toBe("PRO");
      const sub = await subscriptionStore.findByUserId(user!.id);
      expect(sub?.status).toBe("active");
      expect(sub?.seats).toBe(3);
      expect(sub?.provider).toBe("razorpay");
      expect(sub?.providerSubId).toBe("sub_test_1");
    });

    test("resolves users via stored customer mapping", async () => {
      const user = await userStore.createUser({
        email: "mapped@example.com",
        passwordHash: "hash",
      });
      await subscriptionStore.upsertByUserId({
        userId: user!.id,
        provider: "razorpay",
        customerId: "cus_mapped",
        status: "pending",
        priceKey: "pro",
        seats: 1,
      });

      // No notes.userId — the customer mapping must resolve the user.
      const { body, signature } = razorpayEnvelope(
        "subscription.charged",
        subscriptionEntity({ customer_id: "cus_mapped", notes: {} }),
      );
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("upgraded");
      expect((await userStore.findById(user!.id))?.tier).toBe("PRO");
    });

    test("downgrades on subscription.cancelled", async () => {
      const user = await userStore.createUser({
        email: "bob@example.com",
        passwordHash: "hash",
      });
      await userStore.updateTier(user!.id, "PRO");

      const { body, signature } = razorpayEnvelope(
        "subscription.cancelled",
        subscriptionEntity({
          notes: { userId: user!.id },
          status: "cancelled",
        }),
      );
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("downgraded");
      expect((await userStore.findById(user!.id))?.tier).toBe("COMMUNITY");
    });

    test("downgrades on subscription.completed", async () => {
      const user = await userStore.createUser({
        email: "carol@example.com",
        passwordHash: "hash",
      });
      await userStore.updateTier(user!.id, "PRO");

      const { body, signature } = razorpayEnvelope(
        "subscription.completed",
        subscriptionEntity({
          notes: { userId: user!.id },
          status: "completed",
        }),
      );
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("downgraded");
    });

    test("halted subscriptions are skipped, never downgraded", async () => {
      const user = await userStore.createUser({
        email: "dave@example.com",
        passwordHash: "hash",
      });
      await userStore.updateTier(user!.id, "PRO");

      const { body, signature } = razorpayEnvelope(
        "subscription.halted",
        subscriptionEntity({ notes: { userId: user!.id }, status: "halted" }),
      );
      const result = await handleBillingWebhook(body, signature, deps);

      expect(result.status).toBe(200);
      expect(result.body.skipped).toBe("subscription.halted");
      expect((await userStore.findById(user!.id))?.tier).toBe("PRO");
    });

    test("rejects webhooks with an invalid signature", async () => {
      const user = await userStore.createUser({
        email: "mallory@example.com",
        passwordHash: "hash",
      });
      const { body } = razorpayEnvelope(
        "subscription.activated",
        subscriptionEntity({ notes: { userId: user!.id } }),
      );
      const result = await handleBillingWebhook(body, "wrong-signature", deps);

      expect(result.status).toBe(401);
      expect(result.body.code).toBe("INVALID_SIGNATURE");
      expect((await userStore.findById(user!.id))?.tier).toBe("COMMUNITY");
    });

    test("rejects malformed webhook payloads", async () => {
      const raw = Buffer.from("not-json{{{", "utf8");
      const signature = createHmac("sha256", WEBHOOK_SECRET)
        .update(raw)
        .digest("hex");
      const result = await handleBillingWebhook(raw, signature, deps);

      expect(result.status).toBe(400);
      expect(result.body.code).toBe("PARSE_ERROR");
    });

    test("envelopes without an entity are skipped", async () => {
      const raw = Buffer.from(
        JSON.stringify({ event: "subscription.activated", payload: {} }),
        "utf8",
      );
      const result = await handleBillingWebhook(
        raw,
        signWebhookBody(raw, WEBHOOK_SECRET),
        deps,
      );

      expect(result.status).toBe(200);
      expect(result.body.skipped).toBe("no eventId");
    });

    test("replays of the same event are idempotent", async () => {
      const user = await userStore.createUser({
        email: "erin@example.com",
        passwordHash: "hash",
      });
      const { body, signature } = razorpayEnvelope(
        "subscription.activated",
        subscriptionEntity({ notes: { userId: user!.id } }),
        1700000099,
      );

      const first = await handleBillingWebhook(body, signature, deps);
      expect(first.status).toBe(200);
      expect(first.body.action).toBe("upgraded");

      const replay = await handleBillingWebhook(body, signature, deps);
      expect(replay.status).toBe(200);
      expect(replay.body.duplicate).toBe(true);
    });
  });

  describe("HTTP API Endpoints", () => {
    let app: SyncServer;
    let baseUrl: string;
    let fake: { calls: FakeCalls; client: RazorpayClient };

    beforeEach(async () => {
      fake = fakeRazorpay();
      const config = testConfig();
      app = createSyncServer(
        config,
        new MemorySnapshotStore(),
        undefined,
        undefined,
        undefined,
        {
          provider: new RazorpayBillingProvider(config, fake.client),
        },
      );
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

    async function register(email: string) {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as { user: { id: string }; token: string };
    }

    test("GET /api/billing/prices returns available plans", async () => {
      const res = await fetch(`${baseUrl}/api/billing/prices`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { prices: Array<{ key: string }> };
      expect(json.prices).toHaveLength(1);
      expect(json.prices[0].key).toBe("pro");
    });

    test("POST /api/billing/checkout requires auth and returns session URL", async () => {
      const { token } = await register("user@test.com");

      const unauth = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceKey: "pro", seats: 2 }),
      });
      expect(unauth.status).toBe(401);

      const auth = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceKey: "pro", seats: 2 }),
      });
      expect(auth.status).toBe(200);
      const authJson = (await auth.json()) as {
        url: string;
        sessionId: string;
      };
      expect(authJson.url).toContain("https://rzp.io/i/");
      expect(authJson.sessionId).toBe("sub_test_1");
      const subParams = fake.calls.subscriptions[0] as Record<string, unknown>;
      expect(subParams.quantity).toBe(2);
      expect(subParams.customer_notify).toBe(1);
    });

    test("POST /api/billing/checkout rejects unknown prices", async () => {
      const { token } = await register("badprice@test.com");
      const res = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceKey: "enterprise", seats: 1 }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe(
        "INVALID_PRICE",
      );
    });

    test("POST /api/billing/checkout rejects invalid input", async () => {
      const { token } = await register("badinput@test.com");
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      };

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

    test("POST /api/billing/webhook raw body updates tier live", async () => {
      const { user, token } = await register("live@test.com");

      const { body, signature } = razorpayEnvelope(
        "subscription.activated",
        subscriptionEntity({ notes: { userId: user.id }, quantity: 5 }),
      );
      const webhookRes = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
        },
        body,
      });

      expect(webhookRes.status).toBe(200);

      const subRes = await fetch(`${baseUrl}/api/billing/subscription`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(subRes.status).toBe(200);
      const subJson = (await subRes.json()) as {
        userTier: string;
        subscription: { seats: number; customerId: string };
      };
      expect(subJson.userTier).toBe("PRO");
      expect(subJson.subscription.seats).toBe(5);
      expect(subJson.subscription.customerId).toBe("cus_test_1");
    });

    test("POST /api/billing/webhook rejects bad signatures", async () => {
      const { body } = razorpayEnvelope(
        "subscription.activated",
        subscriptionEntity(),
      );
      const res = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "bad",
        },
        body,
      });
      expect(res.status).toBe(401);
    });

    test("POST /api/billing/cancel requires auth and a subscription", async () => {
      const unauth = await fetch(`${baseUrl}/api/billing/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(unauth.status).toBe(401);

      const { user, token } = await register("nosub@test.com");
      void user;
      const empty = await fetch(`${baseUrl}/api/billing/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      expect(empty.status).toBe(400);
      expect(((await empty.json()) as { code: string }).code).toBe(
        "NO_SUBSCRIPTION",
      );

      const { body, signature } = razorpayEnvelope(
        "subscription.activated",
        subscriptionEntity({ notes: { userId: user.id } }),
      );
      const webhookRes = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
        },
        body,
      });
      expect(webhookRes.status).toBe(200);

      const cancel = await fetch(`${baseUrl}/api/billing/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      expect(cancel.status).toBe(200);
      expect(((await cancel.json()) as { status: string }).status).toBe(
        "cancelled",
      );
      expect(fake.calls.cancels).toHaveLength(1);
      expect(fake.calls.cancels[0]).toMatchObject({
        id: "sub_test_1",
        atEnd: true,
      });
    });

    test("billing endpoints 503 without provider keys", async () => {
      const keyless = loadConfig({
        NODE_ENV: "test",
        ROOM_TICKET_SECRET: "test-secret-32-chars-long-secret!!",
      });
      const bare = createSyncServer(keyless, new MemorySnapshotStore());
      await new Promise<void>((resolve) => {
        bare.server.listen(0, "127.0.0.1", () => resolve());
      });
      try {
        const addr = bare.server.address();
        if (!addr || typeof addr === "string")
          throw new Error("Server address failed");
        const base = `http://127.0.0.1:${addr.port}`;
        for (const [method, path] of [
          ["GET", "/api/billing/prices"],
          ["POST", "/api/billing/checkout"],
          ["POST", "/api/billing/cancel"],
          ["GET", "/api/billing/subscription"],
        ] as const) {
          const res = await fetch(`${base}${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: method === "POST" ? JSON.stringify({}) : undefined,
          });
          expect(res.status).toBe(503);
          expect(((await res.json()) as { code: string }).code).toBe(
            "BILLING_NOT_CONFIGURED",
          );
        }
      } finally {
        await bare.close();
      }
    });
  });
});
