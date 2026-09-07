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

The backend is in `packages/sync-server/` and uses TypeScript, Yjs, WebSocket, Elysia, Prisma, PostgreSQL, Redis, `fflate`, and the AWS SDK (R2 object storage).

### Responsibilities

- WebSocket Yjs synchronization at `/sync/:roomId`.
- Yjs awareness/presence updates and JSON cursor telemetry.
- Room creation, loading, idle eviction, and graceful shutdown.
- Debounced, compressed Yjs snapshots with retention pruning (newest + newest-K + 30-day window).
- Snapshot history listing and rollback restore (drops peers with close code 4100).
- Optional room passwords (scrypt hash) with HMAC ticket unlock gating HTTP room endpoints and the sync socket.
- Room image uploads via R2 presigned URLs plus metadata-only PostgreSQL records.
- PostgreSQL persistence through Prisma, with an in-memory store for local development and tests.
- Optional Redis Pub/Sub for cursor telemetry across server instances.
- D2 compiler proxy at `POST /api/compile`, with a development placeholder when no compiler service is configured.
- Runtime input/output validation with Zod at HTTP, WebSocket, and D2 compiler boundaries.

### HTTP API

- `GET /health`
- `POST /api/rooms` (optional `password`, min 8 chars, stored as scrypt hash)
- `POST /api/rooms/:roomId/unlock` (exchanges the password for an HMAC ticket; locked rooms require it as `Authorization: Bearer` or `?ticket=` on room endpoints and `/sync/:roomId`, which 401s otherwise)
- `GET /api/rooms/:roomId`
- `DELETE /api/rooms/:roomId`
- `POST /api/compile` (optional `roomId` resolves the tier server-side and requires a ticket on locked rooms; `elk`/`tala` require PRO+, Community caps at `D2_COMMUNITY_NODE_LIMIT` nodes — violations return 403 `TIER_UPGRADE_REQUIRED`)
- Room images: `POST /api/rooms/:roomId/images/request-upload`, `POST /api/rooms/:roomId/images/confirm`, `GET /api/rooms/:roomId/images`, `GET /api/rooms/:roomId/images/:imageId/url`, `DELETE /api/rooms/:roomId/images/:imageId` (require R2 — 503 `R2_NOT_CONFIGURED` otherwise)
- Snapshot history: `GET /api/rooms/:roomId/snapshots` (`limit`, `before`; metadata only), `POST /api/rooms/:roomId/snapshots/:snapshotId/restore` (force-flushes pre-restore state, drops peers with close code 4100 so they reload)

The WebSocket endpoint can also be addressed as `/api/rooms/:roomId/sync`.

### Validation

Request schemas live in `packages/sync-server/src/api/schemas.ts`. Use these schemas with `safeParse` at every external boundary instead of trusting TypeScript casts. The schemas currently cover room creation and unlock requests, D2 compile requests, image upload/confirm/list requests, snapshot query parameters, and cursor telemetry.

Malformed HTTP requests return status 400 with this shape:

```json
{
  "error": "Invalid request",
  "code": "VALIDATION_ERROR",
  "issues": [{ "path": "source", "message": "...", "code": "..." }]
}
```

Preserve established domain error codes such as `INVALID_PASSWORD` and `INVALID_ENGINE` when changing validation behavior. Cursor telemetry is validated before entering a room; malformed text messages close the socket with code `1008`. Responses received from the external D2 compiler must also be validated before use. In development, an invalid or unavailable compiler response falls back to the placeholder layout; production surfaces the compiler failure to the API.

### Configuration

Copy `packages/sync-server/.env.example` to `.env` when running the server directly. Important settings include `PORT`, `DATABASE_URL`, `REDIS_URL`, `D2_COMPILER_URL`, `D2_COMMUNITY_NODE_LIMIT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, `R2_MAX_UPLOAD_BYTES`, `R2_URL_EXPIRES_IN_SEC`, `SNAPSHOT_MAX_PER_ROOM`, `SNAPSHOT_RETENTION_DAYS`, `SNAPSHOT_DEBOUNCE_MS`, `ROOM_IDLE_TIMEOUT_MS`, `ROOM_TICKET_SECRET`, and `ROOM_TICKET_TTL_SEC`.

Production requires `DATABASE_URL`. Redis, R2, and the external D2 compiler are optional in development; the server remains usable without them (image endpoints 503 without R2). Without `ROOM_TICKET_SECRET` the server generates an ephemeral secret and warns; tickets then invalidate on restart.

After changing `packages/sync-server/prisma/schema.prisma`, regenerate the client with:

```sh
bun run prisma:generate
```

Do not assume the `User` model provides authentication or authorization; user-level auth flows are not implemented yet (only room passwords exist).

### Image storage

Image bytes should be stored in a Cloudflare R2 bucket, not PostgreSQL. PostgreSQL should retain only image metadata such as the room association, object key, public or signed URL, content type, and timestamps. Uploads use presigned-URL + confirm flow (`src/images.ts`, `S3R2Client`); clients PUT bytes directly to R2 and the server verifies via HEAD before recording metadata. Do not add binary image data or base64 blobs to Prisma models.

## Verification

Backend changes should pass:

```sh
bun run --filter ./packages/sync-server lint
bun run --filter ./packages/sync-server typecheck
bun run --filter ./packages/sync-server build
bun run --filter ./packages/sync-server test
```

Validation-specific coverage is in `packages/sync-server/tests/validation.test.ts`; API validation coverage is in `packages/sync-server/tests/api.test.ts`.

The API and WebSocket tests bind local TCP ports. If the execution environment blocks local listeners, rerun those tests with the required permission rather than treating the sandbox error as a backend failure.
