import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { WebSocketServer } from "ws";
import type { ApiDeps } from "./api/app.js";
import { BodyTooLargeError, handleApiRequest } from "./api/routes.js";
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
import { verifyUserToken } from "./user-auth.js";
import { roleAtLeast } from "./workspaces.js";
import { MemoryUserStore, PrismaUserStore, type UserStore } from "./users.js";
import { WebSocketHandler } from "./WebSocketHandler.js";
import {
  MemoryBillingEventStore,
  MemoryBillingStore,
  PrismaBillingEventStore,
  PrismaBillingStore,
} from "./billing-store.js";
import { RazorpayBillingProvider, type BillingDeps } from "./billing.js";
import {
  MemoryWorkspaceStore,
  PrismaWorkspaceStore,
  type WorkspaceStore,
} from "./workspaces.js";
import { MemoryAiUsageStore, PrismaAiUsageStore } from "./ai.js";
import {
  MemoryAuditStore,
  PrismaAuditStore,
  recordAudit,
} from "./audit.js";

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
  billingDepsOverride?: Partial<BillingDeps>,
  workspaceStore?: WorkspaceStore,
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
  // Billing is live only with Razorpay credentials (same pattern as R2:
  // unconfigured in dev means the billing endpoints answer 503, and
  // self-hosted Community Edition keeps DB-managed tiers).
  const audit = prisma ? new PrismaAuditStore(prisma) : new MemoryAuditStore();
  const billing: BillingDeps | undefined =
    billingDepsOverride?.provider ?? config.razorpayKeyId
      ? {
          provider:
            billingDepsOverride?.provider ??
            new RazorpayBillingProvider(config),
          recordAudit: (input) => recordAudit(audit, input),
          subscriptionStore:
            billingDepsOverride?.subscriptionStore ??
            (prisma ? new PrismaBillingStore(prisma) : new MemoryBillingStore()),
          billingEventStore:
            billingDepsOverride?.billingEventStore ??
            (prisma
              ? new PrismaBillingEventStore(prisma)
              : new MemoryBillingEventStore()),
          userStore: billingDepsOverride?.userStore ?? users,
        }
      : undefined;
  const workspaces: WorkspaceStore =
    workspaceStore ??
    (prisma ? new PrismaWorkspaceStore(prisma) : new MemoryWorkspaceStore());
  const aiUsage =
    prisma ? new PrismaAiUsageStore(prisma) : new MemoryAiUsageStore();
  const handler = new WebSocketHandler(manager);
  // Bound inbound frames: without maxPayload a single malicious client can
  // force multi-hundred-MB Buffer.concat allocations before Yjs ever sees
  // the bytes (ws default is 100MB). 8MB still fits large initial syncs;
  // oversize peers are closed with 1009 by ws itself.
  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
  });
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
  const metrics = new Metrics();
  const apiDeps: ApiDeps = {
    health: healthChecks ?? defaultHealthChecks(apiConfig, prisma),
    metrics,
    getStats: () => ({
      activeRooms: manager.activeRoomCount,
      wsConnections: wsServer.clients.size,
    }),
    startedAt,
    version,
    workspaces,
    aiUsage,
    audit,
  };
  const server = createServer((req, res) => {
    void handleApiRequest(req, res, manager, apiConfig, images, users, {
      apiDeps,
      billing,
      log: logger,
    }).catch((error) => {
      // Oversized bodies get their own status: a 400 would look like a
      // client bug in the payload shape rather than a size limit.
      const tooLarge = error instanceof BodyTooLargeError;
      res.statusCode = tooLarge ? 413 : 400;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          tooLarge
            ? { error: error.message, code: error.code }
            : {
                error: error instanceof Error ? error.message : "Bad request",
                code: "BAD_REQUEST",
              },
        ),
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
    const acceptUpgrade = () => {
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        logger.debug({ roomId }, "ws upgrade accepted");
        void handler.handle(ws, roomId).catch(() => {
          // No client was registered, but getOrCreate may have
          // materialized the room: release it so a failing room id
          // cannot pin an empty room until the idle timeout.
          // (release() is a no-op for rooms that gained clients.)
          manager.release(roomId);
          ws.close(1011, "Unable to load room");
        });
      });
    };
    // Membership fallback for locked workspace rooms (see above).
    const authorizeWorkspaceSocket = async (
      targetRoomId: string,
      userToken: string,
    ): Promise<boolean> => {
      const userId = verifyUserToken(ticketSecret, userToken);
      if (!userId) return false;
      const room = await manager.getRoomMetadata(targetRoomId);
      if (!room?.workspaceId) return false;
      const ws = await workspaces.getWorkspace(room.workspaceId);
      if (!ws) return false;
      if (ws.ownerId === userId) return true;
      const membership = await workspaces.getMembership(
        room.workspaceId,
        userId,
      );
      return roleAtLeast(membership?.role ?? null, "VIEWER");
    };
    void authorizeRoom(manager, roomId, ticket, queryTicket, ticketSecret)
      .then(async (access) => {
        if (access.status === "locked") {
          // Workspace members sync without a room ticket: browsers can't
          // set WS headers, so identity travels as ?userToken= (the same
          // token used for HTTP). Members at VIEWER+ pass; everyone else
          // keeps the 401.
          const userToken = url.searchParams.get("userToken") ?? undefined;
          if (userToken && (await authorizeWorkspaceSocket(roomId, userToken))) {
            metrics.incWsUpgrade("member");
            acceptUpgrade();
            return;
          }
          metrics.incWsUpgrade("locked");
          logger.info({ roomId }, "ws upgrade rejected: locked");
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        if (access.status === "missing") {
          // Unlike HTTP room creation, the socket never auto-creates rooms:
          // IDs bypass CreateRoomSchema validation here.
          metrics.incWsUpgrade("missing");
          logger.info({ roomId }, "ws upgrade rejected: missing room");
          socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
          socket.destroy();
          return;
        }
        metrics.incWsUpgrade("ok");
        acceptUpgrade();
      })
      .catch(() => {
        metrics.incWsUpgrade("error");
        logger.info({ roomId }, "ws upgrade rejected: auth error");
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  const close = async () => {
    await manager.shutdown();
    // Terminate live sockets first: wsServer.close() only stops accepting,
    // and idle clients would otherwise hold the shutdown open.
    for (const client of wsServer.clients) client.terminate();
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
