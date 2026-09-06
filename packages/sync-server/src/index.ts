import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { WebSocketServer } from 'ws';
import { handleApiRequest } from './api/routes.js';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import {
  type ImageDeps,
  MemoryImageStore,
  PrismaImageStore,
  resolveR2Config,
  S3R2Client,
} from './images.js';
import {
  MemorySnapshotStore,
  PrismaSnapshotStore,
  type SnapshotStore,
} from './RoomLoader.js';
import { RoomManager } from './RoomManager.js';
import { authorizeRoom } from './room-auth.js';
import { WebSocketHandler } from './WebSocketHandler.js';

const logger = pino({ name: 'eunoia-sync-server' });

export type SyncServer = {
  server: Server;
  manager: RoomManager;
  close(): Promise<void>;
};

export function createSyncServer(
  config: Config = loadConfig(),
  store?: SnapshotStore,
  imageDeps?: Partial<ImageDeps>,
): SyncServer {
  const prisma = config.databaseUrl?.startsWith('postgres')
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
  const handler = new WebSocketHandler(manager);
  const wsServer = new WebSocketServer({ noServer: true });
  let resolvedSecret = config.roomTicketSecret;
  if (!resolvedSecret) {
    resolvedSecret = randomBytes(32).toString('hex');
    logger.warn(
      'ROOM_TICKET_SECRET is unset; using an ephemeral secret. Room tickets invalidate on restart.',
    );
  }
  const ticketSecret: string = resolvedSecret;
  const apiConfig: Config = { ...config, roomTicketSecret: ticketSecret };
  const server = createServer((req, res) => {
    void handleApiRequest(req, res, manager, apiConfig, images).catch(
      (error) => {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Bad request',
          }),
        );
      },
    );
  });

  server.on('upgrade', (req, socket, head) => {
    const roomId = getRoomId(req);
    if (!roomId) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ticket = url.searchParams.get('ticket') ?? undefined;
    void authorizeRoom(manager, roomId, ticket, ticketSecret)
      .then((access) => {
        if (access.status === 'locked') {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          void handler
            .handle(ws, roomId)
            .catch(() => ws.close(1011, 'Unable to load room'));
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
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
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const match =
    pathname.match(/^\/sync\/([^/]+)$/) ??
    pathname.match(/^\/api\/rooms\/([^/]+)\/sync$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const config = loadConfig();
  const app = createSyncServer(config);
  app.server.listen(config.port, config.host, () => {
    logger.info(
      `Eunoia sync server listening on ${config.host}:${config.port}`,
    );
  });
  const shutdown = () => void app.close().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
