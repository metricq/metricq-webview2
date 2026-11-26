FROM golang:1.24.4 AS builder

WORKDIR /src

# The module uses a local replace to ../metricq-go, so the build context
# should be the parent directory and include both repositories.
COPY metricq-webview2 ./metricq-webview2
COPY metricq-go ./metricq-go

WORKDIR /src/metricq-webview2

RUN go build -o /out/metricq-webview2 .

FROM debian:bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /out/metricq-webview2 /usr/local/bin/metricq-webview2

ENV LISTEN_ADDR=:80

EXPOSE 80

CMD ["metricq-webview2"]
