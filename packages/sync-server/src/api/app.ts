import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import type { Config } from "../config.js";
import { CompileRequestError, compileD2, type Tier } from "../d2-compiler.js";
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
  CheckoutSchema,
  CompileRequestSchema,
  CreateRoomSchema,
  ImageConfirmSchema,
  ImageContentTypeSchema,
  ImageListQuerySchema,
  ImageRequestUploadSchema,
  LoginUserSchema,
  RegisterUserSchema,
  SnapshotQuerySchema,
  UnlockRoomSchema,
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

type OwnershipResult =
  | { owner: PublicUser; claimed: boolean }
  | { status: 401 | 403; body: { error: string; code: string } };

/**
 * Mutation gate for PATCH/DELETE. Room tickets prove access, but only the
 * owner may mutate: anonymous rooms are claimed by the first authenticated
 * caller (PATCH) or deletable by any authenticated caller (DELETE).
 */
async function requireOwnership(
  manager: RoomManager,
  users: UserStore,
  room: RoomMetadata,
  headers: Record<string, string | undefined>,
  secret: string,
): Promise<OwnershipResult> {
  const caller = await requestUser(users, headers, secret);
  if (!caller) {
    return {
      status: 401,
      body: { error: "Authentication required", code: "AUTH_REQUIRED" },
    };
  }
  if (room.ownerId !== "anonymous" && room.ownerId !== caller.id) {
    return {
      status: 403,
      body: { error: "Only the room owner may do this", code: "FORBIDDEN" },
    };
  }
  return { owner: caller, claimed: room.ownerId === "anonymous" };
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
};

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
        const room = await manager.createRoom(
          {
            name: input.name,
            ownerId: user ? user.id : "anonymous",
            tier: input.tier ?? callerTier,
          },
          input.password,
        );
        set.status = 201;
        return room;
      })
      .get("/api/rooms/:roomId", async ({ params, headers, query, set }) => {
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
        const ownership = await requireOwnership(
          manager,
          users,
          access.room,
          headers as Record<string, string | undefined>,
          ticketSecret,
        );
        if ("body" in ownership) {
          set.status = ownership.status;
          return ownership.body;
        }
        await manager.deleteRoom(access.room.id);
        set.status = 204;
        return;
      })
      .patch(
        "/api/rooms/:roomId",
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
          const ownership = await requireOwnership(
            manager,
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
          const access = await requestAccess(
            manager,
            input.roomId,
            headers as Record<string, string | undefined>,
            query as Record<string, unknown>,
            ticketSecret,
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
          )
            return {
              restored: params.snapshotId,
              restoredAt: new Date().toISOString(),
            };
          set.status = 404;
          return { error: "Snapshot not found", code: "SNAPSHOT_NOT_FOUND" };
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
  );
}
