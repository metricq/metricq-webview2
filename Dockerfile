FROM golang:1.24.4 AS builder

WORKDIR /src

# The module uses a local replace to ../metricq-go, so the build context
# should be the parent directory and include both repositories.
COPY metricq-codex ./metricq-codex
COPY metricq-go ./metricq-go

WORKDIR /src/metricq-codex

RUN go build -o /out/metricq-codex .

FROM debian:bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /out/metricq-codex /usr/local/bin/metricq-codex

ENV LISTEN_ADDR=:80

EXPOSE 80

CMD ["metricq-codex"]
