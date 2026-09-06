import type { WebSocket } from 'ws';

export type CanvasElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
};

export type RoomInfo = {
  id: string;
  name: string;
  ownerId: string;
  tier: 'COMMUNITY' | 'PRO' | 'ENTERPRISE';
};

export type CursorTelemetry = {
  type: 'cursor';
  clientId: string;
  x: number;
  y: number;
  user?: { name?: string; color?: string };
  tool?: string;
  timestamp: number;
};

export type RoomClient = {
  id: string;
  socket: WebSocket;
  send(data: Uint8Array | string): void;
};

export const WS_MESSAGE_SYNC = 0;
export const WS_MESSAGE_AWARENESS = 1;
export const WS_MESSAGE_CURSOR = 2;
