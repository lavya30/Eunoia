import { node } from '@elysiajs/node';
import { Elysia } from 'elysia';
import type { Config } from '../config.js';
import { type CompileRequest, compileD2 } from '../d2-compiler.js';
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
      try {
        return await compileD2(
          input as CompileRequest,
          config.d2CompilerUrl,
          config.nodeEnv !== 'production',
        );
      } catch (error) {
        set.status = 502;
        return {
          error: error instanceof Error ? error.message : 'D2 compiler failed',
        };
      }
    });
}
