FROM golang:1.26 AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

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
