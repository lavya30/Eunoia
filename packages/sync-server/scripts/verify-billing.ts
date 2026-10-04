/**
 * Billing end-to-end drill (Razorpay TEST MODE, staging only — never CI).
 *
 * Exercises the full money path against a live staging server:
 * register → prices → hosted checkout → (operator pays in test mode) →
 * webhook-driven tier flip → webhook redelivery idempotency → cancel at
 * cycle end. Secrets stay in env; nothing here is committed.
 *
 * Run: `bun scripts/verify-billing.ts --confirm-staging
 *   [--sync-url=http://staging:3001] [--price=pro] [--email=...]`
 * from `packages/sync-server/`. Requires on the staging host:
 * `RAZORPAY_KEY_ID/SECRET` (test keys), `RAZORPAY_WEBHOOK_SECRET`
 * (for the local redelivery step), `RAZORPAY_PLAN_PRO`.
 *
 * The `--confirm-staging` flag is mandatory: this script moves real
 * (test-mode) money and must never run against production or in CI.
 */
import { createInterface } from "node:readline/promises";
import { signWebhookBody } from "../src/billing.js";

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  for (const token of process.argv.slice(2)) {
    if (token.startsWith(prefix)) return token.slice(prefix.length);
  }
  return fallback;
}

function fail(message: string): never {
  console.error(`DRILL FAIL: ${message}`);
  process.exit(1);
}

if (!process.argv.includes("--confirm-staging")) {
  fail(
    "refusing to run without --confirm-staging (staging only, never production or CI)",
  );
}

const syncUrl = (arg("sync-url", "http://127.0.0.1:3001") as string).replace(
  /\/$/,
  "",
);
const priceKey = arg("price", "pro") as string;
const email = arg(
  "email",
  `drill-${Date.now().toString(36)}@example.com`,
) as string;
const webhookSecret = arg(
  "webhook-secret",
  process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
);
if (!webhookSecret) {
  fail(
    "RAZORPAY_WEBHOOK_SECRET is required (env or --webhook-secret=) for the redelivery step",
  );
}

type Json = Record<string, unknown>;

async function api(
  path: string,
  init: RequestInit,
  auth?: string,
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${syncUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

console.log(`billing drill: ${syncUrl} price=${priceKey} email=${email}`);

// 1. Billing must be configured on staging (not BILLING_NOT_CONFIGURED).
const prices = await api("/api/billing/prices", { method: "GET" });
if (prices.status === 503)
  fail(
    "billing not configured on staging (BILLING_NOT_CONFIGURED) — set RAZORPAY_* on the host",
  );
if (prices.status !== 200)
  fail(`prices answered ${prices.status}: ${JSON.stringify(prices.body)}`);
const offered = ((prices.body.prices ?? []) as Array<{ key?: string }>).some(
  (p) => p.key === priceKey,
);
if (!offered)
  fail(`price "${priceKey}" not offered: ${JSON.stringify(prices.body)}`);
console.log(`[1/6] prices OK (offers "${priceKey}")`);

// 2. Register a drill user.
const reg = await api("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    email,
    password: "drill-pass-123",
    name: "Billing Drill",
  }),
});
if (reg.status !== 201)
  fail(`register answered ${reg.status}: ${JSON.stringify(reg.body)}`);
const token =
  ((reg.body.token ?? (reg.body.user as Json)?.token) as string) ??
  (reg.body as { token?: string }).token;
const userId = ((reg.body.user ?? {}) as Json).id as string;
if (!token || !userId)
  fail(`register response missing token/user: ${JSON.stringify(reg.body)}`);
console.log(`[2/6] registered ${email}`);

// 3. Checkout → hosted test-mode link. The operator pays there.
const checkout = await api(
  "/api/billing/checkout",
  { method: "POST", body: JSON.stringify({ priceKey, seats: 1 }) },
  token,
);
if (checkout.status !== 200)
  fail(
    `checkout answered ${checkout.status}: ${JSON.stringify(checkout.body)}`,
  );
console.log(
  `[3/6] checkout session created. Complete the TEST payment now:\n  ${checkout.body.url as string}`,
);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question(
  "Press Enter after the test payment succeeds (webhook must reach staging)...",
);
rl.close();

// 4. Poll until the webhook flips the tier (60 × 5s).
let tier: unknown = null;
let subscription: Json | null = null;
for (let i = 0; i < 60; i++) {
  const sub = await api("/api/billing/subscription", { method: "GET" }, token);
  if (sub.status === 200) {
    tier = sub.body.userTier;
    subscription = (sub.body.subscription ?? null) as Json | null;
    if (
      tier === "PRO" &&
      subscription &&
      String(subscription.status ?? "active") === "active"
    )
      break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}
if (tier !== "PRO" || !subscription) {
  fail(
    `tier did not flip to PRO within 5 min (tier=${String(tier)}). Check the Razorpay dashboard: payment captured? webhook delivered (200)? secret matches?`,
  );
}
const providerSubId = subscription.providerSubId as string;
console.log(`[4/6] tier flipped to PRO (sub=${providerSubId})`);

// 5. Redelivery idempotency: same envelope twice. `subscription.paused`
// is recorded but skipped (no mutation), so this is zero-risk: both
// deliveries must 200, the second flagged duplicate, tier untouched.
const envelope = {
  account_id: "acc_drill",
  event: "subscription.paused",
  contains: ["subscription"],
  payload: {
    subscription: {
      entity: {
        id: providerSubId,
        status: "paused",
        notes: { userId },
        quantity: 1,
      },
    },
  },
  created_at: Math.floor(Date.now() / 1000),
};
const raw = Buffer.from(JSON.stringify(envelope), "utf8");
const signature = signWebhookBody(raw, webhookSecret as string);
const deliver = () =>
  fetch(`${syncUrl}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
    },
    body: raw,
  });
const first = await deliver();
const firstBody = (await first.json()) as Json;
const second = await deliver();
const secondBody = (await second.json()) as Json;
if (first.status !== 200 || second.status !== 200) {
  fail(
    `redelivery answered ${first.status}/${second.status} (expected 200/200)`,
  );
}
if (secondBody.duplicate !== true)
  fail(`second delivery not flagged duplicate: ${JSON.stringify(secondBody)}`);
const afterDup = await api(
  "/api/billing/subscription",
  { method: "GET" },
  token,
);
if (afterDup.body.userTier !== "PRO")
  fail("tier changed after duplicate delivery");
console.log(
  `[5/6] redelivery idempotent (first=${JSON.stringify(firstBody)} second=duplicate)`,
);

// 6. Cancel: at cycle end (Razorpay has no portal). Access runs out
// naturally; the downgrade webhook flips the tier when it ends.
const cancel = await api(
  "/api/billing/cancel",
  { method: "POST", body: JSON.stringify({}) },
  token,
);
if (cancel.status !== 200)
  fail(`cancel answered ${cancel.status}: ${JSON.stringify(cancel.body)}`);
const afterCancel = await api(
  "/api/billing/subscription",
  { method: "GET" },
  token,
);
if (afterCancel.body.userTier !== "PRO") {
  fail(
    `tier dropped immediately on cancel (expected PRO until cycle end): ${JSON.stringify(afterCancel.body)}`,
  );
}
console.log(`[6/6] cancelled at cycle end (still PRO until period end)`);

console.log(
  `RESULT ${JSON.stringify({ drill: "billing-e2e", price: priceKey, email, tier: "PRO", redeliveryIdempotent: true, cancelAtCycleEnd: true, pass: true })}`,
);
console.log(
  "done. Record the plan IDs + this run in docs/RUNBOOK.md billing notes.",
);
