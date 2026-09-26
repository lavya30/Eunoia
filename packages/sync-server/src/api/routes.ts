import type { IncomingMessage, ServerResponse } from "node:http";
import type pino from "pino";
import type { Config } from "../config.js";
import type { ImageDeps } from "../images.js";
import type { RoomManager } from "../RoomManager.js";
import type { UserStore } from "../users.js";
import { type ApiDeps, createApiApp } from "./app.js";

const MAX_BODY_BYTES = 1_000_000;

export type ApiBridgeOptions = {
  /** Shared per-process API deps (metrics, health, version). */
  apiDeps?: ApiDeps;
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
      "content-type, authorization, x-user-token",
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
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > MAX_BODY_BYTES)
      throw new Error("Request body too large");
  }
  const body =
    chunks.length && req.method !== "GET" && req.method !== "HEAD"
      ? Buffer.concat(chunks)
      : undefined;
  const request = new Request(
    `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`,
    { method: req.method, headers, body },
  );
  const response = await createApiApp(
    manager,
    config,
    images,
    users,
    options.apiDeps,
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
