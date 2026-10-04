# Eunoia Service-Level Objectives

Effective 2026-10-03. Normative: these objectives gate nightly CI and the
hosted Pro SLA (PRD §4). Budgets for NFR-4/5/6/7 were blank in PRD §5 and
are locked here as initial values — tunable after the first measurement
window. Reviewed quarterly.

## Objectives (30-day rolling window)

| Signal                                 | Objective                                                                                         | Measured by                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sync API availability                  | 99.9% of `/health` probes return 2xx                                                              | External prober, 60s interval, 2+ regions (until wired: browser-kept 48h log on `/status`)                                             |
| Readiness                              | `/readyz` returns `ready` (degraded still counts as up)                                           | Same prober, `/readyz` endpoint                                                                                                        |
| Sync upgrade success                   | >99% of WS upgrades accepted (`eunoia_ws_upgrades_total{outcome="ok"}` vs `locked/missing/error`) | `/metrics` (`member` = workspace fallback path)                                                                                        |
| Sync latency (peer mutation broadcast) | p95 < 50ms (NFR-2)                                                                                | `bun run bench:latency` (`scripts/latency-probe.ts`, A→server→B timestamp deltas, nightly CI)                                          |
| Snapshot durability                    | Every debounced flush + final pre-evict write succeeds                                            | `/metrics`: `eunoia_snapshot_flush_total{outcome}` + `eunoia_snapshot_flush_duration_ms_*` (NFR-7)                                     |
| Frame rate (NFR-1)                     | p95 frame ≤ 16.7ms during continuous pan/zoom @ 3,000 shapes; no sustained <55 FPS window         | `frontend/benchmarks/render-fps.bench.ts` (Playwright, nightly) + `culling.bench.ts` per-PR proxy (search ≤2ms, rebuild ≤8ms @ N=3000) |
| D2 compile budget (NFR-3)              | p95 < 500ms API-start → canvas-update for a 50-node diagram (dagre)                               | `frontend/benchmarks/compile.bench.ts` E2E mode + `eunoia_compile_duration_ms_*`                                                       |
| Client memory (NFR-4)                  | Browser tab JS heap < 500MB with 5,000 entities + 5 concurrent users                              | `frontend/benchmarks/memory.bench.ts` (nightly, Chromium `performance.memory`)                                                         |
| Network efficiency (NFR-5)             | p95 Yjs delta < 2KB (shape move), < 1KB (recolor); text edit / node add reported                  | `packages/sync-server/scripts/delta-size.ts` (per-PR)                                                                                  |
| Server throughput (NFR-6)              | 500 concurrent rooms × 5 users on a 16GB instance without relay p95 regression                    | `packages/sync-server/scripts/room-soak.ts` (nightly)                                                                                  |
| Snapshot write latency (NFR-7)         | p95 < 1s for a 1MB compressed snapshot (debounced + final pre-evict flush)                        | `packages/sync-server/scripts/snapshot-flush.bench.ts` + `/metrics`                                                                    |

99.9% allows ~43 minutes of downtime per month. `degraded` (Redis or
compiler unhealthy) is **not** downtime: sync, persistence, and placeholder
compiles keep working by design.

## External probing

Upptime (`.upptimerc.yml`, workflows `uptime*.yml`) probes `GET /health` + `GET /readyz` at a 60s
interval from 2+ regions. `ready`/`degraded` count as up; `down` or
unreachable count as down. >3 consecutive failures open an incident and
page per `docs/RUNBOOK.md`. The `/status` page prefers Upptime
history as the SLA record and falls back to its browser-kept 48h log when
Upptime is unreachable (see `StatusPage.tsx`).

## What counts as downtime

- `/health` or `/readyz` unreachable, or `/readyz` reporting `"down"`
  (configured-but-unreachable PostgreSQL).
- WebSocket sync unusable for >50% of connection attempts over 5 minutes.

Excluded: scheduled maintenance windows (announced on the status page),
client-side outages, expired presigned image URLs (15-minute rotation is
by design; the bytes proxy and URL refresh cover it), and `local-*`
offline rooms.

## Error budget policy

- Budget remaining > 50%: normal deploy cadence.
- Budget remaining < 50%: freeze non-urgent deploys, prioritize reliability
  work (NFR harness, load suite).
- Budget exhausted: freeze all feature work until the budget recovers,
  post a status-page incident retrospective.

## Review

Revisit these objectives quarterly after Pro launch (PRD §8 Week 13+).
NFR-4/5/6/7 budgets above are initial values: retune after the first two
nightly windows if p95 headroom is consistently >50% or breaches are
environmental. SLA credits (when the contract is signed) are computed from
Upptime history, not from recollection.
