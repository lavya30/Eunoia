import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type {
  BillingEventStore,
  SubscriptionStore,
  UpsertSubscription,
} from "./billing-store.js";
import type { UserStore } from "./users.js";
import type { Tier } from "./d2-compiler.js";

/* ── Types ───────────────────────────────────────────────────── */

export type PlanInfo = {
  key: string;
  name: string;
  pricePerSeat: number;
  currency: string;
};

export type CheckoutResult = {
  url: string;
  sessionId: string;
};

export type PortalResult = {
  url: string;
};

export type BillingEvent = {
  eventId: string;
  type: string;
  customerId?: string;
  subscriptionId?: string;
  userId?: string;
  priceKey?: string;
  seats?: number;
  status?: string;
  periodEnd?: Date;
};

/* ── Provider interface ──────────────────────────────────────── */

export interface BillingProvider {
  readonly name: string;
  plans(): PlanInfo[];
  createCheckoutSession(
    userId: string,
    priceKey: string,
    seats: number,
  ): Promise<CheckoutResult>;
  createPortalSession(customerId: string): Promise<PortalResult>;
  verifyWebhook(rawBody: Uint8Array, signature: string): boolean;
  parseEvent(rawBody: Uint8Array): BillingEvent;
}

/* ── Stub provider ───────────────────────────────────────────── */

/**
 * Deterministic billing provider for development and testing. Uses HMAC
 * verification with BILLING_WEBHOOK_SECRET, emits event shapes that match
 * real Stripe structures so the webhook handler exercises the same paths.
 */
export class StubBillingProvider implements BillingProvider {
  readonly name = "stub";
  private readonly webhookSecret: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;

  constructor(config: Config) {
    this.webhookSecret = config.stripeWebhookSecret ?? "stub-secret";
    this.successUrl =
      config.billingSuccessUrl ?? "http://localhost:3000/billing?checkout=success";
    this.cancelUrl =
      config.billingCancelUrl ?? "http://localhost:3000/pricing";
  }

  plans(): PlanInfo[] {
    return [
      {
        key: "pro",
        name: "Pro",
        pricePerSeat: 1200,
        currency: "usd",
      },
    ];
  }

  async createCheckoutSession(
    userId: string,
    priceKey: string,
    seats: number,
  ): Promise<CheckoutResult> {
    // The stub mirrors real-provider validation: unknown prices fail here
    // (surfaced as 400 by the route) instead of minting dead sessions.
    // userId/seats ride along in the redirect so dev webhooks can complete
    // the loop without a real Checkout page in between.
    const plan = this.plans().find((candidate) => candidate.key === priceKey);
    if (!plan) throw new Error(`Unknown price: ${priceKey}`);
    const sessionId = `stub_cs_${randomUUID()}`;
    const url = `${this.successUrl}&session_id=${sessionId}&user=${encodeURIComponent(userId)}&seats=${seats}`;
    return { url, sessionId };
  }

  async createPortalSession(customerId: string): Promise<PortalResult> {
    return { url: `${this.cancelUrl}?portal=stub&customer=${customerId}` };
  }

  verifyWebhook(rawBody: Uint8Array, signature: string): boolean {
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");
    const actual = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    // Constant-time compare: webhook endpoints are unauthenticated, so a
    // naive === would leak the secret byte-by-byte to timing probes.
    return (
      actual.length === expectedBuf.length &&
      timingSafeEqual(actual, expectedBuf)
    );
  }

  parseEvent(rawBody: Uint8Array): BillingEvent {
    const text = new TextDecoder().decode(rawBody);
    const data = JSON.parse(text) as Record<string, unknown>;
    return {
      eventId: typeof data.eventId === "string" ? data.eventId : randomUUID(),
      type: typeof data.type === "string" ? data.type : "unknown",
      customerId:
        typeof data.customerId === "string" ? data.customerId : undefined,
      subscriptionId:
        typeof data.subscriptionId === "string"
          ? data.subscriptionId
          : undefined,
      userId: typeof data.userId === "string" ? data.userId : undefined,
      priceKey: typeof data.priceKey === "string" ? data.priceKey : undefined,
      seats: typeof data.seats === "number" ? data.seats : undefined,
      status: typeof data.status === "string" ? data.status : undefined,
      periodEnd:
        typeof data.periodEnd === "string" &&
        !Number.isNaN(new Date(data.periodEnd).getTime())
          ? new Date(data.periodEnd)
          : undefined,
    };
  }
}

/* ── Webhook handler ─────────────────────────────────────────── */

export type BillingDeps = {
  provider: BillingProvider;
  subscriptionStore: SubscriptionStore;
  billingEventStore: BillingEventStore;
  userStore: UserStore;
};

export type WebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

const ACTIVE_STATUSES = new Set(["active"]);
const DOWNGRADE_STATUSES = new Set([
  "canceled",
  "past_due",
  "expired",
  "unpaid",
]);

/**
 * Processes a raw billing webhook. Called from the `routes.ts` bridge
 * before Elysia touches the request, preserving the raw body bytes for
 * HMAC/Stripe signature verification.
 */
export async function handleBillingWebhook(
  rawBody: Uint8Array,
  signature: string,
  deps: BillingDeps,
): Promise<WebhookResult> {
  const { provider, subscriptionStore, billingEventStore, userStore } = deps;

  // 1. Verify signature
  if (!provider.verifyWebhook(rawBody, signature)) {
    return {
      status: 401,
      body: { error: "Invalid webhook signature", code: "INVALID_SIGNATURE" },
    };
  }

  // 2. Parse event
  let event: BillingEvent;
  try {
    event = provider.parseEvent(rawBody);
  } catch {
    return {
      status: 400,
      body: { error: "Malformed webhook payload", code: "PARSE_ERROR" },
    };
  }

  // 3. Idempotency check
  const isNew = await billingEventStore.recordEvent(event.eventId, event.type);
  if (!isNew) {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  // 4. Process event
  const userId = event.userId;
  if (!userId) {
    return { status: 200, body: { received: true, skipped: "no userId" } };
  }

  // Never default a missing status to active: a `subscription.updated`
  // event without a status must not mint PRO. `checkout.completed` carries
  // no status at all (payment just succeeded), so it upgrades directly.
  if (event.type === "checkout.completed") {
    return upgrade(event, userId);
  }

  const eventStatus = event.status;
  if (!eventStatus) {
    return { status: 200, body: { received: true, skipped: "no status" } };
  }

  if (
    event.type === "subscription.updated" &&
    ACTIVE_STATUSES.has(eventStatus)
  ) {
    return upgrade(event, userId);
  }

  // userId is passed explicitly (not closed over): narrowing does not
  // survive into nested function bodies, and an undefined id here would
  // write a corrupt subscription row.
  async function upgrade(evt: BillingEvent, uid: string) {
    // Upgrade: create/update subscription and set user tier to PRO.
    // Seats are validated at the API boundary (CheckoutSchema caps them);
    // the stored value here is a signed-provider assertion, not a claim.
    const upsert: UpsertSubscription = {
      userId: uid,
      provider: provider.name,
      customerId: evt.customerId,
      providerSubId: evt.subscriptionId,
      status: "active",
      priceKey: evt.priceKey ?? "pro",
      seats: evt.seats ?? 1,
      periodEnd: evt.periodEnd,
    };
    await subscriptionStore.upsertByUserId(upsert);
    await userStore.updateTier(uid, "PRO" as Tier);
    return { status: 200, body: { received: true, action: "upgraded" } };
  }

  if (
    event.type === "subscription.deleted" ||
    (event.type === "subscription.updated" &&
      DOWNGRADE_STATUSES.has(eventStatus))
  ) {
    // Downgrade: update subscription status and revert user tier
    const existing = await subscriptionStore.findByUserId(userId);
    if (existing) {
      await subscriptionStore.upsertByUserId({
        ...existing,
        status: eventStatus,
      });
    }
    await userStore.updateTier(userId, "COMMUNITY" as Tier);
    return { status: 200, body: { received: true, action: "downgraded" } };
  }

  return { status: 200, body: { received: true, skipped: event.type } };
}

/* ── Stub webhook payload builder (for tests) ────────────────── */

/**
 * Signs a webhook payload for the stub provider. Useful in tests to
 * simulate realistic webhook calls.
 */
export function signStubWebhook(
  payload: Record<string, unknown>,
  secret: string,
): { body: Buffer; signature: string } {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return { body, signature };
}
