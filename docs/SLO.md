# Eunoia Service-Level Objectives

Non-normative until the hosted Pro launch — this document defines what the
status page and probes measure so the 99.9% SLA (PRD §4) has a counterparty.

## Objectives (30-day rolling window)

| Signal | Objective | Measured by |
| --- | --- | --- |
| Sync API availability | 99.9% of `/health` probes return 2xx | External prober, 60s interval, 2+ regions (until wired: browser-kept 48h log on `/status`) |
| Readiness | `/readyz` returns `ready` (degraded still counts as up) | Same prober, `/readyz` endpoint |
| Sync upgrade success | >99% of WS upgrades accepted (`eunoia_ws_upgrades_total{outcome="ok"}` vs `locked/missing/error`) | `/metrics` (`member` = workspace fallback path) |
| Sync latency (peer mutation broadcast) | p95 < 50ms (NFR-2) | TBD: timestamp-delta harness (open gap) |
| Snapshot durability | Every debounced flush + final pre-evict write succeeds | `eunoia_snapshot_*` server logs / future metric |

99.9% allows ~43 minutes of downtime per month. `degraded` (Redis or
compiler unhealthy) is **not** downtime: sync, persistence, and placeholder
compiles keep working by design.

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

Revisit these objectives at Pro launch (PRD §8 Week 13+) and quarterly
after. Fill the latency/durability measurement gaps before signing any
customer-facing SLA.
