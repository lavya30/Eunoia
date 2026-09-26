import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import type { Config } from "../config.js";
import { CompileRequestError, compileD2, type Tier } from "../d2-compiler.js";
import {
  AI_QUOTA,
  currentMonth,
  generateD2,
  type AiUsageStore,
} from "../ai.js";
import {
  type DependencyCheck,
  type HealthChecks,
  imageStorageCheck,
  summarizeReadiness,
} from "../health.js";
import {
  buildImageKey,
  isR2NotFound,
  type ImageDeps,
  keyBelongsToRoom,
  type ObjectHead,
} from "../images.js";
import { Metrics } from "../metrics.js";
import { appVersion } from "../version.js";
import type { RoomMetadata } from "../RoomLoader.js";
import type { RoomManager } from "../RoomManager.js";
import {
  authorizeRoom,
  extractTicket,
  hashPassword,
  issueTicket,
  verifyPassword,
} from "../room-auth.js";
import { issueUserToken, verifyUserToken } from "../user-auth.js";
import type { PublicUser, UserStore } from "../users.js";
import type { BillingDeps } from "../billing.js";
import {
  roleAtLeast,
  type WorkspaceRole,
  type WorkspaceStore,
} from "../workspaces.js";
import { recordAudit, type AuditStore } from "../audit.js";
import {
  discoveryDocument,
  exchangeCode,
  newCodeVerifier,
  newState,
  oidcConfig,
  openState,
  pkceChallenge,
  sealState,
  verifyIdToken,
} from "../sso.js";
import {
  CheckoutSchema,
  CompileRequestSchema,
  CreateFolderSchema,
  CreateRoomSchema,
  CreateWorkspaceSchema,
  GenerateDiagramSchema,
  ImageConfirmSchema,
  ImageContentTypeSchema,
  ImageListQuerySchema,
  ImageRequestUploadSchema,
  InviteMemberSchema,
  LoginUserSchema,
  MoveRoomSchema,
  RegisterUserSchema,
  RoomListQuerySchema,
  SnapshotQuerySchema,
  UnlockRoomSchema,
  UpdateMemberSchema,
  UpdateRoomSchema,
  validationError,
} from "./schemas.js";

export type { ImageDeps };

type AccessResult =
  | { room: RoomMetadata }
  | { status: 401 | 404; body: { error: string; code: string } };

async function requestAccess(
  manager: RoomManager,
  roomId: string,
  headers: Record<string, string | undefined>,
  query: Record<string, unknown>,
  secret: string,
): Promise<AccessResult> {
  const access = await authorizeRoom(
    manager,
    roomId,
    extractTicket(headers, query),
    typeof query["ticket"] === "string" && query["ticket"]
      ? query["ticket"]
      : undefined,
    secret,
  );
  if (access.status === "ok") return { room: access.room };
  return access.status === "missing"
    ? { status: 404, body: { error: "Room not found", code: "ROOM_NOT_FOUND" } }
    : {
        status: 401,
        body: {
          error: "Room requires a valid access ticket",
          code: "ROOM_LOCKED",
        },
      };
}

function r2Error(set: { status?: unknown }, error: unknown) {
  set.status = 502;
  return {
    error: error instanceof Error ? error.message : "Image storage failed",
    code: "R2_ERROR",
  };
}

const TIER_RANK: Record<Tier, number> = {
  COMMUNITY: 0,
  PRO: 1,
  ENTERPRISE: 2,
};

/** Higher of two tiers — a user's subscription travels into rooms. */
export function higherTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * Optional user identity for endpoints that personalize (but don't require)
 * authentication. Accepts the session token as `Authorization: Bearer` or
 * the `x-user-token` header — the latter lets locked-room calls carry a
 * room ticket in `Authorization` and a user token side by side. Room
 * tickets and garbage both resolve to anonymous.
 */
async function requestUser(
  users: UserStore,
  headers: Record<string, string | undefined>,
  secret: string,
): Promise<PublicUser | null> {
  const candidates = [
    bearerToken(headers.authorization),
    headers["x-user-token"],
  ];
  for (const token of candidates) {
    if (!token) continue;
    const userId = verifyUserToken(secret, token);
    if (!userId) continue;
    const user = await users.findById(userId);
    if (user) return user;
  }
  return null;
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (typeof authorization !== "string") return undefined;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

export type RoomAccess =
  | {
      room: RoomMetadata;
      /** OWNER for room owners; workspace role for members; null otherwise. */
      role: "OWNER" | WorkspaceRole | null;
    }
  | { status: 401 | 403 | 404; body: { error: string; code: string } };

/**
 * Membership-aware room access. Ticket/open access behaves exactly as
 * before; additionally, members of the room's workspace pass without a
 * room ticket (VIEWER+ for reads, EDITOR+ for writes). Owners always pass.
 */
async function requestRoomAccess(
  manager: RoomManager,
  workspaces: WorkspaceStore | undefined,
  users: UserStore,
  roomId: string,
  headers: Record<string, string | undefined>,
  query: Record<string, unknown>,
  secret: string,
  need: "read" | "write",
): Promise<RoomAccess> {
  const access = await requestAccess(manager, roomId, headers, query, secret);
  const caller =
    (await requestUser(users, headers, secret)) ?? undefined;
  if (!("body" in access)) {
    const role = await resolveRoomRole(
      workspaces,
      access.room,
      caller?.id,
    );
    return { room: access.room, role };
  }
  // Ticket path failed: fall back to workspace membership (if any).
  if (access.status === 404 || !workspaces) return access;
  const room = await manager.getRoomMetadata(roomId);
  if (!room?.workspaceId || !caller) return access;
  const membership = await workspaces.getMembership(
    room.workspaceId,
    caller.id,
  );
  const ws = await workspaces.getWorkspace(room.workspaceId);
  const role: WorkspaceRole | null =
    ws?.ownerId === caller.id ? "ADMIN" : (membership?.role ?? null);
  const minimum: WorkspaceRole = need === "read" ? "VIEWER" : "EDITOR";
  if (!roleAtLeast(role, minimum)) return access;
  return { room, role };
}

async function resolveRoomRole(
  workspaces: WorkspaceStore | undefined,
  room: RoomMetadata,
  callerId: string | undefined,
): Promise<"OWNER" | WorkspaceRole | null> {
  if (callerId && room.ownerId !== "anonymous" && room.ownerId === callerId)
    return "OWNER";
  if (!workspaces || !room.workspaceId || !callerId) return null;
  const ws = await workspaces.getWorkspace(room.workspaceId);
  if (!ws) return null;
  if (ws.ownerId === callerId) return "ADMIN";
  return (await workspaces.getMembership(room.workspaceId, callerId))?.role ??
    null;
}

/**
 * Mutation gate for room content (PATCH/DELETE room, image writes, snapshot
 * restore): the room owner always passes; otherwise a workspace ADMIN
 * passes. Anonymous callers and non-admin members get 401/403.
 */
async function requireRoomMutation(
  workspaces: WorkspaceStore | undefined,
  users: UserStore,
  room: RoomMetadata,
  headers: Record<string, string | undefined>,
  secret: string,
): Promise<
  | { owner: PublicUser; role: "OWNER" | "ADMIN"; claimed: boolean }
  | { status: 401 | 403; body: { error: string; code: string } }
> {
  const caller = await requestUser(users, headers, secret);
  if (!caller) {
    return {
      status: 401,
      body: { error: "Authentication required", code: "AUTH_REQUIRED" },
    };
  }
  if (room.ownerId !== "anonymous" && room.ownerId === caller.id) {
    return { owner: caller, role: "OWNER", claimed: false };
  }
  if (room.workspaceId && workspaces) {
    const ws = await workspaces.getWorkspace(room.workspaceId);
    const role: WorkspaceRole | null =
      ws?.ownerId === caller.id
        ? "ADMIN"
        : (
            await workspaces.getMembership(room.workspaceId, caller.id)
          )?.role ?? null;
    if (role === "ADMIN") {
      return { owner: caller, role: "ADMIN", claimed: false };
    }
  }
  if (room.ownerId === "anonymous" && !room.workspaceId) {
    return { owner: caller, role: "OWNER", claimed: true };
  }
  return {
    status: 403,
    body: { error: "Only the room owner may do this", code: "FORBIDDEN" },
  };
}

/** Public room shape for listings: lock state, never hashes. */
function toRoomSummary(room: RoomMetadata): {
  id: string;
  name: string;
  ownerId: string;
  tier: RoomMetadata["tier"];
  workspaceId: string | null;
  folderId: string | null;
  hasPassword: boolean;
} {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    tier: room.tier,
    workspaceId: room.workspaceId,
    folderId: room.folderId,
    hasPassword: room.hasPassword,
  };
}

export type ApiDeps = {
  /** Dependency probes for /readyz. Defaults to all-skipped (no deps). */
  health?: HealthChecks;
  /** Request/compile counters for /metrics. Defaults to a fresh instance. */
  metrics?: Metrics;
  /** Live gauges for /metrics. Defaults to the room manager + zero sockets. */
  getStats?: () => { activeRooms: number; wsConnections: number };
  /** Process start for uptime reporting. Defaults to now. */
  startedAt?: number;
  /** Release string for /health and /readyz. Defaults to package version. */
  version?: string;
  /** Billing provider and stores. */
  billing?: BillingDeps;
  /** Workspace/folder/membership store. Workspace routes 503 without it. */
  workspaces?: WorkspaceStore;
  /** Monthly AI generation counters. AI routes 503 without it. */
  aiUsage?: AiUsageStore;
  /** Audit event sink. Auditing is skipped without it (dev default). */
  audit?: AuditStore;
};

/** Post-auth landing path: same rules as the frontend AuthForm. */
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/board";
  return next.slice(0, 500);
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

type WorkspaceAccess =
  | { workspaceId: string; role: WorkspaceRole }
  | { status: 401 | 403 | 404; body: { error: string; code: string } };

/**
 * Role gate for workspace endpoints. Owners count as ADMIN; everyone else
 * needs a membership at or above `minRole`. Returns the resolved role for
 * downstream decisions (e.g. seat checks, room moves).
 */
async function requireWorkspaceRole(
  workspaces: WorkspaceStore,
  users: UserStore,
  workspaceId: string,
  headers: Record<string, string | undefined>,
  secret: string,
  minRole: WorkspaceRole,
): Promise<WorkspaceAccess> {
  const caller = await requestUser(users, headers, secret);
  if (!caller) {
    return {
      status: 401,
      body: { error: "Authentication required", code: "AUTH_REQUIRED" },
    };
  }
  const workspace = await workspaces.getWorkspace(workspaceId);
  if (!workspace) {
    return {
      status: 404,
      body: { error: "Workspace not found", code: "WORKSPACE_NOT_FOUND" },
    };
  }
  const role: WorkspaceRole | null =
    workspace.ownerId === caller.id
      ? "ADMIN"
      : ((await workspaces.getMembership(workspaceId, caller.id))?.role ??
        null);
  if (!roleAtLeast(role, minRole) || !role) {
    return {
      status: 403,
      body: { error: "Insufficient workspace role", code: "FORBIDDEN" },
    };
  }
  return { workspaceId, role };
}

/**
 * Seat budget for a workspace: the owner's subscription seats, defaulting
 * to 1 (owner only) without one. The owner occupies the first seat, so an
 * invite is allowed only while `1 + members < limit`. This is what finally
 * enforces the recorded-but-unenforced subscription `seats` count.
 */
async function workspaceSeatLimit(
  billing: BillingDeps | undefined,
  users: UserStore,
  ownerId: string,
): Promise<number> {
  if (!billing) return 1;
  const owner = await users.findById(ownerId);
  if (!owner) return 1;
  const sub = await billing.subscriptionStore.findByUserId(owner.id);
  return sub?.seats ?? 1;
}

const skippedCheck = async (): Promise<DependencyCheck> => ({
  status: "skipped",
});

export function createApiApp(
  manager: RoomManager,
  config: Config,
  images: ImageDeps,
  users: UserStore,
  deps: ApiDeps = {},
) {
  const ticketSecret = config.roomTicketSecret;
  if (!ticketSecret) throw new Error("roomTicketSecret is required");
  const health: HealthChecks = deps.health ?? {
    checkDatabase: skippedCheck,
    checkRedis: skippedCheck,
    checkCompiler: skippedCheck,
  };
  const metrics = deps.metrics ?? new Metrics();
  const startedAt = deps.startedAt ?? Date.now();
  const version = deps.version ?? appVersion();
  const getStats = deps.getStats ?? (() => ({
    activeRooms: manager.activeRoomCount,
    wsConnections: 0,
  }));
  return (
    new Elysia({ adapter: node() })
      // Never leak plain-text framework/driver errors (e.g. Prisma's
      // `Invalid ...` messages): clients parse every response as JSON, so an
      // unhandled throw must still be a JSON body with a stable shape.
      .onError(({ code, error, set }) => {
        if (code === "NOT_FOUND") {
          set.status = 404;
          return { error: "Not found", code: "NOT_FOUND" };
        }
        if (code === "VALIDATION" || code === "PARSE") {
          set.status = 400;
          return {
            error: "Invalid request",
            code: "VALIDATION_ERROR",
            issues: [
              {
                path: "",
                message:
                  error instanceof Error && error.message
                    ? error.message
                    : "Malformed request body",
                code: "custom",
              },
            ],
          };
        }
        if (error instanceof CompileRequestError) {
          set.status = error.status;
          return {
            error: error.message,
            code: error.code,
            details: error.details,
          };
        }
        const status =
          typeof set.status === "number" && set.status >= 400
            ? set.status
            : 500;
        set.status = status;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Internal server error";
        // Driver internals stay server-side in production; development keeps
        // the message so local setup problems (missing tables, DB down) are
        // diagnosable from the client.
        return {
          error:
            config.nodeEnv !== "production" || status < 500
              ? message
              : "Internal server error",
          code: status < 500 ? "BAD_REQUEST" : "INTERNAL_ERROR",
        };
      })
      .onRequest(({ set }) => {
        set.headers["access-control-allow-origin"] = "*";
        set.headers["access-control-allow-headers"] =
          "content-type, authorization, x-user-token";
        set.headers["access-control-allow-methods"] =
          "GET, POST, PATCH, DELETE, OPTIONS";
      })
      .onAfterResponse(({ request, set }) => {
        // Single counting point for every response, including errors:
        // route templates keep label cardinality bounded.
        try {
          metrics.incHttp(
            request.method,
            new URL(request.url).pathname,
            set.status,
          );
        } catch {
          // Metrics must never break responses (e.g. malformed URLs).
        }
      })
      .get("/health", () => ({
        status: "ok",
        version,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        activeRooms: manager.activeRoomCount,
      }))
      .get("/readyz", async ({ set }) => {
        // Readiness for orchestrators and external probers: every check is
        // bounded and never throws, so this endpoint always answers.
        const [database, redis, compiler] = await Promise.all([
          health.checkDatabase().catch(
            (): DependencyCheck => ({ status: "error", detail: "check failed" }),
          ),
          health.checkRedis().catch(
            (): DependencyCheck => ({ status: "error", detail: "check failed" }),
          ),
          health.checkCompiler().catch(
            (): DependencyCheck => ({ status: "error", detail: "check failed" }),
          ),
        ]);
        const readiness = summarizeReadiness(
          database,
          redis,
          compiler,
          imageStorageCheck(config),
          version,
          (Date.now() - startedAt) / 1000,
        );
        // A down database takes the server out of rotation; degraded deps
        // (Redis, compiler) stay routable by design.
        if (readiness.status === "down") set.status = 503;
        return readiness;
      })
      .get("/metrics", ({ set }) => {
        const stats = getStats();
        set.headers["content-type"] = "text/plain; version=0.0.4";
        return metrics.render({
          activeRooms: stats.activeRooms,
          wsConnections: stats.wsConnections,
          uptimeSec: (Date.now() - startedAt) / 1000,
        });
      })
      .post("/api/rooms", async ({ body, headers, set }) => {
        const parsed = CreateRoomSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          if (parsed.error.issues.some((issue) => issue.path[0] === "password"))
            return {
              error: "Password must be at least 8 characters",
              code: "INVALID_PASSWORD",
            };
          return validationError(parsed.error);
        }
        const input = parsed.data;
        // Authenticated users own their rooms and inherit their tier unless
        // they explicitly choose otherwise. Client identity and tier are
        // never taken at face value: ownerId is forced to the caller, and an
        // explicitly requested tier above the caller's is rejected.
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        const callerTier = user?.tier ?? "COMMUNITY";
        if (input.tier && TIER_RANK[input.tier] > TIER_RANK[callerTier]) {
          set.status = 403;
          return {
            error: `The '${input.tier}' tier requires a Pro or Enterprise account`,
            code: "TIER_UPGRADE_REQUIRED",
            details: { tier: input.tier },
          };
        }
        // Anonymous callers must not be able to claim an arbitrary ownerId
        // (impersonating another user's rooms for griefing or tier games):
        // ownership is forced to "anonymous" and claimed later via PATCH.
        // Workspace rooms additionally require membership: anonymous
        // callers can never create into a workspace.
        let workspaceId: string | null = null;
        if (input.workspaceId) {
          if (!user) {
            set.status = 401;
            return {
              error: "Authentication required",
              code: "AUTH_REQUIRED",
            };
          }
          if (!deps.workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const wsAccess = await requireWorkspaceRole(
            deps.workspaces,
            users,
            input.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "EDITOR",
          );
          if ("body" in wsAccess) {
            set.status = wsAccess.status;
            return wsAccess.body;
          }
          workspaceId = input.workspaceId;
        }
        const room = await manager.createRoom(
          {
            name: input.name,
            ownerId: user ? user.id : "anonymous",
            tier: input.tier ?? callerTier,
            workspaceId,
            folderId: null,
          },
          input.password,
        );
        set.status = 201;
        return room;
      })
      .get("/api/rooms/:roomId", async ({ params, headers, query, set }) => {
        const access = await requestRoomAccess(
          manager,
          deps.workspaces,
          users,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
          "read",
        );
        if ("body" in access) {
          set.status = access.status;
          return access.body;
        }
        return access.room;
      })
      .post("/api/rooms/:roomId/unlock", async ({ params, body, set }) => {
        const room = await manager.getRoomMetadata(params.roomId);
        if (!room) {
          set.status = 404;
          return { error: "Room not found", code: "ROOM_NOT_FOUND" };
        }
        if (!room.hasPassword) {
          // Open rooms need no ticket — minting one would create a capability
          // that survives a later password being set.
          set.status = 400;
          return { error: "Room is not locked", code: "ROOM_NOT_LOCKED" };
        }
        const parsed = UnlockRoomSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        const input = parsed.data;
        if (
          input.password === undefined ||
          !(await manager.verifyRoomPassword(room.id, input.password))
        ) {
          set.status = 403;
          return { error: "Invalid password", code: "INVALID_PASSWORD" };
        }
        const version = (await manager.getPasswordVersion(room.id)) ?? 0;
        const { ticket, expiresIn } = issueTicket(
          ticketSecret,
          room.id,
          version,
          config.roomTicketTtlSec,
        );
        return { ticket, expiresIn, roomId: room.id };
      })
      .delete("/api/rooms/:roomId", async ({ params, headers, query, set }) => {
        const access = await requestRoomAccess(
          manager,
          deps.workspaces,
          users,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
          "write",
        );
        if ("body" in access) {
          set.status = access.status;
          return access.body;
        }
        // Workspace ADMINs may delete workspace rooms; everyone else
        // needs room ownership (unchanged for personal rooms).
        const ownership = await requireRoomMutation(
          deps.workspaces,
          users,
          access.room,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if ("body" in ownership) {
          set.status = ownership.status;
          return ownership.body;
        }
        const deleter = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        await manager.deleteRoom(access.room.id);
        await recordAudit(deps.audit, {
          actorId: deleter?.id ?? null,
          workspaceId: access.room.workspaceId,
          action: "room.delete",
          target: access.room.id,
        });
        set.status = 204;
        return;
      })
      .patch(
        "/api/rooms/:roomId",
        async ({ params, body, headers, query, set }) => {
          const access = await requestRoomAccess(
            manager,
            deps.workspaces,
            users,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
            "write",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const parsed = UpdateRoomSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            if (
              parsed.error.issues.some((issue) => issue.path[0] === "password")
            )
              return {
                error: "Password must be at least 8 characters",
                code: "INVALID_PASSWORD",
              };
            return validationError(parsed.error);
          }
          const input = parsed.data;
          const ownership = await requireRoomMutation(
            deps.workspaces,
            users,
            access.room,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          if ("body" in ownership) {
            set.status = ownership.status;
            return ownership.body;
          }
          if (
            input.tier &&
            TIER_RANK[input.tier] > TIER_RANK[ownership.owner.tier]
          ) {
            set.status = 403;
            return {
              error: `The '${input.tier}' tier requires a Pro or Enterprise account`,
              code: "TIER_UPGRADE_REQUIRED",
              details: { tier: input.tier },
            };
          }
          // Anonymous rooms are claimed by the first authenticated patch;
          // only established owners may transfer to someone else, and only
          // to a real user — otherwise rooms could be orphaned to phantom
          // ids no one can ever administer.
          let ownerId = access.room.ownerId;
          if (ownerId === "anonymous") {
            ownerId = ownership.owner.id;
          } else if (input.ownerId && input.ownerId !== ownerId) {
            const target = await users.findById(input.ownerId);
            if (!target) {
              set.status = 400;
              return {
                error: "Unknown user for owner transfer",
                code: "INVALID_OWNER",
              };
            }
            ownerId = target.id;
          }
          const updated = await manager.updateRoom(
            access.room.id,
            { name: input.name, ownerId, tier: input.tier },
            input.password,
          );
          if (!updated) {
            set.status = 404;
            return { error: "Room not found", code: "ROOM_NOT_FOUND" };
          }
          return updated;
        },
      )
      .post("/api/auth/register", async ({ body, set }) => {
        const parsed = RegisterUserSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          if (parsed.error.issues.some((issue) => issue.path[0] === "password"))
            return {
              error: "Password must be at least 8 characters",
              code: "INVALID_PASSWORD",
            };
          return validationError(parsed.error);
        }
        const input = parsed.data;
        const user = await users.createUser({
          email: input.email,
          name: input.name,
          passwordHash: hashPassword(input.password),
        });
        if (!user) {
          set.status = 409;
          return { error: "Email is already registered", code: "USER_EXISTS" };
        }
        const { token, expiresIn } = issueUserToken(
          ticketSecret,
          user.id,
          config.userTokenTtlSec,
        );
        set.status = 201;
        return { user, token, expiresIn };
      })
      .post("/api/auth/login", async ({ body, set }) => {
        const parsed = LoginUserSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        const input = parsed.data;
        const user = await users.findByEmail(input.email);
        const hash = user ? await users.getPasswordHash(user.id) : null;
        if (!user || !hash || !verifyPassword(input.password, hash)) {
          // Same response for unknown emails and wrong passwords so accounts
          // cannot be enumerated.
          set.status = 401;
          return {
            error: "Invalid email or password",
            code: "INVALID_CREDENTIALS",
          };
        }
        const { token, expiresIn } = issueUserToken(
          ticketSecret,
          user.id,
          config.userTokenTtlSec,
        );
        return { user, token, expiresIn };
      })
      .get("/api/auth/me", async ({ headers, set }) => {
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Invalid or expired token", code: "INVALID_TOKEN" };
        }
        return user;
      })
      .get("/api/auth/sso/start", async ({ query, set }) => {
        const oidc = oidcConfig(config);
        if (!oidc) {
          set.status = 503;
          return {
            error: "Single sign-on is not configured",
            code: "SSO_NOT_CONFIGURED",
          };
        }
        const params = query as Record<string, unknown>;
        const next = sanitizeNext(
          typeof params.next === "string" ? params.next : null,
        );
        let discovery;
        try {
          discovery = await discoveryDocument(oidc.issuer);
        } catch {
          set.status = 502;
          return {
            error: "Identity provider is unreachable",
            code: "SSO_PROVIDER_ERROR",
          };
        }
        const verifier = newCodeVerifier();
        const sealed = sealState(ticketSecret, {
          nonce: newState(),
          next,
          verifier,
          exp: Math.floor(Date.now() / 1000) + 600,
        });
        const authorize = new URL(discovery.authorization_endpoint);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("client_id", oidc.clientId);
        authorize.searchParams.set("redirect_uri", oidc.redirectUrl);
        authorize.searchParams.set("scope", "openid email profile");
        authorize.searchParams.set("state", sealed);
        authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
        authorize.searchParams.set("code_challenge_method", "S256");
        // Login-CSRF defense: the sealed state must round-trip both as a
        // query param AND as an httpOnly cookie (checked on callback).
        set.headers["set-cookie"] =
          `eunoia_oauth_state=${sealed}; Path=/api/auth/sso/callback; Max-Age=600; HttpOnly; SameSite=Lax` +
          (config.nodeEnv === "production" ? "; Secure" : "");
        return { url: authorize.toString() };
      })
      .get("/api/auth/sso/callback", async ({ query, headers, set }) => {
        const oidc = oidcConfig(config);
        const frontendBase = (config.frontendBaseUrl ?? "").replace(/\/+$/, "");
        const fail = (code: string) =>
          Response.redirect(
            `${frontendBase}/login?error=${code}`,
            302,
          );
        if (!oidc || !frontendBase) {
          set.status = 503;
          return {
            error: "Single sign-on is not configured",
            code: "SSO_NOT_CONFIGURED",
          };
        }
        const params = query as Record<string, unknown>;
        const code = typeof params.code === "string" ? params.code : "";
        const state = typeof params.state === "string" ? params.state : "";
        const cookieHeader = headers.cookie ?? headers.Cookie;
        const cookieState = parseCookies(
          typeof cookieHeader === "string" ? cookieHeader : "",
        )["eunoia_oauth_state"];
        if (!code || !state || cookieState !== state) {
          return fail("sso_state_mismatch");
        }
        const opened = openState(ticketSecret, state);
        if (!opened) {
          return fail("sso_state_expired");
        }
        try {
          const discovery = await discoveryDocument(oidc.issuer);
          const { idToken } = await exchangeCode(
            oidc,
            discovery,
            code,
            opened.verifier,
          );
          const identity = await verifyIdToken(oidc, discovery, idToken);
          const user = await users.findOrCreateOAuthUser({
            provider: oidc.issuer,
            subject: identity.subject,
            email: identity.email,
            name: identity.name,
          });
          const session = issueUserToken(
            ticketSecret,
            user.id,
            config.userTokenTtlSec,
          );
          await recordAudit(deps.audit, {
            actorId: user.id,
            action: "auth.sso.login",
          });
          const clearCookie =
            "eunoia_oauth_state=; Path=/api/auth/sso/callback; Max-Age=0; HttpOnly; SameSite=Lax";
          set.headers["set-cookie"] = clearCookie;
          return Response.redirect(
            `${frontendBase}/sso/callback?token=${session.token}&expiresIn=${session.expiresIn}&next=${encodeURIComponent(opened.next)}`,
            302,
          );
        } catch {
          return fail("sso_failed");
        }
      })
      .post("/api/compile", async ({ body, headers, query, set }) => {
        const parsed = CompileRequestSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          const engineIssue = parsed.error.issues.find(
            (issue) => issue.path[0] === "engine",
          );
          if (engineIssue) {
            const engine =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>).engine
                : undefined;
            return {
              error: `Unknown layout engine: ${JSON.stringify(engine)}`,
              code: "INVALID_ENGINE",
              details: { engine },
            };
          }
          return validationError(parsed.error);
        }
        const input = parsed.data;
        const engine = input.engine ?? "dagre";
        // Tier is resolved server-side and never trusted from the client: the
        // higher of the room's stored tier and the caller's user tier wins,
        // defaulting to COMMUNITY. Locked rooms additionally require a ticket.
        const caller = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        let tier: Tier = caller?.tier ?? "COMMUNITY";
        if (input.roomId) {
          const access = await requestRoomAccess(
            manager,
            deps.workspaces,
            users,
            input.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
            "read",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          tier = higherTier(access.room.tier, tier);
        }
        try {
          const result = await compileD2(
            { source: input.source, engine },
            {
              compilerUrl: config.d2CompilerUrl,
              isDevelopment: config.nodeEnv !== "production",
              tier,
              nodeLimit: config.d2CommunityNodeLimit,
            },
          );
          metrics.incCompile(
            engine,
            "placeholder" in result && result.placeholder
              ? "placeholder"
              : "success",
          );
          return result;
        } catch (error) {
          if (error instanceof CompileRequestError) {
            metrics.incCompile(engine, error.code);
            set.status = error.status;
            return {
              error: error.message,
              code: error.code,
              details: error.details,
            };
          }
          metrics.incCompile(engine, "error");
          set.status = 502;
          return {
            error:
              error instanceof Error ? error.message : "D2 compiler failed",
            code: "D2_COMPILER_UNAVAILABLE",
          };
        }
      })
      .post("/api/ai/generate", async ({ body, headers, query, set }) => {
        if (!config.aiApiKey) {
          set.status = 503;
          return {
            error: "AI generation is not configured",
            code: "AI_NOT_CONFIGURED",
          };
        }
        const aiUsage = deps.aiUsage;
        if (!aiUsage) {
          set.status = 503;
          return {
            error: "AI generation is not configured",
            code: "AI_NOT_CONFIGURED",
          };
        }
        const parsed = GenerateDiagramSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        const caller = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!caller) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        // Tier travels like compile: the higher of room and caller tier,
        // which also selects the monthly quota below.
        let tier: Tier = caller.tier;
        if (parsed.data.roomId) {
          const access = await requestRoomAccess(
            manager,
            deps.workspaces,
            users,
            parsed.data.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
            "read",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          tier = higherTier(access.room.tier, tier);
        }
        const used = await aiUsage.getUsage(caller.id, currentMonth());
        const quota = AI_QUOTA[tier];
        if (used >= quota) {
          metrics.incAi("quota_exhausted");
          set.status = 429;
          return {
            error: `Monthly AI quota exhausted (${used}/${quota}). Upgrade for a higher budget.`,
            code: "QUOTA_EXHAUSTED",
          };
        }
        try {
          const result = await generateD2(
            parsed.data.prompt,
            config,
            parsed.data.model,
          );
          // Count only successful generations against the quota.
          await aiUsage.incrementUsage(caller.id, currentMonth());
          metrics.incAi("success");
          return { ...result, quota: { used: used + 1, limit: quota } };
        } catch (error) {
          metrics.incAi("error");
          const message =
            error instanceof Error ? error.message : "AI generation failed";
          const configured = message === "AI is not configured";
          set.status = configured ? 503 : 502;
          return {
            error: message,
            code: configured ? "AI_NOT_CONFIGURED" : "AI_PROVIDER_ERROR",
          };
        }
      })
      .post(
        "/api/rooms/:roomId/images/request-upload",
        async ({ params, body, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const room = access.room;
          const r2 = images.r2;
          if (!r2) {
            set.status = 503;
            return {
              error: "Image storage is not configured",
              code: "R2_NOT_CONFIGURED",
            };
          }
          const parsed = ImageRequestUploadSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const input = parsed.data;
          const key = buildImageKey(room.id, input.contentType);
          try {
            const { url, expiresIn } = await r2.presignUpload(
              key,
              input.contentType,
              config.r2UrlExpiresInSec,
            );
            return {
              key,
              uploadUrl: url,
              expiresIn,
              contentType: input.contentType,
              kind: input.kind,
            };
          } catch (error) {
            return r2Error(set, error);
          }
        },
      )
      .post(
        "/api/rooms/:roomId/images/confirm",
        async ({ params, body, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const room = access.room;
          const r2 = images.r2;
          if (!r2) {
            set.status = 503;
            return {
              error: "Image storage is not configured",
              code: "R2_NOT_CONFIGURED",
            };
          }
          const parsed = ImageConfirmSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const input = parsed.data;
          if (!keyBelongsToRoom(input.key, room.id)) {
            set.status = 400;
            return {
              error: "Key does not belong to this room",
              code: "INVALID_KEY",
            };
          }
          let head: ObjectHead | null;
          try {
            head = await r2.head(input.key);
          } catch (error) {
            return r2Error(set, error);
          }
          if (!head) {
            set.status = 404;
            return { error: "Upload not found", code: "OBJECT_NOT_FOUND" };
          }
          const contentType = ImageContentTypeSchema.safeParse(
            head.contentType ?? input.contentType,
          );
          if (!contentType.success) {
            set.status = 400;
            return {
              error: "Unsupported content type",
              code: "INVALID_CONTENT_TYPE",
            };
          }
          const size = head.size ?? input.size;
          if (
            typeof size !== "number" ||
            !Number.isInteger(size) ||
            size <= 0
          ) {
            set.status = 400;
            return { error: "Size is required", code: "INVALID_SIZE" };
          }
          if (size > config.r2MaxUploadBytes) {
            await r2.delete(input.key).catch(() => undefined);
            set.status = 413;
            return {
              error: `Upload exceeds the ${config.r2MaxUploadBytes} byte limit`,
              code: "UPLOAD_TOO_LARGE",
            };
          }
          if (await images.imageStore.findByKey(input.key)) {
            set.status = 409;
            return {
              error: "Image already confirmed",
              code: "IMAGE_ALREADY_CONFIRMED",
            };
          }
          try {
            const publicUrl = r2.publicUrl(input.key);
            // The stored `url` is only a fallback: without a public base URL
            // this presigned link expires, so list responses resolve a fresh
            // URL per item at read time (see the list handler below).
            const url =
              publicUrl ??
              (await r2.presignDownload(input.key, config.r2UrlExpiresInSec))
                .url;
            set.status = 201;
            return await images.imageStore.createImage({
              roomId: room.id,
              key: input.key,
              url,
              contentType: contentType.data,
              size,
              kind: input.kind,
            });
          } catch (error) {
            if ((error as { code?: string }).code === "P2002") {
              set.status = 409;
              return {
                error: "Image already confirmed",
                code: "IMAGE_ALREADY_CONFIRMED",
              };
            }
            return r2Error(set, error);
          }
        },
      )
      .get(
        "/api/rooms/:roomId/images",
        async ({ params, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const room = access.room;
          // The room ticket travels in the query alongside real params but is
          // not part of the schemas (which are strict): strip it first.
          const { ticket: _ticket, ...listQuery } = query as Record<
            string,
            unknown
          >;
          const parsed = ImageListQuerySchema.safeParse(listQuery);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const stored = await images.imageStore.listImages(
            room.id,
            parsed.data.kind,
          );
          // Stored `url` values may be expired presigned links (see confirm).
          // Resolve fresh URLs at read time so clients never render dead
          // images; public URLs are stable and returned as stored.
          const r2 = images.r2;
          if (!r2) return stored;
          return await Promise.all(
            stored.map(async (image) => {
              const publicUrl = r2.publicUrl(image.key);
              if (publicUrl)
                return publicUrl === image.url
                  ? image
                  : { ...image, url: publicUrl };
              try {
                const { url } = await r2.presignDownload(
                  image.key,
                  config.r2UrlExpiresInSec,
                );
                return { ...image, url };
              } catch {
                return image;
              }
            }),
          );
        },
      )
      .get(
        "/api/rooms/:roomId/images/:imageId/url",
        async ({ params, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const image = await images.imageStore.getImage(params.imageId);
          if (!image || image.roomId !== params.roomId) {
            set.status = 404;
            return { error: "Image not found", code: "IMAGE_NOT_FOUND" };
          }
          const r2 = images.r2;
          if (!r2) {
            set.status = 503;
            return {
              error: "Image storage is not configured",
              code: "R2_NOT_CONFIGURED",
            };
          }
          try {
            const publicUrl = r2.publicUrl(image.key);
            if (publicUrl) return { url: publicUrl, expiresIn: null };
            return await r2.presignDownload(
              image.key,
              config.r2UrlExpiresInSec,
            );
          } catch (error) {
            return r2Error(set, error);
          }
        },
      )
      .delete(
        "/api/rooms/:roomId/images/:imageId",
        async ({ params, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const image = await images.imageStore.getImage(params.imageId);
          if (!image || image.roomId !== params.roomId) {
            set.status = 404;
            return { error: "Image not found", code: "IMAGE_NOT_FOUND" };
          }
          const r2 = images.r2;
          if (!r2) {
            set.status = 503;
            return {
              error: "Image storage is not configured",
              code: "R2_NOT_CONFIGURED",
            };
          }
          try {
            await r2.delete(image.key);
          } catch (error) {
            // S3 deletes are idempotent, so absence still proceeds to row
            // cleanup; anything else aborts before the metadata is touched.
            if (!isR2NotFound(error)) return r2Error(set, error);
          }
          await images.imageStore.deleteImage(image.id);
          set.status = 204;
          return;
        },
      )
      .get(
        "/api/rooms/:roomId/images/:imageId/bytes",
        async ({ params, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const image = await images.imageStore.getImage(params.imageId);
          if (!image || image.roomId !== params.roomId) {
            set.status = 404;
            return { error: "Image not found", code: "IMAGE_NOT_FOUND" };
          }
          if (!keyBelongsToRoom(image.key, params.roomId)) {
            set.status = 400;
            return { error: "Key does not belong to this room", code: "INVALID_KEY" };
          }
          const r2 = images.r2;
          if (!r2) {
            set.status = 503;
            return {
              error: "Image storage is not configured",
              code: "R2_NOT_CONFIGURED",
            };
          }
          try {
            const object = await r2.getObject(image.key);
            if (!object) {
              set.status = 404;
              return { error: "Object not found", code: "OBJECT_NOT_FOUND" };
            }
            const contentType =
              object.contentType || image.contentType || "application/octet-stream";
            // Same-origin bytes for export rasterization: browsers can fetch
            // without CORS taint, and expired presigned URLs never surface.
            return new Response(object.body, {
              status: 200,
              headers: {
                "content-type": contentType,
                "content-length": String(object.body.byteLength),
                "cache-control": "private, max-age=300",
                "access-control-allow-origin": "*",
              },
            });
          } catch (error) {
            return r2Error(set, error);
          }
        },
      )
      .get(
        "/api/rooms/:roomId/snapshots",
        async ({ params, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const room = access.room;
          // See the images list handler: the room ticket is stripped before
          // strict query validation.
          const { ticket: _snapshotTicket, ...snapshotQuery } = query as Record<
            string,
            unknown
          >;
          const parsed = SnapshotQuerySchema.safeParse(snapshotQuery);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const snapshots = await manager.listRoomSnapshots(room.id, {
            limit: parsed.data.limit,
            before: parsed.data.before,
          });
          return snapshots.map(({ id, docVersion, createdAt }) => ({
            id,
            docVersion,
            createdAt,
          }));
        },
      )
      .post(
        "/api/rooms/:roomId/snapshots/:snapshotId/restore",
        async ({ params, headers, query, set }) => {
          const access = await requestAccess(
            manager,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          // Deliberately ticket-gated only (same bar as editing via sync):
          // open rooms are collaboratively editable by anyone holding the
          // link, so requiring login here would break anonymous restores.
          // Locked rooms still require their ticket via requestAccess above.
          if (
            await manager.restoreRoomSnapshot(params.roomId, params.snapshotId)
          ) {
            const restorer = await requestUser(
              users,
              headers as Record<string, string | undefined>,
              ticketSecret,
            );
            await recordAudit(deps.audit, {
              actorId: restorer?.id ?? null,
              workspaceId: access.room.workspaceId,
              action: "snapshot.restore",
              target: params.snapshotId,
            });
            return {
              restored: params.snapshotId,
              restoredAt: new Date().toISOString(),
            };
          }
          set.status = 404;
          return { error: "Snapshot not found", code: "SNAPSHOT_NOT_FOUND" };
        },
      )
      .post("/api/workspaces", async ({ body, headers, set }) => {
        const workspaces = deps.workspaces;
        if (!workspaces) {
          set.status = 503;
          return {
            error: "Workspaces are not configured",
            code: "WORKSPACES_NOT_CONFIGURED",
          };
        }
        const parsed = CreateWorkspaceSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        if (
          parsed.data.tier &&
          TIER_RANK[parsed.data.tier] > TIER_RANK[user.tier]
        ) {
          set.status = 403;
          return {
            error: `The '${parsed.data.tier}' tier requires a Pro or Enterprise account`,
            code: "TIER_UPGRADE_REQUIRED",
            details: { tier: parsed.data.tier },
          };
        }
        const workspace = await workspaces.createWorkspace({
          name: parsed.data.name,
          ownerId: user.id,
          tier: parsed.data.tier ?? user.tier,
        });
        set.status = 201;
        return { workspace, role: "ADMIN" as const };
      })
      .get("/api/workspaces", async ({ headers, set }) => {
        const workspaces = deps.workspaces;
        if (!workspaces) {
          set.status = 503;
          return {
            error: "Workspaces are not configured",
            code: "WORKSPACES_NOT_CONFIGURED",
          };
        }
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        return {
          workspaces: await workspaces.listWorkspacesForUser(user.id),
        };
      })
      .get(
        "/api/workspaces/:workspaceId",
        async ({ params, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const access = await requireWorkspaceRole(
            workspaces,
            users,
            params.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "VIEWER",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const workspace = await workspaces.getWorkspace(params.workspaceId);
          const folders = await workspaces.listFolders(params.workspaceId);
          const rooms = await manager.listRooms({
            workspaceId: params.workspaceId,
          });
          return {
            workspace,
            role: access.role,
            folders,
            rooms: rooms.map((room) => ({
              id: room.id,
              name: room.name,
              ownerId: room.ownerId,
              tier: room.tier,
              folderId: room.folderId,
              hasPassword: room.hasPassword,
            })),
          };
        },
      )
      .delete(
        "/api/workspaces/:workspaceId",
        async ({ params, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const user = await requestUser(
            users,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          if (!user) {
            set.status = 401;
            return { error: "Authentication required", code: "AUTH_REQUIRED" };
          }
          const workspace = await workspaces.getWorkspace(params.workspaceId);
          if (!workspace) {
            set.status = 404;
            return {
              error: "Workspace not found",
              code: "WORKSPACE_NOT_FOUND",
            };
          }
          // Deletion is owner-only: ADMIN members manage people and rooms,
          // but only the owner may dissolve the workspace itself. Rooms
          // detach (SetNull) rather than being deleted with it.
          if (workspace.ownerId !== user.id) {
            set.status = 403;
            return {
              error: "Only the workspace owner may delete it",
              code: "FORBIDDEN",
            };
          }
          await workspaces.deleteWorkspace(params.workspaceId);
          await recordAudit(deps.audit, {
            actorId: user.id,
            workspaceId: params.workspaceId,
            action: "workspace.delete",
          });
          set.status = 204;
          return;
        },
      )
      .post(
        "/api/workspaces/:workspaceId/folders",
        async ({ params, body, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const parsed = CreateFolderSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const access = await requireWorkspaceRole(
            workspaces,
            users,
            params.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "EDITOR",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const folder = await workspaces.createFolder(
            params.workspaceId,
            parsed.data.name,
          );
          set.status = 201;
          return { folder };
        },
      )
      .post(
        "/api/workspaces/:workspaceId/members",
        async ({ params, body, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const parsed = InviteMemberSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const access = await requireWorkspaceRole(
            workspaces,
            users,
            params.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "ADMIN",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const invitee = parsed.data.userId
            ? await users.findById(parsed.data.userId)
            : await users.findByEmail(parsed.data.email as string);
          if (!invitee) {
            set.status = 404;
            return {
              error: "Invited user not found",
              code: "USER_NOT_FOUND",
            };
          }
          const workspace = await workspaces.getWorkspace(params.workspaceId);
          // Seat enforcement: the owner's subscription seats cover the
          // owner plus every membership. Community (no subscription) fits
          // the owner alone, so team invites are the Pro upsell moment.
          const limit = await workspaceSeatLimit(
            deps.billing,
            users,
            workspace?.ownerId ?? "",
          );
          const alreadyMember = await workspaces.getMembership(
            params.workspaceId,
            invitee.id,
          );
          const used =
            1 + (await workspaces.countMembers(params.workspaceId));
          if (!alreadyMember && used >= limit) {
            set.status = 403;
            return {
              error: `Seat limit reached (${used}/${limit}). Upgrade the workspace owner's subscription to invite more members.`,
              code: "SEATS_EXHAUSTED",
            };
          }
          const membership = await workspaces.upsertMembership({
            workspaceId: params.workspaceId,
            userId: invitee.id,
            role: parsed.data.role,
          });
          const inviter = await requestUser(
            users,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          await recordAudit(deps.audit, {
            actorId: inviter?.id ?? null,
            workspaceId: params.workspaceId,
            action: "workspace.member.invite",
            target: invitee.id,
          });
          set.status = 201;
          return { membership };
        },
      )
      .get(
        "/api/workspaces/:workspaceId/members",
        async ({ params, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const access = await requireWorkspaceRole(
            workspaces,
            users,
            params.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "VIEWER",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const workspace = await workspaces.getWorkspace(params.workspaceId);
          return {
            // The owner is an implicit ADMIN without a membership row.
            members: [
              ...(workspace
                ? [
                    {
                      workspaceId: params.workspaceId,
                      userId: workspace.ownerId,
                      role: "ADMIN" as const,
                    },
                  ]
                : []),
              ...((await workspaces.listMembers(params.workspaceId)).filter(
                (member) => member.userId !== workspace?.ownerId,
              )),
            ],
          };
        },
      )
      .patch(
        "/api/workspaces/:workspaceId/members/:userId",
        async ({ params, body, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const parsed = UpdateMemberSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const access = await requireWorkspaceRole(
            workspaces,
            users,
            params.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "ADMIN",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          const existing = await workspaces.getMembership(
            params.workspaceId,
            params.userId,
          );
          if (!existing) {
            set.status = 404;
            return {
              error: "Membership not found",
              code: "MEMBERSHIP_NOT_FOUND",
            };
          }
          const updatedMembership = await workspaces.upsertMembership({
            workspaceId: params.workspaceId,
            userId: params.userId,
            role: parsed.data.role,
          });
          const roleEditor = await requestUser(
            users,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          await recordAudit(deps.audit, {
            actorId: roleEditor?.id ?? null,
            workspaceId: params.workspaceId,
            action: "workspace.member.update",
            target: params.userId,
          });
          return { membership: updatedMembership };
        },
      )
      .delete(
        "/api/workspaces/:workspaceId/members/:userId",
        async ({ params, headers, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const user = await requestUser(
            users,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          if (!user) {
            set.status = 401;
            return { error: "Authentication required", code: "AUTH_REQUIRED" };
          }
          const workspace = await workspaces.getWorkspace(params.workspaceId);
          if (!workspace) {
            set.status = 404;
            return {
              error: "Workspace not found",
              code: "WORKSPACE_NOT_FOUND",
            };
          }
          // Members may leave themselves; removing anyone else needs ADMIN.
          // The owner is not a membership row and can never be removed —
          // ownership transfers via room PATCH, workspace deletion dissolves.
          const selfLeave = params.userId === user.id;
          if (!selfLeave) {
            const access = await requireWorkspaceRole(
              workspaces,
              users,
              params.workspaceId,
              headers as Record<string, string | undefined>,
              ticketSecret,
              "ADMIN",
            );
            if ("body" in access) {
              set.status = access.status;
              return access.body;
            }
          }
          if (params.userId === workspace.ownerId) {
            set.status = 400;
            return {
              error: "The workspace owner cannot be removed",
              code: "CANNOT_REMOVE_OWNER",
            };
          }
          await workspaces.removeMembership(
            params.workspaceId,
            params.userId,
          );
          await recordAudit(deps.audit, {
            actorId: user.id,
            workspaceId: params.workspaceId,
            action: "workspace.member.remove",
            target: params.userId,
          });
          set.status = 204;
          return;
        },
      )
      .get("/api/rooms", async ({ headers, query, set }) => {
        const access = await (async () => {
          const user = await requestUser(
            users,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          if (!user)
            return {
              status: 401 as const,
              body: {
                error: "Authentication required",
                code: "AUTH_REQUIRED",
              },
            };
          return { user };
        })();
        if ("body" in access) {
          set.status = access.status;
          return access.body;
        }
        const { ticket: _ticket, ...listQuery } = query as Record<
          string,
          unknown
        >;
        const parsed = RoomListQuerySchema.safeParse(listQuery);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        if (parsed.data.workspaceId) {
          // Workspace rooms: any membership (or ownership) may list.
          const roleAccess = await requireWorkspaceRole(
            deps.workspaces as WorkspaceStore,
            users,
            parsed.data.workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "VIEWER",
          );
          if ("body" in roleAccess) {
            if (!deps.workspaces) {
              set.status = 503;
              return {
                error: "Workspaces are not configured",
                code: "WORKSPACES_NOT_CONFIGURED",
              };
            }
            set.status = roleAccess.status;
            return roleAccess.body;
          }
          const rooms = await manager.listRooms({
            workspaceId: parsed.data.workspaceId,
          });
          return { rooms: rooms.map(toRoomSummary) };
        }
        // Personal rooms: owned by the caller and outside any workspace.
        const rooms = await manager.listRooms({ ownerId: access.user.id });
        return {
          rooms: rooms
            .filter((room) => room.workspaceId === null)
            .map(toRoomSummary),
        };
      })
      .post(
        "/api/rooms/:roomId/move",
        async ({ params, body, headers, query, set }) => {
          const workspaces = deps.workspaces;
          if (!workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          // Ticket first, then identity: owners/admins act on locked
          // rooms without a ticket by proving who they are instead of
          // presenting the room capability.
          const access = await requestRoomAccess(
            manager,
            workspaces,
            users,
            params.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
            "write",
          );
          let room: RoomMetadata;
          if ("body" in access) {
            if (access.status !== 401) {
              set.status = access.status;
              return access.body;
            }
            const meta = await manager.getRoomMetadata(params.roomId);
            if (!meta) {
              set.status = 404;
              return { error: "Room not found", code: "ROOM_NOT_FOUND" };
            }
            const mutation = await requireRoomMutation(
              workspaces,
              users,
              meta,
              headers as Record<string, string | undefined>,
              ticketSecret,
            );
            if ("body" in mutation) {
              set.status = mutation.status;
              return mutation.body;
            }
            room = meta;
          } else {
            room = access.room;
          }
          const parsed = MoveRoomSchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return validationError(parsed.error);
          }
          const user = await requestUser(
            users,
            headers as Record<string, string | undefined>,
            ticketSecret,
          );
          // Moving OUT to personal requires room ownership; moving IN
          // requires EDITOR+ in the target (plus ownership of personal
          // rooms, or ADMIN in the source workspace for team rooms).
          if (parsed.data.workspaceId === null) {
            const mutation = await requireRoomMutation(
              workspaces,
              users,
              room,
              headers as Record<string, string | undefined>,
              ticketSecret,
            );
            if ("body" in mutation) {
              set.status = mutation.status;
              return mutation.body;
            }
          } else {
            if (!user) {
              set.status = 401;
              return {
                error: "Authentication required",
                code: "AUTH_REQUIRED",
              };
            }
            const target = await requireWorkspaceRole(
              workspaces,
              users,
              parsed.data.workspaceId,
              headers as Record<string, string | undefined>,
              ticketSecret,
              "EDITOR",
            );
            if ("body" in target) {
              set.status = target.status;
              return target.body;
            }
            if (room.workspaceId) {
              const source = await requireWorkspaceRole(
                workspaces,
                users,
                room.workspaceId,
                headers as Record<string, string | undefined>,
                ticketSecret,
                "ADMIN",
              );
              const ownsRoom =
                room.ownerId !== "anonymous" &&
                room.ownerId === user.id;
              if ("body" in source && !ownsRoom) {
                set.status = source.status;
                return source.body;
              }
            } else {
              const mutation = await requireRoomMutation(
                workspaces,
                users,
                room,
                headers as Record<string, string | undefined>,
                ticketSecret,
              );
              if ("body" in mutation) {
                set.status = mutation.status;
                return mutation.body;
              }
            }
          }
          if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
            const folder = await workspaces.getFolder(parsed.data.folderId);
            const targetWs =
              parsed.data.workspaceId ?? room.workspaceId;
            if (!folder || folder.workspaceId !== targetWs) {
              set.status = 400;
              return {
                error: "Folder does not belong to the target workspace",
                code: "INVALID_FOLDER",
              };
            }
          }
          const updated = await manager.updateRoom(room.id, {
            workspaceId: parsed.data.workspaceId,
            // Clearing the workspace also clears the folder; moving rooms
            // keep their folder only when it belongs to the target.
            folderId:
              parsed.data.workspaceId === null
                ? null
                : (parsed.data.folderId ?? room.folderId),
          });
          if (!updated) {
            set.status = 404;
            return { error: "Room not found", code: "ROOM_NOT_FOUND" };
          }
          return updated;
        },
      )
      .get("/api/billing/prices", async ({ set }) => {
        const billing = deps.billing;
        if (!billing) {
          set.status = 503;
          return {
            error: "Billing is not configured",
            code: "BILLING_NOT_CONFIGURED",
          };
        }
        return { prices: billing.provider.plans() };
      })
      .post("/api/billing/checkout", async ({ body, headers, set }) => {
        const billing = deps.billing;
        if (!billing) {
          set.status = 503;
          return {
            error: "Billing is not configured",
            code: "BILLING_NOT_CONFIGURED",
          };
        }
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        const parsed = CheckoutSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        // Unknown prices are a client error (400), not a provider outage:
        // retired or mistyped price keys fail here either way.
        const knownPrice = billing.provider
          .plans()
          .some((plan) => plan.key === parsed.data.priceKey);
        if (!knownPrice) {
          set.status = 400;
          return {
            error: `Unknown price: ${parsed.data.priceKey}`,
            code: "INVALID_PRICE",
          };
        }
        try {
          const result = await billing.provider.createCheckoutSession(
            user.id,
            parsed.data.priceKey,
            parsed.data.seats,
            { email: user.email },
          );
          return result;
        } catch (error) {
          set.status = 500;
          return {
            error: error instanceof Error ? error.message : "Checkout failed",
            code: "CHECKOUT_FAILED",
          };
        }
      })
      .post("/api/billing/cancel", async ({ headers, set }) => {
        // Razorpay has no customer portal: cancellation is a server-side
        // call (at cycle end, so paid access runs out naturally). The
        // webhook downgrades the tier when the subscription ends.
        const billing = deps.billing;
        if (!billing) {
          set.status = 503;
          return {
            error: "Billing is not configured",
            code: "BILLING_NOT_CONFIGURED",
          };
        }
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        const sub = await billing.subscriptionStore.findByUserId(user.id);
        if (!sub?.providerSubId) {
          set.status = 400;
          return {
            error: "No active billing subscription",
            code: "NO_SUBSCRIPTION",
          };
        }
        try {
          const result = await billing.provider.cancelSubscription(
            sub.providerSubId,
          );
          return result;
        } catch (error) {
          set.status = 500;
          return {
            error:
              error instanceof Error ? error.message : "Cancel failed",
            code: "CANCEL_FAILED",
          };
        }
      })
      .get("/api/billing/subscription", async ({ headers, set }) => {
        const billing = deps.billing;
        if (!billing) {
          set.status = 503;
          return {
            error: "Billing is not configured",
            code: "BILLING_NOT_CONFIGURED",
          };
        }
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        const subscription = await billing.subscriptionStore.findByUserId(user.id);
        return { subscription: subscription ?? null, userTier: user.tier };
      })
      .get("/api/audit", async ({ headers, query, set }) => {
        const user = await requestUser(
          users,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if (!user) {
          set.status = 401;
          return { error: "Authentication required", code: "AUTH_REQUIRED" };
        }
        const params = query as Record<string, unknown>;
        const workspaceId =
          typeof params.workspaceId === "string" && params.workspaceId
            ? params.workspaceId
            : undefined;
        const mineOnly = params.mine === "1" || params.mine === "true";
        const limit =
          typeof params.limit === "string" && params.limit
            ? Number.parseInt(params.limit, 10)
            : undefined;
        // Workspace audit requires ADMIN; without a workspace scope,
        // callers only ever see their own actions.
        if (workspaceId) {
          if (!deps.workspaces) {
            set.status = 503;
            return {
              error: "Workspaces are not configured",
              code: "WORKSPACES_NOT_CONFIGURED",
            };
          }
          const access = await requireWorkspaceRole(
            deps.workspaces,
            users,
            workspaceId,
            headers as Record<string, string | undefined>,
            ticketSecret,
            "ADMIN",
          );
          if ("body" in access) {
            set.status = access.status;
            return access.body;
          }
          return {
            events: await auditList({ workspaceId, limit }),
          };
        }
        if (!mineOnly) {
          set.status = 400;
          return {
            error: "Pass workspaceId (ADMIN) or mine=1",
            code: "VALIDATION_ERROR",
          };
        }
        return {
          events: await auditList({ actorId: user.id, limit }),
        };

        async function auditList(filter: {
          workspaceId?: string;
          actorId?: string;
          limit?: number;
        }) {
          if (!deps.audit) return [];
          return deps.audit.listEvents(filter);
        }
      })
  );
}
