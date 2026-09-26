import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { WebSocketServer } from "ws";
import type { ApiDeps } from "./api/app.js";
import { handleApiRequest } from "./api/routes.js";
import type { Config } from "./config.js";
import { loadConfig } from "./config.js";
import { defaultHealthChecks, type HealthChecks } from "./health.js";
import { Metrics } from "./metrics.js";
import { appVersion } from "./version.js";
import {
  type ImageDeps,
  MemoryImageStore,
  PrismaImageStore,
  resolveR2Config,
  S3R2Client,
} from "./images.js";
import {
  MemorySnapshotStore,
  PrismaSnapshotStore,
  type SnapshotStore,
} from "./RoomLoader.js";
import { RoomManager } from "./RoomManager.js";
import { authorizeRoom, extractTicket } from "./room-auth.js";
import { MemoryUserStore, PrismaUserStore, type UserStore } from "./users.js";
import { WebSocketHandler } from "./WebSocketHandler.js";

const logger = pino({ name: "eunoia-sync-server" });

export type SyncServer = {
  server: Server;
  manager: RoomManager;
  close(): Promise<void>;
};

export function createSyncServer(
  config: Config = loadConfig(),
  store?: SnapshotStore,
  imageDeps?: Partial<ImageDeps>,
  userStore?: UserStore,
  healthChecks?: HealthChecks,
): SyncServer {
  if (
    config.databaseUrl !== undefined &&
    !config.databaseUrl.startsWith("postgres")
  ) {
    // Anything else (typos, sqlite:/file: URLs the schema doesn't support)
    // must fail loudly — silently running the in-memory store would lose
    // every room on restart.
    throw new Error(
      "Unsupported DATABASE_URL: only postgresql:// URLs are supported (or leave it unset for in-memory development mode).",
    );
  }
  const prisma = config.databaseUrl?.startsWith("postgres")
    ? new PrismaClient({ datasources: { db: { url: config.databaseUrl } } })
    : undefined;
  const persistence =
    store ??
    (prisma
      ? new PrismaSnapshotStore(prisma, {
          maxPerRoom: config.snapshotMaxPerRoom,
          retentionDays: config.snapshotRetentionDays,
        })
      : new MemorySnapshotStore({
          maxPerRoom: config.snapshotMaxPerRoom,
          retentionDays: config.snapshotRetentionDays,
        }));
  const r2Config = resolveR2Config(config);
  const images: ImageDeps = {
    imageStore:
      imageDeps?.imageStore ??
      (prisma ? new PrismaImageStore(prisma) : new MemoryImageStore()),
    r2:
      imageDeps?.r2 !== undefined
        ? imageDeps.r2
        : r2Config
          ? new S3R2Client(r2Config)
          : null,
  };
  const manager = new RoomManager(config, persistence);
  const users: UserStore =
    userStore ?? (prisma ? new PrismaUserStore(prisma) : new MemoryUserStore());
  const handler = new WebSocketHandler(manager);
  const wsServer = new WebSocketServer({ noServer: true });
  let resolvedSecret = config.roomTicketSecret;
  if (!resolvedSecret) {
    resolvedSecret = randomBytes(32).toString("hex");
    logger.warn(
      "ROOM_TICKET_SECRET is unset; using an ephemeral secret. Room tickets invalidate on restart.",
    );
  }
  const ticketSecret: string = resolvedSecret;
  const apiConfig: Config = { ...config, roomTicketSecret: ticketSecret };
  // Shared per-process API state: one metrics registry and one start time
  // across requests (the HTTP bridge builds a fresh Elysia app per request,
  // so anything created inside createApiApp would reset on every call).
  const startedAt = Date.now();
  const version = appVersion();
  const apiDeps: ApiDeps = {
    health: healthChecks ?? defaultHealthChecks(apiConfig, prisma),
    metrics: new Metrics(),
    getStats: () => ({
      activeRooms: manager.activeRoomCount,
      wsConnections: wsServer.clients.size,
    }),
    startedAt,
    version,
  };
  const server = createServer((req, res) => {
    void handleApiRequest(req, res, manager, apiConfig, images, users, {
      apiDeps,
      log: logger,
    }).catch((error) => {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Bad request",
        }),
      );
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const roomId = getRoomId(req);
    if (!roomId) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const queryTicket = url.searchParams.get("ticket") ?? undefined;
    const ticket = extractTicket(
      req.headers as Record<string, string | undefined>,
      { ticket: queryTicket },
    );
    void authorizeRoom(manager, roomId, ticket, queryTicket, ticketSecret)
      .then((access) => {
        if (access.status === "locked") {
          logger.info({ roomId }, "ws upgrade rejected: locked");
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        if (access.status === "missing") {
          // Unlike HTTP room creation, the socket never auto-creates rooms:
          // IDs bypass CreateRoomSchema validation here.
          logger.info({ roomId }, "ws upgrade rejected: missing room");
          socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
          socket.destroy();
          return;
        }
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          logger.debug({ roomId }, "ws upgrade accepted");
          void handler
            .handle(ws, roomId)
            .catch(() => ws.close(1011, "Unable to load room"));
        });
      })
      .catch(() => {
        logger.info({ roomId }, "ws upgrade rejected: auth error");
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  const close = async () => {
    await manager.shutdown();
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  };
  return { server, manager, close };
}

function getRoomId(req: IncomingMessage): string | undefined {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const match =
    pathname.match(/^\/sync\/([^/]+)$/) ??
    pathname.match(/^\/api\/rooms\/([^/]+)\/sync$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const config = loadConfig();
  if (!config.d2CompilerUrl) {
    logger.warn(
      "D2_COMPILER_URL is unset; /api/compile returns placeholder layouts. Start the compiler (docker compose up d2-compiler) and set D2_COMPILER_URL to enable real diagrams.",
    );
  }
  const app = createSyncServer(config);
  app.server.listen(config.port, config.host, () => {
    logger.info(
      { version: appVersion() },
      `Eunoia sync server listening on ${config.host}:${config.port}`,
    );
  });
  const shutdown = () => void app.close().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
