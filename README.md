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

## API (neu)

- `GET /api/health`
- `GET /api/metrics?query=<infix>&limit=<n>`
- `GET /api/metadata?metric=<name>`
- `POST /api/query` (`metrics`, `from`, `to`, `maxDataPoints`)
- `POST /api/analyze` (`metrics`, `from`, `to`)

## Kompatibilitätsrouten

Für bestehende Clients sind folgende Endpunkte zusätzlich vorhanden:
- `POST /search`
- `POST /metadata`
- `POST /query`
- `POST /analyze`
- `POST /legacy/cntr_status.php`
- `GET /legacy/counter_data.php`

Hinweis: `POST /timeline` ist derzeit als `not implemented` markiert.
