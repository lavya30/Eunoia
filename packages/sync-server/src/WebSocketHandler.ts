import { randomUUID } from "node:crypto";
import type { RawData } from "ws";
import { WebSocket } from "ws";
import { CursorTelemetrySchema } from "./api/schemas.js";
import type { RoomManager } from "./RoomManager.js";
import type { RoomClient } from "./types.js";

export class WebSocketHandler {
  constructor(private readonly manager: RoomManager) {}

  async handle(socket: RoomClient["socket"], roomId: string): Promise<void> {
    const room = await this.manager.getOrCreate(roomId);
    // The socket may have died while the room was loading: never register
    // ghosts that pin the room and defeat idle eviction.
    if (socket.readyState !== WebSocket.OPEN) {
      this.manager.release(roomId);
      return;
    }
    const client: RoomClient = {
      id: randomUUID(),
      socket,
      send: (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
    };
    room.addClient(client);

    // Heartbeat: dead TCP peers never fire close/error, which would pin
    // the client (and its room, defeating idle eviction) forever. The ws
    // client library answers pings automatically; a peer that misses one
    // full interval is terminated so leave() runs via the close handler.
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        clearInterval(heartbeat);
        return;
      }
      if (!alive) {
        clearInterval(heartbeat);
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30_000);
    if (typeof heartbeat.unref === "function") heartbeat.unref();

    socket.on("message", (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        const bytes =
          raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : Buffer.concat(Array.isArray(raw) ? raw : [raw as Buffer]);
        try {
          room.handleBinaryMessage(bytes, client);
        } catch {
          socket.close(1003, "Invalid sync message");
        }
        return;
      }
      try {
        const text =
          typeof raw === "string"
            ? raw
            : raw instanceof ArrayBuffer
              ? Buffer.from(raw).toString("utf8")
              : Buffer.concat(
                  Array.isArray(raw) ? raw : [raw as Buffer],
                ).toString("utf8");
        const parsed = CursorTelemetrySchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          socket.close(1008, "Invalid cursor message");
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
        socket.close(1008, "Invalid cursor message");
      }
    });

    const leave = () => {
      clearInterval(heartbeat);
      room.removeClient(client.id);
      this.manager.release(roomId);
    };
    socket.once("close", leave);
    socket.once("error", leave);
  }
}
