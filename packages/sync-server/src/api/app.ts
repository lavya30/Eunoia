import { node } from '@elysiajs/node';
import { Elysia } from 'elysia';
import type { Config } from '../config.js';
import {
  type CompileRequest,
  CompileRequestError,
  compileD2,
  type LayoutEngine,
  parseEngine,
  type Tier,
} from '../d2-compiler.js';
import {
  buildImageKey,
  IMAGE_CONTENT_TYPES,
  type ImageDeps,
  type ImageKind,
  isImageContentType,
  isImageKind,
  keyBelongsToRoom,
  type ObjectHead,
} from '../images.js';
import type { RoomManager } from '../RoomManager.js';

export type { ImageDeps };

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
      const input = body as Record<string, unknown>;
      const room = await manager.createRoom({
        name: typeof input.name === 'string' ? input.name : undefined,
        ownerId: typeof input.ownerId === 'string' ? input.ownerId : undefined,
        tier:
          input.tier === 'PRO' || input.tier === 'ENTERPRISE'
            ? input.tier
            : undefined,
      });
      set.status = 201;
      return room;
    })
    .get('/api/rooms/:roomId', ({ params, set }) =>
      manager.getRoomMetadata(params.roomId).then((room) => {
        if (!room) {
          set.status = 404;
          return { error: 'Room not found' };
        }
        return room;
      }),
    )
    .delete('/api/rooms/:roomId', async ({ params, set }) => {
      if (await manager.deleteRoom(params.roomId)) {
        set.status = 204;
        return;
      }
      set.status = 404;
      return { error: 'Room not found' };
    })
    .post('/api/compile', async ({ body, set }) => {
      const input = body as Partial<CompileRequest>;
      if (typeof input.source !== 'string') {
        set.status = 400;
        return { error: 'source is required' };
      }
      let engine: LayoutEngine;
      try {
        engine = parseEngine(input.engine);
      } catch (error) {
        set.status = 400;
        return {
          error: error instanceof Error ? error.message : 'Invalid engine',
          code: 'INVALID_ENGINE',
        };
      }
      // Tier is resolved server-side: the room's stored tier wins when a
      // roomId is given, otherwise COMMUNITY. A client-asserted tier in the
      // body is never trusted.
      let tier: Tier = 'COMMUNITY';
      if (typeof input.roomId === 'string' && input.roomId) {
        const room = await manager.getRoomMetadata(input.roomId);
        if (!room) {
          set.status = 404;
          return { error: 'Room not found' };
        }
        tier = room.tier;
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
      async ({ params, body, set }) => {
        const room = await manager.getRoomMetadata(params.roomId);
        if (!room) {
          set.status = 404;
          return { error: 'Room not found' };
        }
        const r2 = images.r2;
        if (!r2) {
          set.status = 503;
          return {
            error: 'Image storage is not configured',
            code: 'R2_NOT_CONFIGURED',
          };
        }
        const input = body as { contentType?: unknown; kind?: unknown };
        if (!isImageContentType(input.contentType)) {
          set.status = 400;
          return {
            error: 'Unsupported content type',
            code: 'INVALID_CONTENT_TYPE',
            allowed: Object.keys(IMAGE_CONTENT_TYPES),
          };
        }
        const kind: ImageKind =
          input.kind === undefined ? 'image' : (input.kind as ImageKind);
        if (!isImageKind(kind)) {
          set.status = 400;
          return { error: 'Invalid kind', code: 'INVALID_KIND' };
        }
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
            kind,
          };
        } catch (error) {
          return r2Error(set, error);
        }
      },
    )
    .post(
      '/api/rooms/:roomId/images/confirm',
      async ({ params, body, set }) => {
        const room = await manager.getRoomMetadata(params.roomId);
        if (!room) {
          set.status = 404;
          return { error: 'Room not found' };
        }
        const r2 = images.r2;
        if (!r2) {
          set.status = 503;
          return {
            error: 'Image storage is not configured',
            code: 'R2_NOT_CONFIGURED',
          };
        }
        const input = body as {
          key?: unknown;
          contentType?: unknown;
          size?: unknown;
          kind?: unknown;
        };
        if (
          typeof input.key !== 'string' ||
          !keyBelongsToRoom(input.key, room.id)
        ) {
          set.status = 400;
          return {
            error: 'Key does not belong to this room',
            code: 'INVALID_KEY',
          };
        }
        const kind: ImageKind =
          input.kind === undefined ? 'image' : (input.kind as ImageKind);
        if (!isImageKind(kind)) {
          set.status = 400;
          return { error: 'Invalid kind', code: 'INVALID_KIND' };
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
        const contentType = head.contentType ?? input.contentType;
        if (!isImageContentType(contentType)) {
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
            contentType,
            size,
            kind,
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
    .get('/api/rooms/:roomId/images', async ({ params, query, set }) => {
      const room = await manager.getRoomMetadata(params.roomId);
      if (!room) {
        set.status = 404;
        return { error: 'Room not found' };
      }
      const kind = (query as { kind?: unknown }).kind;
      if (kind !== undefined && !isImageKind(kind)) {
        set.status = 400;
        return { error: 'Invalid kind', code: 'INVALID_KIND' };
      }
      return images.imageStore.listImages(
        room.id,
        kind === undefined ? undefined : (kind as ImageKind),
      );
    })
    .get('/api/rooms/:roomId/images/:imageId/url', async ({ params, set }) => {
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
    })
    .delete('/api/rooms/:roomId/images/:imageId', async ({ params, set }) => {
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
    });
}
