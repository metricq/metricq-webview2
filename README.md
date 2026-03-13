# metricq-codex

`metricq-codex` ist eine moderne Neuimplementierung des MetricQ-Webviews:
- kein Vue-2, kein Build-Step für das Frontend
- Vanilla HTML/CSS/JS + Bootstrap 5 (CDN)
- Go-Backend mit direkter MetricQ-Anbindung über `metricq-go`
- Frontend ist per `go:embed` in das Binary eingebettet

## Ziele

- ähnlicher Stil und Bedienkonzept wie `metricq-webview`
- vergleichbarer Feature-Umfang: Metriksuche, Zeitbereich, Mehrfachplot, Min/Max-Band, Analyse, Export
- kleiner und wartbarer Stack

## Start

```bash
cd metricq-codex
go run .
```

## Tests

Backend:

```bash
go test ./...
```

Frontend (ohne npm, via Node built-in test runner):

```bash
node --test web/tests/time-axis.test.mjs
```

Konfiguration (ENV):
- `LISTEN_ADDR` (Default `:80`)
- `METRICQ_SERVER` (Default `amqp://guest:guest@localhost:5672/`)
- `METRICQ_TOKEN` (Default `metricq-codex`)
- `QUERY_TIMEOUT_SECONDS` (Default `30`)
- `WEB_DIR` (optional, wenn gesetzt: statische Frontend-Dateien direkt aus diesem Verzeichnis serven)

Beispiel:

```bash
LISTEN_ADDR=:80 \
METRICQ_SERVER=amqp://user:pass@rabbitmq:5672/ \
METRICQ_TOKEN=metricq-codex \
go run .
```

### Frontend-Entwicklung ohne Backend-Neustart

Standardmäßig wird das Frontend via `go:embed` ausgeliefert (Build-Zeit-Snapshot).
Für Live-Entwicklung kannst du stattdessen direkt vom Dateisystem serven:

```bash
cd metricq-codex
WEB_DIR=./web LISTEN_ADDR=:8080 go run .
```

Dann reichen Browser-Reloads, um HTML/CSS/JS-Änderungen zu sehen, ohne den Go-Prozess neu zu starten.

## API

Aktuell registrierte Endpunkte:
- `GET /api/health`
- `GET /api/metrics?query=<suchtext-oder-regex-body>&mode=<infix|selector>&limit=<n>`
- `GET /api/metadata?metric=<name>`
- `POST /api/query`
- `POST /api/query/stacked`
- `POST /api/query/range`
- `POST /api/analyze`

### `POST /api/query`

Request:
- Zeitbereich und Dichte:
  - `from` (unix ms)
  - `to` (unix ms)
  - `maxDataPoints` (int)
- Ziele entweder als:
  - `metrics: string[]` (einfache Metriknamen), oder
  - `targets: [{ name?, metric? , expr? }]`

Hinweise:
- `metric` und `expr` sind pro Target gegenseitig exklusiv.
- `name` ist optional (Fallback: `metric` bzw. `expr`).

Response:
- `{ "series": apiQuerySeries[] }`
- `apiQuerySeries.mode` ist `"values"` oder `"aggregates"` (bei Fehlern mit `error`).

### `POST /api/query/stacked`

Gleicher Request wie bei `/api/query`, aber Response ist für Frontend-Stacking resampled und aligned:
- `times: number[]`
- `metrics: string[]`
- `values: (number|null)[][]`

`values[i][j]` ist der Wert der `i`-ten Metrik zum `j`-ten Zeitpunkt aus `times`.
`null` bedeutet: kein gültiger Wert zu diesem Zeitpunkt (z. B. außerhalb `activeTime` unter Last-Semantik).

### `POST /api/query/range`

Request:
- `metrics: string[]`
- optional `from`, `to` (unix ms; falls leer: Backend-Defaultbereich)

Response:
- `{ "minimum": number, "maximum": number, "metrics": string[] }`

### `POST /api/analyze`

Request:
- `from`, `to` (unix ms)
- `metrics` oder `targets` (wie bei `/api/query`)

Response:
- `{ "entries": [{ metric, minimum, maximum, sum, count, mean, duration, error? }, ...] }`

## Hinweis zu alten Routen

Die früher dokumentierten Alias-/Legacy-Routen (`/search`, `/query`, `/legacy/*`, etc.) sind im aktuellen Stand **nicht** mehr registriert.
