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

| Symptom                                        | Likely cause                                                                                                                       | Check                                                            | Fix                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/readyz` → `down`, `database: error`          | PostgreSQL down / `DATABASE_URL` wrong                                                                                             | `docker compose ps`; `pg_isready -U postgres -d eunoia`          | Restart postgres; verify `DATABASE_URL`; server exits loudly on non-postgres URLs by design           |
| `redis: degraded`                              | Redis down / `REDIS_URL` wrong                                                                                                     | `docker compose logs redis`; `redis-cli ping`                    | Restart redis; sync keeps working (cursor telemetry only) — not downtime                              |
| `compiler: degraded`                           | d2-compiler down / `D2_COMPILER_URL` wrong                                                                                         | `curl localhost:9400/healthz`; `docker compose logs d2-compiler` | Restart d2-compiler; dev serves placeholder layouts, prod surfaces 502 with `D2_COMPILER_UNAVAILABLE` |
| Image endpoints 503 `R2_NOT_CONFIGURED`        | R2 env missing                                                                                                                     | `imageStorage: skipped` in `/readyz`                             | Set `R2_*` vars; uploads/bytes proxy stay 503 until then                                              |
| `imageStorage: degraded` in `/readyz`          | R2 configured but bucket unreachable (creds, network)                                                                              | `imageStorage.detail` in `/readyz`                               | Fix creds/network; sync + persistence keep working (degraded, never down)                             |
| Compile 403 `TIER_UPGRADE_REQUIRED`            | Expected tier gating, not an outage                                                                                                | `eunoia_compile_requests_total{outcome="TIER_UPGRADE_REQUIRED"}` | No action; room/user tier works as designed                                                           |
| WS closes 4100                                 | Snapshot restore dropped peers (expected)                                                                                          | Server logs                                                      | Clients resync automatically                                                                          |
| Billing endpoints 503 `BILLING_NOT_CONFIGURED` | `RAZORPAY_KEY_ID` unset                                                                                                            | Server boot logs                                                 | Set `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET/PLAN_PRO`; tiers stay DB-managed until then                |
| Webhook 401 `INVALID_SIGNATURE` spike          | Rotated webhook secret or clock/replay issue                                                                                       | Compare dashboard endpoint secret vs `RAZORPAY_WEBHOOK_SECRET`   | Update env, restart; replays are idempotent so redelivery is safe                                     |
| Tier stuck after cancel                        | `halted` status (failed renewals) is skipped by design; downgrade lands on `cancelled/completed/expired`                           | Subscription row status                                          | No action until Razorpay ends the subscription; cancel is at cycle end                                |
| RBI recurring notes                            | First mandate charge needs customer 2FA (hosted link handles it); UPI Autopay caps at ₹15,000/cycle — card mandates suit $12 plans | Razorpay dashboard                                               | Nothing to build; pre-debit notifications + eFIRC are Razorpay-side                                   |
| Rising 5xx in `eunoia_http_requests_total`     | App regression                                                                                                                     | `docker compose logs sync-server` (pino JSON access lines)       | Roll back to last good image                                                                          |

## Billing go-live checklist (test mode first, then live)

1. Razorpay dashboard (test mode): create the Pro plan ($12/user/mo, card
   mandates per the RBI note above) → record the plan id as
   `RAZORPAY_PLAN_PRO`. Register
   `https://<staging-host>/api/billing/webhook`, copy the webhook secret.
   Keys live in host env / deploy secrets — never in git.
2. Set `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET/PLAN_PRO` on staging;
   confirm `/api/billing/*` stops returning `BILLING_NOT_CONFIGURED` and
   `GET /api/billing/prices` matches `PricingPage.tsx` ($12/$30).
3. Run the drill (human, staging, never CI):
   `bun scripts/verify-billing.ts --confirm-staging --sync-url=https://<staging-host>`
   — register → test payment on the hosted link → webhook tier flip →
   redelivery idempotency → cancel at cycle end.
4. Cutover: swap test→live keys, re-register the live webhook, repeat the
   drill once against production. Keep the test plan IDs here for future
   staging drills.

## Environment knobs

- `ROOM_TICKET_SECRET` unset → ephemeral secret (warns in logs); tickets
  invalidate on restart. Set a stable secret in production.
- `D2_COMPILER_URL` unset → placeholder compiles (warns in logs).
- All timeouts: dependency checks bounded at 2.5s each; `/readyz`
  parallelizes them.

## External probing (status page backend)

Upptime (`.upptimerc.yml` + `.github/workflows/uptime*.yml`) is the prober:
fill in the production origin and set the `GH_PAT` secret (classic PAT,
`repo` scope). It hits
`GET /health` + `GET /readyz` from 2+ regions at 60s intervals. Alert on:
unreachable, HTTP 503, or `status: "down"` for

> 3 consecutive probes. `degraded` pages low-priority (business hours).

Set `NEXT_PUBLIC_UPPTIME_HISTORY_URL` (frontend env) to the Upptime
history JSON endpoint (contract: `[{ t: <epochMs>, up: <bool> }]`); the
`/status` page then renders prober history as the SLA record and falls
back to its browser-kept 48h log when unset or unreachable.

## Scaling notes

- Multi-instance is supported via the Redis room bus: every replica
  publishes Yjs doc updates, awareness (presence), and restore control
  messages on `bus:{roomId}` (plus the legacy `cursor:{roomId}` channel),
  so any number of replicas can serve clients in the same room without
  forking the doc. **The bus is dormant without `REDIS_URL`** — set it in
  every replica or they silently run as isolated singletons.
- Recommended topology is bus **plus** sticky sessions: pin each room's
  WebSockets to one replica for locality (the bus then only carries
  overflow/rebalance traffic instead of every keystroke). Example with
  Traefik — the cookie is set on the HTTP upgrade handshake, so plain
  WebSocket clients get affinity with no client changes:
  ```yaml
  # traefik dynamic config (file provider)
  http:
    services:
      sync-server:
        weighted:
          services:
            - { name: sync-1@docker, weight: 1 }
            - { name: sync-2@docker, weight: 1 }
          sticky:
            cookie:
              name: eunoia_affinity
              secure: true
              httpOnly: true
  ```
  nginx equivalent: `upstream sync { hash $arg_room consistent; ... }`
  on `/sync/` + `/api/rooms/:id/sync` (path-arg consistent hashing), or
  the `sticky` cookie directive. HTTP API routes are stateless and need
  no affinity.
- Room affinity is best-effort by design: when a replica dies or a room
  rebalances, clients reconnect (exponential backoff in `sync.ts`) and
  resync via Yjs state vectors against whichever replica answers. A newly
  loaded replica may be up to `SNAPSHOT_DEBOUNCE_MS` stale; the connecting
  clients' own state heals it during the handshake — no catch-up protocol.
- Observability per replica: `/health` reports a stable `instanceId`
  (verify affinity distribution by polling each replica); `/metrics`
  exposes `eunoia_bus_messages_total` / `eunoia_bus_bytes_total` by
  direction (`published|received|dropped`) and kind
  (`update|awareness|control`). A rising `dropped` direction means
  malformed cross-instance traffic — investigate, don't ignore.
- Graceful shutdown is already final-flush (`SIGTERM`/`SIGINT` →
  `manager.shutdown()` → per-room snapshot dispose). Behind an
  orchestrator add a drain window so the LB stops routing first:
  ```yaml
  # Kubernetes example
  lifecycle:
    preStop:
      exec: { command: ["sleep", "15"] }
  terminationGracePeriodSeconds: 60
  ```
- Snapshot tuning: `SNAPSHOT_DEBOUNCE_MS`, `SNAPSHOT_MAX_PER_ROOM`,
  `SNAPSHOT_RETENTION_DAYS`, `ROOM_IDLE_TIMEOUT_MS`. Note: with N
  replicas, debounced flushes happen on each (last-writer-wins on
  near-identical bytes); retention pruning is bounded by
  `SNAPSHOT_MAX_PER_ROOM` per the shared policy.
- Compiler tuning: `MAX_CONCURRENT_COMPILES`, `COMPILE_TIMEOUT_SEC`,
  `MAX_SOURCE_BYTES` (d2-compiler env).

## Incident process

1. Acknowledge on the status page within 15 minutes (business hours).
2. Mitigate (restart/rollback/scale), then diagnose from `/metrics` +
   container logs.
3. Post a retrospective when the error budget (docs/SLO.md) drops below
   50% in a window.

## On-call rotation (fill names at Pro launch)

| Week (Mon–Sun) | Primary        | Secondary      |
| -------------- | -------------- | -------------- |
| YYYY-MM-DD     | TBD (username) | TBD (username) |
| YYYY-MM-DD     | TBD (username) | TBD (username) |

- **Assignees:** the current primary's GitHub username goes in the
  `assignees` lists in `.upptimerc.yml` — Upptime auto-assigns each
  incident issue to them. Rotating the lists is a 2-minute weekly chore
  done at handoff until it's worth automating.
- **Paging:** `down` (503 `/readyz`) or unreachable ×3 probes → Upptime
  opens an incident issue assigned to primary: page immediately.
  `degraded` → ticket for business hours. Rising
  `eunoia_ws_upgrades_total{outcome="locked"}` is usually credential
  rotation, not an outage — check deploys first.
- **Handoff:** Monday 09:00 local; outgoing primary posts open incidents +
  error-budget state in the team channel.
- **Escalation:** no ack in 15 min → secondary; no ack in 30 min → whole
  team. SLA credits (when the contract is signed) are computed from the
  prober history, not from recollection.

## Launch dry run (do once, before signing the SLA)

1. Stop staging `d2-compiler` → `/readyz` goes `degraded`: confirm NO
   incident issue opens (degraded is not downtime).
2. Stop staging `postgres` → `/readyz` goes `down`: confirm an incident
   issue opens within ~3 probe cycles, assigned to the primary.
3. Measure ack time against the 15-minute target; practice mitigate
   (restart) → diagnose (`/metrics` + container logs).
4. Heal postgres → confirm the issue auto-closes. Link the dry-run issue
   here as the worked example.
