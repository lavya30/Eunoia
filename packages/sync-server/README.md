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

The D2 endpoint forwards `{ source, engine, tier }` to `D2_COMPILER_URL`. Development mode returns an empty placeholder layout when the external Go compiler is unavailable; production reports the upstream error.

The implementation targets the available Node 20 runtime and uses only Node-compatible APIs. Node 22+ remains the production target from the PRD.
