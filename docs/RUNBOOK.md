# Eunoia Operations Runbook

## Endpoints

- `GET /health` → `{ status, version, uptimeSec, activeRooms }`. Cheap
  liveness; used by the Docker `HEALTHCHECK` and compose.
- `GET /readyz` → `{ status: ready|degraded|down, version, uptimeSec,
  checks: { database, redis, compiler, imageStorage } }`. Each check is
  `ok | skipped | degraded | error` with `latencyMs`/`detail`. HTTP 503
  only when `status` is `down` (PostgreSQL configured but unreachable).
- `GET /metrics` → Prometheus text: `eunoia_http_requests_total`,
  `eunoia_compile_requests_total{engine,outcome}`, `eunoia_active_rooms`,
  `eunoia_ws_connections`, `eunoia_uptime_seconds`,
  `eunoia_process_resident_memory_bytes`.
- Public status UI: `/status` (frontend route polling `/health` + `/readyz`
  every 30s).

## Triage map

| Symptom | Likely cause | Check | Fix |
| --- | --- | --- | --- |
| `/readyz` → `down`, `database: error` | PostgreSQL down / `DATABASE_URL` wrong | `docker compose ps`; `pg_isready -U postgres -d eunoia` | Restart postgres; verify `DATABASE_URL`; server exits loudly on non-postgres URLs by design |
| `redis: degraded` | Redis down / `REDIS_URL` wrong | `docker compose logs redis`; `redis-cli ping` | Restart redis; sync keeps working (cursor telemetry only) — not downtime |
| `compiler: degraded` | d2-compiler down / `D2_COMPILER_URL` wrong | `curl localhost:9400/healthz`; `docker compose logs d2-compiler` | Restart d2-compiler; dev serves placeholder layouts, prod surfaces 502 with `D2_COMPILER_UNAVAILABLE` |
| Image endpoints 503 `R2_NOT_CONFIGURED` | R2 env missing | `imageStorage: skipped` in `/readyz` | Set `R2_*` vars; uploads/bytes proxy stay 503 until then |
| Compile 403 `TIER_UPGRADE_REQUIRED` | Expected tier gating, not an outage | `eunoia_compile_requests_total{outcome="TIER_UPGRADE_REQUIRED"}` | No action; room/user tier works as designed |
| WS closes 4100 | Snapshot restore dropped peers (expected) | Server logs | Clients resync automatically |
| Rising 5xx in `eunoia_http_requests_total` | App regression | `docker compose logs sync-server` (pino JSON access lines) | Roll back to last good image |

## Environment knobs

- `ROOM_TICKET_SECRET` unset → ephemeral secret (warns in logs); tickets
  invalidate on restart. Set a stable secret in production.
- `D2_COMPILER_URL` unset → placeholder compiles (warns in logs).
- All timeouts: dependency checks bounded at 2.5s each; `/readyz`
  parallelizes them.

## External probing (status page backend)

Point an external prober (e.g. Better Uptime, Upptime, or a Vercel cron
hitting a third-party check) at `GET /readyz` from 2+ regions at 60s
intervals. Alert on: unreachable, HTTP 503, or `status: "down"` for
>3 consecutive probes. `degraded` pages low-priority (business hours).

## Scaling notes

- Single sync-server replica in compose; scale horizontally behind Redis
  (cursor fan-out already pub/sub). No sticky sessions required for HTTP;
  WebSocket rooms are per-connection in-memory (a reconnect resyncs).
- Snapshot tuning: `SNAPSHOT_DEBOUNCE_MS`, `SNAPSHOT_MAX_PER_ROOM`,
  `SNAPSHOT_RETENTION_DAYS`, `ROOM_IDLE_TIMEOUT_MS`.
- Compiler tuning: `MAX_CONCURRENT_COMPILES`, `COMPILE_TIMEOUT_SEC`,
  `MAX_SOURCE_BYTES` (d2-compiler env).

## Incident process

1. Acknowledge on the status page within 15 minutes (business hours).
2. Mitigate (restart/rollback/scale), then diagnose from `/metrics` +
   container logs.
3. Post a retrospective when the error budget (docs/SLO.md) drops below
   50% in a window.
