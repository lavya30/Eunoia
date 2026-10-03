# Eunoia D2 compiler service

Small Go HTTP wrapper around `github.com/d2lang/d2`'s layout engines (dagre,
elk, tala — all bundled in-process). The sync server forwards
`POST /api/compile` here when `D2_COMPILER_URL` is configured. Tier gating
(Community = dagre only, PRO+ = elk/tala) lives in the sync server.

## API

- `POST /compile` — body `{ "source": "<d2>", "engine": "dagre|elk|tala", "tier": "COMMUNITY", "svg": false }`
  returns `{ "nodes": [...], "edges": [...] , "engine": "<engine>", "svg": "<svg>? " }`.
  Nodes carry `{ key, label, x, y, width, height, shape, style: { fill, stroke, opacity, stroke-dash, border-radius, font-size, font-color }, strokeWidth, parent, level, detail/tooltip, fontSize, fontColor, bold, italic, underline, labelPosition, link, zIndex }`;
  edges carry `{ key, source, target, label, color, srcArrow, dstArrow, srcLabel, dstLabel, strokeWidth, strokeDash, opacity, fontSize, labelPosition, labelPercentage, route: [{x, y}], isCurve, zIndex }`.
  Pass `"svg": true` for a rendered SVG document alongside the layout JSON (capped at 2MB, for export/thumbnail use — otherwise layout JSON only, since SVGs are 10-100x larger).
  Unknown engines are rejected with `400 { error, code: "INVALID_ENGINE" }`;
  D2 syntax errors return `400 { error }`. Engine defaults to `dagre`.
- `GET /healthz` — `{ "status": "ok", "engines": ["dagre", "elk", "tala"] }`.

## Configuration

| Variable                  | Default  | Purpose                              |
| ------------------------- | -------- | ------------------------------------ |
| `PORT`                    | `9400`   | Listen port                          |
| `MAX_CONCURRENT_COMPILES` | `4`      | In-flight compile cap (excess → 503) |
| `COMPILE_TIMEOUT_SEC`     | `15`     | Per-compile deadline                 |
| `MAX_SOURCE_BYTES`        | `512000` | Max D2 source size                   |

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

# with rendered SVG for export/thumbnails
curl -X POST localhost:9400/compile \
  -H 'content-type: application/json' \
  -d '{"source":"client -> gateway -> worker","engine":"dagre","svg":true}'
```
