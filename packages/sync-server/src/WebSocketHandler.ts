import { randomUUID } from 'node:crypto';
import type { RawData } from 'ws';
import type { RoomManager } from './RoomManager.js';
import type { CursorTelemetry, RoomClient } from './types.js';

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
      if (isBinary || typeof raw !== 'string') {
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
        const message = JSON.parse(raw) as CursorTelemetry;
        if (message.type === 'cursor')
          room.handleCursor({ ...message, clientId: client.id }, client);
      } catch {
        // Ignore malformed telemetry messages.
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
