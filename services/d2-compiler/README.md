# Eunoia D2 compiler service

Small Go HTTP wrapper around `github.com/d2lang/d2`'s layout engines (dagre,
elk, tala — all bundled in-process). The sync server forwards
`POST /api/compile` here when `D2_COMPILER_URL` is configured. Tier gating
(Community = dagre only, PRO+ = elk/tala) lives in the sync server.

## API

- `POST /compile` — body `{ "source": "<d2>", "engine": "dagre|elk|tala", "tier": "COMMUNITY" }`
  returns `{ "nodes": [...], "edges": [...] , "engine": "<engine>" }`.
  Nodes carry `{ key, label, x, y, width, height, shape, style: { fill, stroke }, strokeWidth }`;
  edges carry `{ key, source, target, label, color }`.
  Unknown engines are rejected with `400 { error, code: "INVALID_ENGINE" }`;
  D2 syntax errors return `400 { error }`. Engine defaults to `dagre`.
- `GET /healthz` — `{ "status": "ok", "engines": ["dagre", "elk", "tala"] }`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9400` | Listen port |
| `MAX_CONCURRENT_COMPILES` | `4` | In-flight compile cap (excess → 503) |
| `COMPILE_TIMEOUT_SEC` | `15` | Per-compile deadline |
| `MAX_SOURCE_BYTES` | `512000` | Max D2 source size |

## Run

```sh
# locally (needs Go 1.24+)
go run . 

# docker
docker build -t eunoia/d2-compiler ./services/d2-compiler
docker run --rm -p 9400:9400 eunoia/d2-compiler

# via compose (wires D2_COMPILER_URL automatically)
docker compose up d2-compiler
```

## Verify

```sh
curl -X POST localhost:9400/compile \
  -H 'content-type: application/json' \
  -d '{"source":"client -> gateway -> worker","engine":"dagre"}'
```
