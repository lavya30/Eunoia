# Eunoia sync server

Node-compatible WebSocket sync server for Eunoia. It serves Yjs `sync` and `awareness` protocol messages at `/sync/:roomId`, cursor telemetry as JSON, and REST endpoints at `/api`.

## Local development

```sh
cp .env.example .env
bun install
bun --filter ./packages/sync-server prisma:generate
bun run dev:sync
```

`DATABASE_URL` and `REDIS_URL` may be omitted for local development and tests. In that mode the server uses an in-memory snapshot store and cursor telemetry is local-only. Production requires PostgreSQL; run the full stack with `docker compose up --build`.

The D2 endpoint forwards `{ source, engine }` to `D2_COMPILER_URL`. Tier is resolved server-side: pass `roomId` to gate by the room's stored tier, otherwise the compile runs as COMMUNITY. `elk` and `tala` require PRO or ENTERPRISE, and Community diagrams are capped at `D2_COMMUNITY_NODE_LIMIT` nodes (default 30); violations return `403 TIER_UPGRADE_REQUIRED`. Development mode returns an empty placeholder layout when the external Go compiler is unavailable; production reports the upstream error.

Room images are stored as bytes in Cloudflare R2 with metadata in PostgreSQL. Clients upload directly to R2 via presigned URLs: `POST /api/rooms/:roomId/images/request-upload`, then `POST /api/rooms/:roomId/images/confirm` once the bytes land (the server verifies existence, type, and size before recording metadata). `GET /api/rooms/:roomId/images` lists metadata, `GET .../images/:imageId/url` issues a fresh (signed or public) URL, and `DELETE .../images/:imageId` removes both object and row. Without R2 credentials these endpoints return `503 R2_NOT_CONFIGURED`.

Snapshots accumulate per room and are pruned on every save to the newest `SNAPSHOT_MAX_PER_ROOM` (default 100) plus everything inside the last `SNAPSHOT_RETENTION_DAYS` (default 30); the newest snapshot is always kept. `GET /api/rooms/:roomId/snapshots` lists history newest-first (`limit` 1–100, optional `before` date, no document bytes). `POST /api/rooms/:roomId/snapshots/:snapshotId/restore` rolls the live document back: the pre-restore state is force-flushed first so it stays recoverable, then connected peers are dropped with close code 4100 and must reload to resync (their newer state would otherwise resurrect undone changes).

The implementation targets the available Node 20 runtime and uses only Node-compatible APIs. Node 22+ remains the production target from the PRD.
