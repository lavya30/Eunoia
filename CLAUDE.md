# Eunoia

Eunoia is a Bun monorepo for an architecture whiteboard and D2 diagram canvas.

## Repository layout

- `frontend/` — Next.js frontend and editor UI.
- `packages/sync-server/` — Node-compatible real-time collaboration backend.
- `docker-compose.yml` — local PostgreSQL, Redis, and sync-server services.
- `PRODUCT.md` — product requirements and scope.

The frontend has additional instructions in [`frontend/CLAUDE.md`](frontend/CLAUDE.md) and [`frontend/AGENTS.md`](frontend/AGENTS.md).

## Root commands

```sh
bun install
bun run dev                 # frontend, sync server, and database services
bun run dev:frontend
bun run dev:sync
bun run dev:db
bun run build               # sync-server build
bun run lint
bun run typecheck
bun run test
bun run prisma:generate
```

## Sync server

The backend is in `packages/sync-server/` and uses TypeScript, Yjs, WebSocket, Elysia, Prisma, PostgreSQL, Redis, and `fflate`.

### Responsibilities

- WebSocket Yjs synchronization at `/sync/:roomId`.
- Yjs awareness/presence updates and JSON cursor telemetry.
- Room creation, loading, idle eviction, and graceful shutdown.
- Debounced, compressed Yjs snapshots.
- PostgreSQL persistence through Prisma, with an in-memory store for local development and tests.
- Optional Redis Pub/Sub for cursor telemetry across server instances.
- D2 compiler proxy at `POST /api/compile`, with a development placeholder when no compiler service is configured.

### HTTP API

- `GET /health`
- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `DELETE /api/rooms/:roomId`
- `POST /api/compile`

The WebSocket endpoint can also be addressed as `/api/rooms/:roomId/sync`.

### Configuration

Copy `packages/sync-server/.env.example` to `.env` when running the server directly. Important settings include `PORT`, `DATABASE_URL`, `REDIS_URL`, `D2_COMPILER_URL`, `SNAPSHOT_DEBOUNCE_MS`, and `ROOM_IDLE_TIMEOUT_MS`.

Production requires `DATABASE_URL`. Redis and the external D2 compiler are optional in development; the server remains usable without them.

After changing `packages/sync-server/prisma/schema.prisma`, regenerate the client with:

```sh
bun run prisma:generate
```

Do not assume the `User` model provides authentication or authorization; those flows are not implemented yet.

### Image storage

Image bytes should be stored in a Cloudflare R2 bucket, not PostgreSQL. PostgreSQL should retain only image metadata such as the room association, object key, public or signed URL, content type, and timestamps. The existing `ImageAsset` model currently stores URL metadata only; R2 upload, signed-URL generation, deletion, and retrieval endpoints are not implemented yet.

When adding R2 support, use environment-based S3-compatible credentials and keep bucket access server-side. Do not add binary image data or base64 blobs to Prisma models.

## Verification

Backend changes should pass:

```sh
bun run --filter ./packages/sync-server lint
bun run --filter ./packages/sync-server typecheck
bun run --filter ./packages/sync-server build
bun run --filter ./packages/sync-server test
```

The API and WebSocket tests bind local TCP ports. If the execution environment blocks local listeners, rerun those tests with the required permission rather than treating the sandbox error as a backend failure.
