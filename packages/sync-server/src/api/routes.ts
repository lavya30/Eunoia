import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import type { ImageDeps } from '../images.js';
import type { RoomManager } from '../RoomManager.js';
import { createApiApp } from './app.js';

const MAX_BODY_BYTES = 1_000_000;

/** Bridges Node's HTTP server to Elysia's standard Request/Response handler. */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  manager: RoomManager,
  config: Config,
  images: ImageDeps,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.end();
    return;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value)
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > MAX_BODY_BYTES)
      throw new Error('Request body too large');
  }
  const body =
    chunks.length && req.method !== 'GET' && req.method !== 'HEAD'
      ? Buffer.concat(chunks)
      : undefined;
  const request = new Request(
    `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`,
    { method: req.method, headers, body },
  );
  const response = await createApiApp(manager, config, images).handle(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}
