package main

import "testing"

func TestConfigFromEnvReadsLegacyChartsBaseURL(t *testing.T) {
	t.Setenv("LEGACY_CHARTS_BASE_URL", "https://legacy.example/charts/content/index.html")
	cfg := configFromEnv()
	if cfg.LegacyChartsBaseURL != "https://legacy.example/charts/content/index.html" {
		t.Fatalf("unexpected legacy charts base URL: %q", cfg.LegacyChartsBaseURL)
	}
}
