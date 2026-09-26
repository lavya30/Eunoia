import type { IncomingMessage, ServerResponse } from "node:http";
import type pino from "pino";
import type { Config } from "../config.js";
import type { ImageDeps } from "../images.js";
import type { RoomManager } from "../RoomManager.js";
import type { UserStore } from "../users.js";
import { handleBillingWebhook, type BillingDeps } from "../billing.js";
import { type ApiDeps, createApiApp } from "./app.js";

const MAX_BODY_BYTES = 1_000_000;

/** Thrown when a request body exceeds MAX_BODY_BYTES. Carries a stable
 * code so the server boundary can answer 413 instead of a bare 400. */
export class BodyTooLargeError extends Error {
  readonly code = "BODY_TOO_LARGE";
  constructor(readonly receivedBytes: number) {
    super(`Request body exceeds the ${MAX_BODY_BYTES} byte limit`);
    this.name = "BodyTooLargeError";
  }
}

export type ApiBridgeOptions = {
  /** Shared per-process API deps (metrics, health, version). */
  apiDeps?: ApiDeps;
  /** Billing provider and stores for webhooks and subscription endpoints. */
  billing?: BillingDeps;
  /** When set, every request is logged as one JSON access line. */
  log?: pino.Logger;
};

/** Bridges Node's HTTP server to Elysia's standard Request/Response handler. */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  manager: RoomManager,
  config: Config,
  images: ImageDeps,
  users: UserStore,
  options: ApiBridgeOptions = {},
): Promise<void> {
  const started = Date.now();
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader(
      "access-control-allow-headers",
      "content-type, authorization, x-user-token, x-billing-signature, stripe-signature",
    );
    res.setHeader(
      "access-control-allow-methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
    res.end();
    return;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value)
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  // Track length incrementally: re-concatenating per chunk is O(n²) on
  // large bodies and invites slow-loris memory pressure.
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buf.length;
    if (receivedBytes > MAX_BODY_BYTES)
      throw new BodyTooLargeError(receivedBytes);
    chunks.push(buf);
  }
  const body =
    chunks.length && req.method !== "GET" && req.method !== "HEAD"
      ? Buffer.concat(chunks)
      : undefined;

  const pathname = req.url?.split("?")[0];
  if (req.method === "POST" && pathname === "/api/billing/webhook") {
    if (!options.billing) {
      res.statusCode = 503;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: "Billing is not configured",
          code: "BILLING_NOT_CONFIGURED",
        }),
      );
      options.log?.info(
        {
          method: req.method,
          path: pathname,
          status: 503,
          durationMs: Date.now() - started,
        },
        "http request",
      );
      return;
    }

    const sigHeader =
      req.headers["x-billing-signature"] ?? req.headers["stripe-signature"];
    const signature = Array.isArray(sigHeader)
      ? (sigHeader[0] ?? "")
      : (sigHeader ?? "");
    const result = await handleBillingWebhook(
      body ?? new Uint8Array(0),
      signature,
      options.billing,
    );
    res.statusCode = result.status;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result.body));
    options.log?.info(
      {
        method: req.method,
        path: pathname,
        status: result.status,
        durationMs: Date.now() - started,
      },
      "http request",
    );
    return;
  }

  const apiDeps: ApiDeps = {
    ...options.apiDeps,
    billing: options.billing ?? options.apiDeps?.billing,
  };
  const request = new Request(
    `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`,
    { method: req.method, headers, body },
  );
  const response = await createApiApp(
    manager,
    config,
    images,
    users,
    apiDeps,
  ).handle(request);
  res.statusCode = response.status;
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, x-user-token",
  );
  res.setHeader(
    "access-control-allow-methods",
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
  options.log?.info(
    {
      method: req.method,
      path: req.url?.split("?")[0],
      status: response.status,
      durationMs: Date.now() - started,
    },
    "http request",
  );
}
