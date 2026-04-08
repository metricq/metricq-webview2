package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func configFromEnv() config {
	cfg := config{
		ListenAddr:    ":80",
		MetricQServer: "amqp://guest:guest@localhost:5672/",
		MetricQToken:  "metricq-codex",
		QueryTimeout:  30 * time.Second,
	}
	if v := strings.TrimSpace(os.Getenv("LISTEN_ADDR")); v != "" {
		cfg.ListenAddr = v
	}
	if v := strings.TrimSpace(os.Getenv("METRICQ_SERVER")); v != "" {
		cfg.MetricQServer = v
	}
	if v := strings.TrimSpace(os.Getenv("METRICQ_TOKEN")); v != "" {
		cfg.MetricQToken = v
	}
	if v := strings.TrimSpace(os.Getenv("QUERY_TIMEOUT_SECONDS")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			cfg.QueryTimeout = time.Duration(parsed) * time.Second
		}
	}
	if v := strings.TrimSpace(os.Getenv("WEB_DIR")); v != "" {
		cfg.WebDir = v
	}
	if v := strings.TrimSpace(os.Getenv("LEGACY_CHARTS_BASE_URL")); v != "" {
		cfg.LegacyChartsBaseURL = v
	}
	return cfg
}
