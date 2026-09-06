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
import type { RoomManager } from '../RoomManager.js';

export function createApiApp(manager: RoomManager, config: Config) {
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
    });
}
