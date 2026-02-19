package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

func (s *service) handleAPIMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("query"))
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 5000 {
			limit = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	_, list, err := s.lookupMetrics(ctx, query, false, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrics": list})
}

func (s *service) handleAPIMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	metric := strings.TrimSpace(r.URL.Query().Get("metric"))
	if metric == "" {
		writeError(w, http.StatusBadRequest, "metric is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	meta, err := s.lookupMetadata(ctx, metric)
	if err != nil {
		writeError(w, http.StatusNotFound, "metric not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metric": metric, "metadata": meta})
}

func (s *service) handleAPIQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.Metrics) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	results := make([]apiQuerySeries, len(req.Metrics))
	waitGroupRun(req.Metrics, func(i int, metric string) {
		metric = strings.TrimSpace(metric)
		if metric == "" {
			results[i] = apiQuerySeries{Metric: metric, Error: "empty metric"}
			return
		}
		hr, duration, err := s.queryMetric(ctx, metric, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)
		if err != nil {
			results[i] = apiQuerySeries{Metric: metric, Error: err.Error()}
			return
		}
		results[i] = historyToSeries(metric, hr, duration)
	})

	writeJSON(w, http.StatusOK, map[string]any{"series": results})
}

func (s *service) handleAPIAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiAnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.Metrics) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	out := make([]apiAnalyzeEntry, len(req.Metrics))
	waitGroupRun(req.Metrics, func(i int, metric string) {
		metric = strings.TrimSpace(metric)
		entry := apiAnalyzeEntry{Metric: metric}
		hr, duration, err := s.requestHistory(ctx, historyRequest{
			Metric:      metric,
			StartTimeNS: req.FromUnixMS * int64(time.Millisecond),
			EndTimeNS:   req.ToUnixMS * int64(time.Millisecond),
			RequestType: historyRequestTypeAggregate,
			Timeout:     s.cfg.QueryTimeout,
		})
		entry.Duration = duration
		if err != nil {
			entry.Error = err.Error()
			out[i] = entry
			return
		}
		if len(hr.Agg) != 1 {
			entry.Error = "unexpected response"
			out[i] = entry
			return
		}
		agg := hr.Agg[0]
		entry.Minimum = agg.Minimum
		entry.Maximum = agg.Maximum
		entry.Sum = agg.Sum
		entry.Count = agg.Count
		entry.Mean = safeMean(agg.Sum, agg.Count)
		out[i] = entry
	})

	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

func (s *service) handleAPIYRangeGlobal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiYRangeGlobalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.Metrics) == 0 {
		writeError(w, http.StatusBadRequest, "metrics are required")
		return
	}

	nowMS := time.Now().UnixMilli()
	toMS := req.ToUnixMS
	if toMS <= 0 {
		toMS = nowMS
	}
	fromMS := req.FromUnixMS
	if fromMS <= 0 || fromMS >= toMS {
		// "Global enough" default range without querying from epoch.
		fromMS = toMS - int64((24*time.Hour*365*10)/time.Millisecond)
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	minY := math.Inf(1)
	maxY := math.Inf(-1)
	used := make([]string, 0, len(req.Metrics))
	var mu sync.Mutex

	waitGroupRun(req.Metrics, func(_ int, metric string) {
		metric = strings.TrimSpace(metric)
		if metric == "" {
			return
		}
		hr, _, err := s.requestHistory(ctx, historyRequest{
			Metric:      metric,
			StartTimeNS: fromMS * int64(time.Millisecond),
			EndTimeNS:   toMS * int64(time.Millisecond),
			RequestType: historyRequestTypeAggregate,
			Timeout:     s.cfg.QueryTimeout,
		})
		if err != nil || len(hr.Agg) != 1 || hr.Agg[0].Count == 0 {
			return
		}
		agg := hr.Agg[0]

		mu.Lock()
		if agg.Minimum < minY {
			minY = agg.Minimum
		}
		if agg.Maximum > maxY {
			maxY = agg.Maximum
		}
		used = append(used, metric)
		mu.Unlock()
	})

	if math.IsInf(minY, 0) || math.IsNaN(minY) || math.IsInf(maxY, 0) || math.IsNaN(maxY) || minY >= maxY {
		writeError(w, http.StatusNotFound, "no aggregate range available for requested metrics")
		return
	}

	writeJSON(w, http.StatusOK, apiYRangeGlobalResponse{
		Minimum: minY,
		Maximum: maxY,
		Metrics: used,
	})
}
