# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`metricq-codex` is a Go web server that acts as a MetricQ history viewer. It connects to MetricQ via AMQP (RabbitMQ), serves a vanilla JS/HTML/CSS frontend embedded via `go:embed`, and exposes a REST API for metric search, querying, and analysis.

The local `metricq-go` library is referenced via a `replace` directive in `go.mod` pointing to `../metricq-go`.

## Commands

**Run the server:**
```bash
go run .
```

**Frontend live-reload development (no rebuild needed on JS/HTML changes):**
```bash
WEB_DIR=./web LISTEN_ADDR=:8080 go run .
```

**Run Go tests:**
```bash
go test ./...
```

**Run a specific Go test file:**
```bash
go test -run TestName .
```

**Run frontend tests (Node built-in test runner, no npm):**
```bash
node --test web/tests/time-axis.test.mjs
node --test web/tests/units.test.mjs
# etc.
```

**Build binary:**
```bash
go build -o metricq-codex .
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LISTEN_ADDR` | `:80` | HTTP listen address |
| `METRICQ_SERVER` | `amqp://guest:guest@localhost:5672/` | RabbitMQ URL |
| `METRICQ_TOKEN` | `metricq-codex` | MetricQ agent token |
| `QUERY_TIMEOUT_SECONDS` | `30` | Query timeout |
| `WEB_DIR` | *(empty)* | If set, serve frontend from filesystem instead of embedded |

## Architecture

### Backend (Go, `package main`)

- **`server.go`** — `main()`: sets up HTTP routes, embeds `web/` via `go:embed`, starts the server
- **`service.go`** — `service` struct: owns the MetricQ AMQP connections (one for management RPC via `metricq-go`, one direct AMQP channel for history queries). Manages a `pending` correlation-ID map for async history responses
- **`handlers_api.go`** — HTTP handlers for all `/api/*` routes; also contains expression evaluation pipeline for query targets with `expr` fields
- **`config.go`** — reads config from environment variables
- **`types.go`** — all Go types: request/response structs, `service` struct, `historyRequest/Response`
- **`history_codec.go`** — protobuf encode/decode for MetricQ history wire format (hand-rolled with `protowire`)
- **`expr_eval.go`** — expression parser and evaluator (tokenizer → AST → eval). Supports `+`, `-`, `*`, `/`, unary `-`, `log()`, `min()`, `max()`, `sum()`. Metric references: bare identifiers or `[metric.name.with.dots]`
- **`util.go`** / **`http_util.go`** — small helpers

**MetricQ connection flow:** On startup, `newService()` connects to management via `metricq-go` agent, calls `history.register` RPC to discover the history data server address, queue name, and exchange. Then opens a second direct AMQP connection to the data server. All history queries go out on this second channel using correlation IDs, and responses come back on the same queue.

**Query pipeline:** `POST /api/query` → `resolveQueryTargets` → parallel `queryMetric` calls → `historyToSeries` (converts protobuf response to `apiQuerySeries`) → expression eval if target has `expr` field.

### Frontend (Vanilla JS ES modules, `web/js/`)

No build step. Modules are loaded directly by the browser.

- **`model.js`** — singleton `state` object (all UI/chart state) and `colors` palette
- **`main.js`** — entry point: wires DOM events, URL state sync, chart interactions
- **`data.js`** — API calls to `/api/query` and `/api/query/stacked`
- **`chart.js`** — Canvas-based chart rendering (no charting library)
- **`metrics.js`** — metric list management, search, metadata
- **`analyze.js`** — analysis panel, calls `/api/analyze`
- **`url-state.mjs`** — serializes/deserializes full view state to/from URL hash
- **`time-range.mjs`** — relative time token parsing (`now-1h`, `now`, etc.)
- **`targets.mjs`** — query target building (handles `metric` vs `expr` targets)
- **`expressions.js`** — expression editor modal
- **`factors.mjs`**, **`auto-factor.mjs`** — unit scaling/factor logic
- **`y-axis.mjs`** — y-axis range management including global range fetch

**Frontend tests** live in `web/tests/` and use Node's built-in `node:test` module. They import the `.mjs` modules directly — no test framework or bundler needed.

## Key Conventions

- After each code change, state whether a **backend restart** is required (backend changes always require restart; frontend changes with `WEB_DIR` set do not)
- After each Codex-initiated code change, create a commit with a meaningful message
- Metric names with dots or special chars must be wrapped in `[...]` in expression syntax
- Times are in **milliseconds** in the API (`from`, `to`), but **nanoseconds** internally for MetricQ history requests
- The `apiQuerySeries.mode` field is `"values"` (raw points), `"aggregates"` (OHLC-style with min/max/avg/count), or `"empty"`
