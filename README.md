# metricq-codex

`metricq-codex` is a modern reimplementation of the MetricQ web viewer:
- no Vue 2, no frontend build step
- vanilla HTML/CSS/JS + Bootstrap 5 (vendored, no CDN dependency)
- Go backend talking to MetricQ directly via `metricq-go`
- frontend is embedded into the binary via `go:embed`

## Goals

- similar look, feel, and workflow as `metricq-webview`
- comparable feature set: metric search, time range picker, multi-metric plotting, min/max bands, analysis, export
- a small, maintainable stack

## Getting started

`metricq-codex` depends on `metricq-go` via a local `replace` directive in `go.mod`, so it expects
that repository checked out as a sibling directory:

```
repos/
├── metricq-codex/
└── metricq-go/
```

Then, from `metricq-codex`:

```bash
go run .
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `LISTEN_ADDR` | `:80` | HTTP listen address |
| `METRICQ_SERVER` | `amqp://guest:guest@localhost:5672/` | AMQP broker URL for the MetricQ agent connection |
| `METRICQ_TOKEN` | `metricq-codex` | MetricQ agent identity token |
| `QUERY_TIMEOUT_SECONDS` | `30` | Per-query timeout for `/api/query*` and `/api/analyze` |
| `WEB_DIR` | *(unset)* | If set, serve the frontend from this filesystem path instead of the embedded copy (see below) |
| `LEGACY_CHARTS_BASE_URL` | *(unset)* | Base URL for the "open in legacy chart" link, exposed via `/api/config` |

Example:

```bash
LISTEN_ADDR=:80 \
METRICQ_SERVER=amqp://user:pass@rabbitmq:5672/ \
METRICQ_TOKEN=metricq-codex \
go run .
```

### Frontend development without backend restarts

By default the frontend is served via `go:embed` — a build-time snapshot. For live development,
serve it straight from the filesystem instead:

```bash
WEB_DIR=./web LISTEN_ADDR=:8080 go run .
```

Files served this way are sent with `Cache-Control: no-store`, so a plain browser reload is enough
to pick up HTML/CSS/JS changes — no Go process restart, and no risk of the browser silently caching
a stale module across edits.

## Frontend features

- **Metric search** — plain substring/infix search by default; a `/` prefix switches to
  selector/regex mode, a `?` prefix searches descriptions. Hostlist bracket syntax
  (e.g. `host[1-3]`) is expanded server-side.
- **Advanced search** — a dedicated modal with four modes: name (infix), name (regex/selector),
  description, and structured metadata filtering (site, room, rack, feed, asset type, location,
  circuit, phase, cluster, team, criticality, …) with value suggestions per field.
- **Computed / expression metrics** — a formula editor supporting `+ - * /`, unary minus, `log`,
  `min()`, `max()`, `sum()`, and metric references as `[metric.name]`, with a metric palette to
  insert references and live validation.
- **Y-axis modes** — Local (currently visible range), Global (historical min/max), or Manual
  (explicit min/max).
- **Render/view modes** — Bands (mean line with min/max band), Line only, Count/frequency
  (samples per interval), TI mode (step/last-value semantics for counters and load profiles), and
  Candlestick (OHLC).
- **Per-metric actions** — hide/show all, recolor (classic palette or random), remove all, plus a
  per-metric factor/alias dialog to scale values and rename display labels.
- **Analyze** — a table of min/mean/max/count for the currently visible metrics.
- **Export** — PNG, CSV, and JSON export of the current chart data.
- **Share / URL state** — the full view (metrics, time range, y-axis, render mode) is encoded into
  a compact URL parameter that can be copied or shown as a QR code; corrupted/invalid shared state
  is caught and reported instead of silently breaking.
- **Time range picker** — quick presets (last 15m … 3y, today, yesterday, this/last week/month/
  year, …), plus Relative and Absolute tabs, zoom in/out, and shift-by-50% buttons.
- **Help overlay** — a toggleable coach-mark style overlay that explains UI elements on hover.
- **Collapsible sidebar** — the metric list panel can be collapsed for more chart space; shows
  live HTTP timing, aggregate/raw point counts, and a pending-request indicator.
- **Chart interactions** — drag-select zoom, hover tooltips, a collapsed legend, and pinch/pen/
  touch pan & zoom support.

The UI is currently German-only (`<html lang="de">`).

## Tests

Backend:

```bash
go test ./...
```

Frontend (no npm, via Node's built-in test runner):

```bash
node --test web/tests/*.test.mjs
```

CI (`.github/workflows/ci.yml`) checks out `metricq-codex` and the sibling `metricq-go` repo, runs
`go build/vet/test` and the frontend test suite, and — on non-PR events — builds and pushes a
multi-tag Docker image to GHCR.

## API

Registered endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/config` | Frontend bootstrap config |
| `GET` | `/api/metrics` | Metric name search (infix, selector/regex, hostlist, or description) |
| `POST` | `/api/metrics/search` | Advanced search (name/description/metadata, paginated) |
| `GET` | `/api/metrics/suggest` | Suggested values for one metadata field |
| `GET` | `/api/metrics/suggest-fields` | List of metadata fields eligible for suggestions |
| `POST` | `/api/metrics/resolve` | Resolve metrics from a structured metadata filter |
| `GET` | `/api/metadata` | Metadata for a single metric |
| `POST` | `/api/expression/validate` | Validate a computed-metric expression |
| `POST` | `/api/query` | Time-series data for one or more targets |
| `POST` | `/api/query/stacked` | Same as `/api/query`, resampled/aligned for stacked rendering |
| `POST` | `/api/query/range` | Global min/max over a time range (for the Global y-axis mode) |
| `POST` | `/api/analyze` | Summary statistics (min/mean/max/count) per target |

All request bodies are JSON; all responses are `200 OK` with a JSON body unless noted otherwise.
Malformed JSON bodies return `400` with `{"error": "invalid json"}`; a wrong HTTP method returns
`405` with `{"error": "method not allowed"}`.

### `GET /api/health`

No parameters. Response: `{ "ok": true }`.

### `GET /api/config`

No parameters. Response: `{ "legacyChartsBaseUrl": string }` (empty string if
`LEGACY_CHARTS_BASE_URL` is unset).

### `GET /api/metrics`

Query parameters:
- `query` (string, optional) — search text. Interpreted as infix/substring, as a selector/regex, or
  as a description search depending on `mode`. Also accepts hostlist bracket syntax
  (e.g. `rack[1-3].power`), which is expanded server-side into an explicit selector list before
  searching.
- `mode` (string, optional) — `"selector"` / `"regex"` treats `query` as a selector expression
  instead of infix; `"description"` searches metric descriptions instead of names; any other value
  (including omitted) is plain infix/substring search.
- `limit` (int, optional, default `100`, max `5000`) — invalid or out-of-range values fall back to
  the default.

Response: `{ "metrics": string[] }` (sorted metric names, no metadata).

### `POST /api/metrics/search`

Body (`advancedSearchRequest`):
- `query` (string)
- `mode` (string, optional, default `"infix"`) — `"infix"` / `"selector"` search by name,
  `"description"` searches descriptions, anything else searches by `filter` only.
- `filter` (object, optional) — structured metadata filter, only used when `mode` is not
  `infix`/`selector`/`description`.
- `limit` (int, optional, default `100`, max `500`)
- `offset` (int, optional)

Response: `{ "metrics": [{ name, description, metadata }, ...] }`.

### `GET /api/metrics/suggest`

Query parameters:
- `field` (string, required) — must be one of the fields returned by
  `/api/metrics/suggest-fields`; otherwise `400`.
- `filter` (string, optional) — a JSON-encoded object used to narrow suggestions; `400` on invalid
  JSON.
- `limit` (int, optional, default `100`, max `1000`)

Response: `{ "field": string, "values": [{ value, count }, ...] }`.

### `GET /api/metrics/suggest-fields`

No parameters. Response: `{ "fields": string[] }` — currently `site`, `room`, `rack`, `feed`,
`asset_type`, `asset_id`, `location_code`, `metric_type`, `circuit`, `phase`, `source`, `cluster`,
`system`, `service`, `team`, `criticality`, `scope`, `position` (see `suggestableFields` in
`metric_search.go`).

### `POST /api/metrics/resolve`

Body:
- `filter` (object, optional) — structured metadata filter
- `limit` (int, optional, default `200`, max `500`)
- `offset` (int, optional)

Response: `{ "metrics": [{ name, metadata }, ...] }`.

### `GET /api/metadata`

Query parameters:
- `metric` (string, required) — exact metric name; `400` if missing, `404` if unknown.

Response: `{ "metric": string, "metadata": object }`.

### `POST /api/expression/validate`

Body:
- `expr` (string) — a computed-metric expression (see the "Computed / expression metrics" feature
  above for the supported grammar).

Always responds `200`, even for invalid expressions:
`{ "valid": bool, "error"?: string, "errorInfo"?: { type, message, token?, position?, end? } }`.
`position`/`end` are character offsets into `expr`, used by the frontend editor to underline the
offending token.

### `POST /api/query`

Body (`apiQueryRequest`):
- `from` (int64, unix ms, required)
- `to` (int64, unix ms, required, must be `> from`)
- `maxDataPoints` (int, optional) — desired resolution; the backend picks raw values vs.
  aggregates (and the aggregation interval) based on this
- `targets: [{ name?, metric?, expr?, render? }]` (required, non-empty):
  - `metric` XOR `expr` is required per target (exactly one, not both)
  - `name` (optional) — display name, falls back to `metric` or `expr`
  - `expr` — a computed-metric expression referencing other metrics as `[metric.name]`
  - `render` (optional) — `"candlestick"` requests OHLC-bucketed resampling for that target
    instead of the default raw/aggregate series (only meaningful for `metric` targets, not `expr`)

Response: `{ "series": apiQuerySeries[] }`, one entry per target, each with:
- `metric` (its `name`/`metric`/`expr`)
- `mode` — `"values"` (raw points), `"aggregates"` (min/max/avg/count buckets), `"candlestick"`
  (OHLC buckets, only when `render: "candlestick"` was requested), or `"empty"`
- `points` / `aggregatePoints` depending on `mode`
- `sampleCount`, `duration`, and an `error` (+ optional `errorInfo` for expression parse errors)
  field on per-target failure — a failed target does not fail the whole request

### `POST /api/query/stacked`

Same request shape as `/api/query`, but the response is resampled onto one shared timeline and
uses last-value/TI semantics to align series for stacked rendering:
- `duration: number`
- `times: number[]`
- `metrics: string[]`
- `values: (number|null)[][]`

`values[i][j]` is the value of the `i`-th metric at the `j`-th timestamp in `times`. `null` means no
valid value at that time (e.g. outside `activeTime` under last-value/TI semantics). Any target
error fails the whole request (`502`), unlike `/api/query`.

### `POST /api/query/range`

Body (`apiYRangeGlobalRequest`):
- `metrics: string[]` (required, non-empty)
- `from`, `to` (int64, unix ms, optional) — default to "last 10 years to now" if omitted or
  invalid (`to <= 0` → now; `from <= 0` or `from >= to` → `to` minus 10 years)

Response: `{ "minimum": number, "maximum": number, "metrics": string[] }` — the global min/max
across the given metrics and range, used for the Global y-axis mode. `404` if no data is found.

### `POST /api/analyze`

Body (`apiAnalyzeRequest`):
- `from`, `to` (unix ms, required, `to > from`)
- `targets` (same shape as `/api/query`; `render` on a target has no effect here)

Response:
- `{ "entries": [{ metric, minimum, maximum, sum, count, mean, duration, error?, errorInfo? }, ...] }`

## A note on legacy routes

Previously documented alias/legacy routes (`/search`, `/query`, `/legacy/*`, etc.) are **not**
registered in the current codebase.
