import { randomUUID } from 'node:crypto';
import type { RawData } from 'ws';
import { CursorTelemetrySchema } from './api/schemas.js';
import type { RoomManager } from './RoomManager.js';
import type { RoomClient } from './types.js';

export class WebSocketHandler {
  constructor(private readonly manager: RoomManager) {}

  async handle(socket: RoomClient['socket'], roomId: string): Promise<void> {
    const room = await this.manager.getOrCreate(roomId);
    const client: RoomClient = {
      id: randomUUID(),
      socket,
      send: (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
    };
    room.addClient(client);

    socket.on('message', (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        const bytes =
          raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : Buffer.concat(Array.isArray(raw) ? raw : [raw as Buffer]);
        try {
          room.handleBinaryMessage(bytes, client);
        } catch {
          socket.close(1003, 'Invalid sync message');
        }
        return;
      }
      try {
        const text =
          typeof raw === 'string'
            ? raw
            : raw instanceof ArrayBuffer
              ? Buffer.from(raw).toString('utf8')
              : Buffer.concat(
                  Array.isArray(raw) ? raw : [raw as Buffer],
                ).toString('utf8');
        const parsed = CursorTelemetrySchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          socket.close(1008, 'Invalid cursor message');
          return;
        }
        room.handleCursor(
          {
            ...parsed.data,
            clientId: client.id,
            timestamp: parsed.data.timestamp ?? Date.now(),
          },
          client,
        );
      } catch {
        socket.close(1008, 'Invalid cursor message');
      }
    });

    const leave = () => {
      room.removeClient(client.id);
      this.manager.release(roomId);
    };
    socket.once('close', leave);
    socket.once('error', leave);
  }
}
