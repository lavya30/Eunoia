import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import type { Config } from "../config.js";
import { CompileRequestError, compileD2, type Tier } from "../d2-compiler.js";
import {
  buildImageKey,
  type ImageDeps,
  keyBelongsToRoom,
  type ObjectHead,
} from "../images.js";
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
import {
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
 * authentication. Room tickets and garbage both resolve to anonymous.
 */
async function requestUser(
  users: UserStore,
  headers: Record<string, string | undefined>,
  secret: string,
): Promise<PublicUser | null> {
  const authorization = headers.authorization;
  if (typeof authorization !== "string") return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  const userId = verifyUserToken(secret, token);
  if (!userId) return null;
  return users.findById(userId);
}

export function createApiApp(
  manager: RoomManager,
  config: Config,
  images: ImageDeps,
  users: UserStore,
) {
  const ticketSecret = config.roomTicketSecret;
  if (!ticketSecret) throw new Error("roomTicketSecret is required");
  return new Elysia({ adapter: node() })
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
        typeof set.status === "number" && set.status >= 400 ? set.status : 500;
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
        "content-type, authorization";
      set.headers["access-control-allow-methods"] =
        "GET, POST, PATCH, DELETE, OPTIONS";
    })
    .get("/health", () => ({
      status: "ok",
      activeRooms: manager.activeRoomCount,
    }))
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
      // they explicitly choose otherwise.
      const user = await requestUser(
        users,
        headers as Record<string, string | undefined>,
        ticketSecret,
      );
      const room = await manager.createRoom(
        {
          name: input.name,
          ownerId: input.ownerId ?? user?.id ?? "anonymous",
          tier: input.tier ?? user?.tier ?? "COMMUNITY",
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
        return { error: "Room not found" };
      }
      const parsed = UnlockRoomSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return validationError(parsed.error);
      }
      const input = parsed.data;
      if (room.hasPassword) {
        if (
          input.password === undefined ||
          !(await manager.verifyRoomPassword(room.id, input.password))
        ) {
          set.status = 403;
          return { error: "Invalid password", code: "INVALID_PASSWORD" };
        }
      }
      const { ticket, expiresIn } = issueTicket(
        ticketSecret,
        room.id,
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
      await manager.deleteRoom(access.room.id);
      set.status = 204;
      return;
    })
    .patch("/api/rooms/:roomId", async ({ params, body, headers, query, set }) => {
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
        if (parsed.error.issues.some((issue) => issue.path[0] === "password"))
          return {
            error: "Password must be at least 8 characters",
            code: "INVALID_PASSWORD",
          };
        return validationError(parsed.error);
      }
      const input = parsed.data;
      const updated = await manager.updateRoom(
        access.room.id,
        { name: input.name, ownerId: input.ownerId, tier: input.tier },
        input.password,
      );
      if (!updated) {
        set.status = 404;
        return { error: "Room not found", code: "ROOM_NOT_FOUND" };
      }
      return updated;
    })
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
        return { error: "Invalid email or password", code: "INVALID_CREDENTIALS" };
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
        return await compileD2(
          { source: input.source, engine },
          {
            compilerUrl: config.d2CompilerUrl,
            isDevelopment: config.nodeEnv !== "production",
            tier,
            nodeLimit: config.d2CommunityNodeLimit,
          },
        );
      } catch (error) {
        if (error instanceof CompileRequestError) {
          set.status = error.status;
          return {
            error: error.message,
            code: error.code,
            details: error.details,
          };
        }
        set.status = 502;
        return {
          error: error instanceof Error ? error.message : "D2 compiler failed",
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
        if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
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
            (await r2.presignDownload(input.key, config.r2UrlExpiresInSec)).url;
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
        const parsed = ImageListQuerySchema.safeParse(query);
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
              return publicUrl === image.url ? image : { ...image, url: publicUrl };
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
          return { error: "Image not found" };
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
          return await r2.presignDownload(image.key, config.r2UrlExpiresInSec);
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
          return { error: "Image not found" };
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
          return r2Error(set, error);
        }
        await images.imageStore.deleteImage(image.id);
        set.status = 204;
        return;
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
        const parsed = SnapshotQuerySchema.safeParse(query);
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
        if (await manager.restoreRoomSnapshot(params.roomId, params.snapshotId))
          return {
            restored: params.snapshotId,
            restoredAt: new Date().toISOString(),
          };
        set.status = 404;
        return { error: "Snapshot not found" };
      },
    );
}
