package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"
)

//go:embed web/*
var webFS embed.FS

// main initializes the service and starts the HTTP server.
func main() {
	cfg := configFromEnv()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc, err := newService(ctx, cfg)
	if err != nil {
		log.Fatalf("failed to initialize service: %v", err)
	}
	defer svc.Close()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/config", svc.handleAPIConfig)
	mux.HandleFunc("/api/metrics", svc.handleAPIMetrics)
	mux.HandleFunc("/api/metrics/search", svc.handleAPIMetricsAdvancedSearch)
	mux.HandleFunc("/api/metrics/suggest", svc.handleAPIMetricsSuggest)
	mux.HandleFunc("/api/metrics/suggest-fields", svc.handleAPIMetricsSuggestFields)
	mux.HandleFunc("/api/metrics/resolve", svc.handleAPIMetricsResolve)
	mux.HandleFunc("/api/metadata", svc.handleAPIMetadata)
	mux.HandleFunc("/api/expression/validate", svc.handleAPIExpressionValidate)
	mux.HandleFunc("/api/query", svc.handleAPIQuery)
	mux.HandleFunc("/api/query/stacked", svc.handleAPIQueryStacked)
	mux.HandleFunc("/api/query/range", svc.handleAPIYRangeGlobal)
	mux.HandleFunc("/api/analyze", svc.handleAPIAnalyze)

	if cfg.WebDir != "" {
		info, err := os.Stat(cfg.WebDir)
		if err != nil {
			log.Fatalf("failed to stat WEB_DIR=%q: %v", cfg.WebDir, err)
		}
		if !info.IsDir() {
			log.Fatalf("WEB_DIR=%q is not a directory", cfg.WebDir)
		}
		log.Printf("serving frontend from filesystem: %s", cfg.WebDir)
		mux.Handle("/", noCacheMiddleware(http.FileServer(http.Dir(cfg.WebDir))))
	} else {
		sub, err := fs.Sub(webFS, "web")
		if err != nil {
			log.Fatalf("failed to create embedded fs view: %v", err)
		}
		mux.Handle("/", http.FileServer(http.FS(sub)))
	}

	server := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      withCORS(loggingMiddleware(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("metricq-codex listening on %s", cfg.ListenAddr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("http server failed: %v", err)
	}
}
