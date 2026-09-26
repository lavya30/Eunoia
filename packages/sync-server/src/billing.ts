import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
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

export type CancelResult = {
  status: string;
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
    customer?: { email?: string },
  ): Promise<CheckoutResult>;
  /**
   * Razorpay has no customer portal: management is server-side cancel
   * (at cycle end, so access lasts out the paid period).
   */
  cancelSubscription(subscriptionId: string): Promise<CancelResult>;
  verifyWebhook(rawBody: Uint8Array, signature: string): boolean;
  parseEvent(rawBody: Uint8Array): BillingEvent;
}

/* ── Razorpay client facade (injectable for tests) ───────────── */

export type RazorpayClient = {
  subscriptions: {
    create(params: Record<string, unknown>): Promise<{
      id: string;
      short_url?: string;
    }>;
    cancel(
      subscriptionId: string,
      cancelAtCycleEnd?: boolean,
    ): Promise<{ status?: string }>;
  };
  customers: {
    create(params: Record<string, unknown>): Promise<{ id: string }>;
  };
};

/* ── Razorpay provider ───────────────────────────────────────── */

const RAZORPAY_UPGRADE_STATUSES = new Set([
  "authenticated",
  "active",
  "charged",
]);
const RAZORPAY_DOWNGRADE_STATUSES = new Set([
  "cancelled",
  "completed",
  "expired",
]);

/**
 * Razorpay billing provider (UPI + domestic cards + international cards,
 * INR settlement, RBI-compliant mandates). Recurring auth, pre-debit
 * notifications, and eFIRC are all Razorpay-side — the server only creates
 * subscriptions, verifies webhooks, and flips tiers.
 */
export class RazorpayBillingProvider implements BillingProvider {
  readonly name = "razorpay";
  private readonly webhookSecret: string;
  private readonly successUrl: string;
  private readonly planPro: string;
  private readonly client: RazorpayClient;

  constructor(config: Config, client?: RazorpayClient) {
    if (!config.razorpayWebhookSecret)
      throw new Error("RAZORPAY_WEBHOOK_SECRET is required");
    if (!config.razorpayPlanPro)
      throw new Error("RAZORPAY_PLAN_PRO is required");
    this.webhookSecret = config.razorpayWebhookSecret;
    this.successUrl =
      config.billingSuccessUrl ?? "http://localhost:3000/billing?success=true";
    this.planPro = config.razorpayPlanPro;
    this.client =
      client ??
      (new Razorpay({
        key_id: config.razorpayKeyId ?? "",
        key_secret: config.razorpayKeySecret ?? "",
      }) as unknown as RazorpayClient);
  }

  plans(): PlanInfo[] {
    // Server-declared catalog (amounts must match the dashboard plan).
    // Razorpay plan amounts live in the dashboard; this keeps /pricing
    // working without an extra API call per page view.
    return [
      {
        key: "pro",
        name: "Pro",
        pricePerSeat: 1200,
        currency: "usd",
      },
    ];
  }

  private priceIdFor(priceKey: string): string {
    if (priceKey === "pro") return this.planPro;
    throw new Error(`Unknown price: ${priceKey}`);
  }

  async createCheckoutSession(
    userId: string,
    priceKey: string,
    seats: number,
    customer?: { email?: string },
  ): Promise<CheckoutResult> {
    const planId = this.priceIdFor(priceKey);
    const created = await this.client.customers.create({
      email: customer?.email,
      notes: { userId },
    });
    // total_count 120 ≈ 10 years of monthly cycles: effectively evergreen
    // until the customer cancels. customer_notify sends Razorpay's hosted
    // mandate/checkout link; short_url is that hosted page.
    const subscription = await this.client.subscriptions.create({
      plan_id: planId,
      customer_id: created.id,
      quantity: seats,
      total_count: 120,
      customer_notify: 1,
      notes: { userId },
    });
    if (!subscription.short_url)
      throw new Error("Razorpay did not return a checkout URL");
    return { url: subscription.short_url, sessionId: subscription.id };
  }

  async cancelSubscription(subscriptionId: string): Promise<CancelResult> {
    const cancelled = await this.client.subscriptions.cancel(
      subscriptionId,
      true,
    );
    return { status: cancelled.status ?? "cancelled" };
  }

  verifyWebhook(rawBody: Uint8Array, signature: string): boolean {
    const expected = createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");
    const actual = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    // Constant-time compare: webhook endpoints are unauthenticated, so a
    // naive === would leak the secret byte-by-byte to timing probes.
    // Same HMAC-hex scheme as Razorpay's own validateWebhookSignature.
    return (
      actual.length === expectedBuf.length &&
      timingSafeEqual(actual, expectedBuf)
    );
  }

  parseEvent(rawBody: Uint8Array): BillingEvent {
    // Razorpay envelope: { event, contains: [...], payload: { <kind>:
    // { entity: {...} } }, created_at }. Unlike Stripe there is no delivery
    // id, so idempotency keys are composite (type:entity:created_at).
    const text = new TextDecoder().decode(rawBody);
    const data = JSON.parse(text) as Record<string, unknown>;
    const type = typeof data.event === "string" ? data.event : "unknown";
    const createdAt =
      typeof data.created_at === "number" ? data.created_at : undefined;
    const entity = extractEntity(data);
    const entityId =
      entity && typeof entity.id === "string" ? entity.id : undefined;
    const eventId =
      entityId !== undefined
        ? `${type}:${entityId}:${createdAt ?? ""}`
        : undefined;
    const planId =
      entity && typeof entity.plan_id === "string" ? entity.plan_id : undefined;
    const currentEnd =
      entity && typeof entity.current_end === "number"
        ? entity.current_end
        : undefined;
    return {
      eventId: eventId ?? "",
      type,
      customerId:
        entity && typeof entity.customer_id === "string"
          ? entity.customer_id
          : undefined,
      subscriptionId: entityId,
      userId:
        entity &&
        typeof entity.notes === "object" &&
        entity.notes !== null &&
        typeof (entity.notes as Record<string, unknown>).userId === "string"
          ? ((entity.notes as Record<string, unknown>).userId as string)
          : undefined,
      priceKey: planId === this.planPro ? "pro" : planId,
      seats:
        entity && typeof entity.quantity === "number"
          ? entity.quantity
          : undefined,
      status:
        entity && typeof entity.status === "string" ? entity.status : undefined,
      periodEnd:
        currentEnd !== undefined ? new Date(currentEnd * 1000) : undefined,
    };
  }
}

function extractEntity(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : null;
  if (!payload) return null;
  const contains = Array.isArray(data.contains)
    ? (data.contains as unknown[])
    : [];
  for (const kind of contains) {
    if (typeof kind !== "string") continue;
    const section =
      payload[kind] && typeof payload[kind] === "object"
        ? (payload[kind] as Record<string, unknown>)
        : null;
    const entity =
      section && typeof section.entity === "object" && section.entity !== null
        ? (section.entity as Record<string, unknown>)
        : null;
    if (entity) return entity;
  }
  // Fallback for compact fixtures: payload.subscription.entity.
  const fallback =
    payload.subscription && typeof payload.subscription === "object"
      ? (payload.subscription as Record<string, unknown>)
      : null;
  if (
    fallback &&
    typeof fallback.entity === "object" &&
    fallback.entity !== null
  )
    return fallback.entity as Record<string, unknown>;
  return null;
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

// Razorpay subscription lifecycle vocabulary. `charged` fires every
// successful billing cycle (idempotent confirm-active); `halted` means
// repeated auth failures — deliberately skipped, not a downgrade, so a
// payment hiccup never yanks PRO before Razorpay's own dunning ends.
const ACTIVE_STATUSES = new Set(["authenticated", "active", "charged"]);
const DOWNGRADE_STATUSES = new Set(["cancelled", "completed", "expired"]);

/**
 * Processes a raw billing webhook. Called from the `routes.ts` bridge
 * before Elysia touches the request, preserving the raw body bytes for
 * HMAC signature verification.
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

  // Razorpay sends no delivery id; envelopes without an entity produce an
  // empty composite key, which would collide idempotency across events.
  if (!event.eventId) {
    return { status: 200, body: { received: true, skipped: "no eventId" } };
  }

  // 3. Idempotency check
  const isNew = await billingEventStore.recordEvent(event.eventId, event.type);
  if (!isNew) {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  // 4. Resolve the user: subscription notes first (stamped at creation),
  // then the stored customer mapping as fallback.
  let userId = event.userId;
  if (!userId && event.customerId) {
    const mapped = await subscriptionStore.findByCustomerId(event.customerId);
    userId = mapped?.userId;
  }
  if (!userId) {
    return { status: 200, body: { received: true, skipped: "no userId" } };
  }

  // Never default a missing status to active: an event without one must
  // not mint PRO.
  const eventStatus = event.status;
  if (!eventStatus) {
    return { status: 200, body: { received: true, skipped: "no status" } };
  }

  if (ACTIVE_STATUSES.has(eventStatus)) {
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

  if (DOWNGRADE_STATUSES.has(eventStatus)) {
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

/* ── Test webhook signer ─────────────────────────────────────── */

/**
 * Signs a raw webhook body the same way Razorpay does (HMAC-SHA256 hex).
 * Useful in tests to simulate realistic webhook calls.
 */
export function signWebhookBody(
  rawBody: Uint8Array,
  secret: string,
): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
