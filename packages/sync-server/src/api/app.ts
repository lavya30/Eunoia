import { node } from '@elysiajs/node';
import { Elysia } from 'elysia';
import type { Config } from '../config.js';
import { CompileRequestError, compileD2, type Tier } from '../d2-compiler.js';
import {
  buildImageKey,
  type ImageDeps,
  keyBelongsToRoom,
  type ObjectHead,
} from '../images.js';
import type { RoomMetadata } from '../RoomLoader.js';
import type { RoomManager } from '../RoomManager.js';
import { authorizeRoom, extractTicket, issueTicket } from '../room-auth.js';
import {
  CompileRequestSchema,
  CreateRoomSchema,
  ImageConfirmSchema,
  ImageContentTypeSchema,
  ImageListQuerySchema,
  ImageRequestUploadSchema,
  SnapshotQuerySchema,
  UnlockRoomSchema,
  validationError,
} from './schemas.js';

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
  if (access.status === 'ok') return { room: access.room };
  return access.status === 'missing'
    ? { status: 404, body: { error: 'Room not found', code: 'ROOM_NOT_FOUND' } }
    : {
        status: 401,
        body: {
          error: 'Room requires a valid access ticket',
          code: 'ROOM_LOCKED',
        },
      };
}

function r2Error(set: { status?: unknown }, error: unknown) {
  set.status = 502;
  return {
    error: error instanceof Error ? error.message : 'Image storage failed',
    code: 'R2_ERROR',
  };
}

export function createApiApp(
  manager: RoomManager,
  config: Config,
  images: ImageDeps,
) {
  const ticketSecret = config.roomTicketSecret;
  if (!ticketSecret) throw new Error('roomTicketSecret is required');
  return new Elysia({ adapter: node() })
    .onRequest(({ set }) => {
      set.headers['access-control-allow-origin'] = '*';
      set.headers['access-control-allow-headers'] = 'content-type';
    })
    .get('/health', () => ({
      status: 'ok',
      activeRooms: manager.activeRoomCount,
    }))
    .post('/api/rooms', async ({ body, set }) => {
      const parsed = CreateRoomSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        if (parsed.error.issues.some((issue) => issue.path[0] === 'password'))
          return {
            error: 'Password must be at least 8 characters',
            code: 'INVALID_PASSWORD',
          };
        return validationError(parsed.error);
      }
      const input = parsed.data;
      const room = await manager.createRoom(
        {
          name: input.name,
          ownerId: input.ownerId,
          tier: input.tier,
        },
        input.password,
      );
      set.status = 201;
      return room;
    })
    .get('/api/rooms/:roomId', async ({ params, headers, query, set }) => {
      const access = await requestAccess(
        manager,
        params.roomId,
        headers as Record<string, string | undefined>,
        query as Record<string, unknown>,
        ticketSecret,
      );
      if ('body' in access) {
        set.status = access.status;
        return access.body;
      }
      return access.room;
    })
    .post('/api/rooms/:roomId/unlock', async ({ params, body, set }) => {
      const room = await manager.getRoomMetadata(params.roomId);
      if (!room) {
        set.status = 404;
        return { error: 'Room not found' };
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
          return { error: 'Invalid password', code: 'INVALID_PASSWORD' };
        }
      }
      const { ticket, expiresIn } = issueTicket(
        ticketSecret,
        room.id,
        config.roomTicketTtlSec,
      );
      return { ticket, expiresIn, roomId: room.id };
    })
    .delete('/api/rooms/:roomId', async ({ params, headers, query, set }) => {
      const access = await requestAccess(
        manager,
        params.roomId,
        headers as Record<string, string | undefined>,
        query as Record<string, unknown>,
        ticketSecret,
      );
      if ('body' in access) {
        set.status = access.status;
        return access.body;
      }
      await manager.deleteRoom(access.room.id);
      set.status = 204;
      return;
    })
    .post('/api/compile', async ({ body, headers, query, set }) => {
      const parsed = CompileRequestSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        const engineIssue = parsed.error.issues.find(
          (issue) => issue.path[0] === 'engine',
        );
        if (engineIssue) {
          const engine =
            typeof body === 'object' && body !== null
              ? (body as Record<string, unknown>).engine
              : undefined;
          return {
            error: `Unknown layout engine: ${JSON.stringify(engine)}`,
            code: 'INVALID_ENGINE',
            details: { engine },
          };
        }
        return validationError(parsed.error);
      }
      const input = parsed.data;
      const engine = input.engine ?? 'dagre';
      // Tier is resolved server-side: the room's stored tier wins when a
      // roomId is given, otherwise COMMUNITY. A client-asserted tier in the
      // body is never trusted. Locked rooms additionally require a ticket.
      let tier: Tier = 'COMMUNITY';
      if (input.roomId) {
        const access = await requestAccess(
          manager,
          input.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        tier = access.room.tier;
      }
      try {
        return await compileD2(
          { source: input.source, engine },
          {
            compilerUrl: config.d2CompilerUrl,
            isDevelopment: config.nodeEnv !== 'production',
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
          error: error instanceof Error ? error.message : 'D2 compiler failed',
        };
      }
    })
    .post(
      '/api/rooms/:roomId/images/request-upload',
      async ({ params, body, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        const room = access.room;
        const r2 = images.r2;
        if (!r2) {
          set.status = 503;
          return {
            error: 'Image storage is not configured',
            code: 'R2_NOT_CONFIGURED',
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
      '/api/rooms/:roomId/images/confirm',
      async ({ params, body, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        const room = access.room;
        const r2 = images.r2;
        if (!r2) {
          set.status = 503;
          return {
            error: 'Image storage is not configured',
            code: 'R2_NOT_CONFIGURED',
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
            error: 'Key does not belong to this room',
            code: 'INVALID_KEY',
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
          return { error: 'Upload not found', code: 'OBJECT_NOT_FOUND' };
        }
        const contentType = ImageContentTypeSchema.safeParse(
          head.contentType ?? input.contentType,
        );
        if (!contentType.success) {
          set.status = 400;
          return {
            error: 'Unsupported content type',
            code: 'INVALID_CONTENT_TYPE',
          };
        }
        const size = head.size ?? input.size;
        if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
          set.status = 400;
          return { error: 'Size is required', code: 'INVALID_SIZE' };
        }
        if (size > config.r2MaxUploadBytes) {
          await r2.delete(input.key).catch(() => undefined);
          set.status = 413;
          return {
            error: `Upload exceeds the ${config.r2MaxUploadBytes} byte limit`,
            code: 'UPLOAD_TOO_LARGE',
          };
        }
        if (await images.imageStore.findByKey(input.key)) {
          set.status = 409;
          return {
            error: 'Image already confirmed',
            code: 'IMAGE_ALREADY_CONFIRMED',
          };
        }
        try {
          const publicUrl = r2.publicUrl(input.key);
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
          if ((error as { code?: string }).code === 'P2002') {
            set.status = 409;
            return {
              error: 'Image already confirmed',
              code: 'IMAGE_ALREADY_CONFIRMED',
            };
          }
          return r2Error(set, error);
        }
      },
    )
    .get(
      '/api/rooms/:roomId/images',
      async ({ params, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        const room = access.room;
        const parsed = ImageListQuerySchema.safeParse(query);
        if (!parsed.success) {
          set.status = 400;
          return validationError(parsed.error);
        }
        return images.imageStore.listImages(room.id, parsed.data.kind);
      },
    )
    .get(
      '/api/rooms/:roomId/images/:imageId/url',
      async ({ params, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        const image = await images.imageStore.getImage(params.imageId);
        if (!image || image.roomId !== params.roomId) {
          set.status = 404;
          return { error: 'Image not found' };
        }
        const r2 = images.r2;
        if (!r2) {
          set.status = 503;
          return {
            error: 'Image storage is not configured',
            code: 'R2_NOT_CONFIGURED',
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
      '/api/rooms/:roomId/images/:imageId',
      async ({ params, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        const image = await images.imageStore.getImage(params.imageId);
        if (!image || image.roomId !== params.roomId) {
          set.status = 404;
          return { error: 'Image not found' };
        }
        const r2 = images.r2;
        if (!r2) {
          set.status = 503;
          return {
            error: 'Image storage is not configured',
            code: 'R2_NOT_CONFIGURED',
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
      '/api/rooms/:roomId/snapshots',
      async ({ params, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
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
      '/api/rooms/:roomId/snapshots/:snapshotId/restore',
      async ({ params, headers, query, set }) => {
        const access = await requestAccess(
          manager,
          params.roomId,
          headers as Record<string, string | undefined>,
          query as Record<string, unknown>,
          ticketSecret,
        );
        if ('body' in access) {
          set.status = access.status;
          return access.body;
        }
        if (await manager.restoreRoomSnapshot(params.roomId, params.snapshotId))
          return {
            restored: params.snapshotId,
            restoredAt: new Date().toISOString(),
          };
        set.status = 404;
        return { error: 'Snapshot not found' };
      },
    );
}
