package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *service) handleCompatSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Target   string `json:"target"`
		Metadata bool   `json:"metadata"`
		Limit    int    `json:"limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.Limit <= 0 {
		body.Limit = 100
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	meta, list, err := s.lookupMetrics(ctx, body.Target, body.Metadata, body.Limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if body.Metadata {
		writeJSON(w, http.StatusOK, meta)
	} else {
		writeJSON(w, http.StatusOK, list)
	}
}

func (s *service) handleCompatMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	meta, err := s.lookupMetadata(ctx, body.Target)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"target": meta})
}

func (s *service) handleCompatQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req compatQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	from, err1 := parseISOToUnixMS(req.Range.From)
	to, err2 := parseISOToUnixMS(req.Range.To)
	if err1 != nil || err2 != nil || to <= from {
		writeError(w, http.StatusBadRequest, "invalid range")
		return
	}
	if req.MaxDataPoints <= 0 {
		req.MaxDataPoints = 1000
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	type point struct {
		Target string         `json:"target"`
		TM     map[string]any `json:"time_measurements"`
		Data   [][2]float64   `json:"datapoints"`
	}

	var out []point
	for _, target := range req.Targets {
		metric := strings.TrimSpace(target.Metric)
		if metric == "" {
			continue
		}
		hr, duration, err := s.queryMetric(ctx, metric, from, to, req.MaxDataPoints)
		if err != nil {
			continue
		}

		fns := target.Functions
		if len(fns) == 0 {
			fns = []string{"avg"}
		}

		if len(hr.Agg) == 0 && len(hr.Values) > 0 {
			if containsFn(fns, "avg") {
				data := make([][2]float64, 0, len(hr.Values))
				ts := int64(0)
				for i, v := range hr.Values {
					ts += hr.TimeDelta[i]
					data = append(data, [2]float64{v, float64(ts / int64(time.Millisecond))})
				}
				out = append(out, point{Target: metric + "/raw", TM: map[string]any{"db": duration, "http": duration}, Data: data})
			}
			continue
		}
		if len(hr.Agg) == 0 {
			continue
		}

		scale := 1.0
		if target.ScalingFactor != "" {
			if parsed, err := strconv.ParseFloat(target.ScalingFactor, 64); err == nil {
				scale = parsed
			}
		}

		for _, fn := range fns {
			data := make([][2]float64, 0, len(hr.Agg))
			ts := int64(0)
			for i, agg := range hr.Agg {
				ts += hr.TimeDelta[i]
				if agg.Count == 0 {
					continue
				}
				v := scaleValueByFunction(agg, fn, scale)
				data = append(data, [2]float64{v, float64(ts / int64(time.Millisecond))})
			}
			out = append(out, point{Target: metric + "/" + fn, TM: map[string]any{"db": duration, "http": duration}, Data: data})
		}
	}

	writeJSON(w, http.StatusOK, out)
}

func (s *service) handleCompatAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req compatAnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	from, err1 := parseISOToUnixMS(req.Range.From)
	to, err2 := parseISOToUnixMS(req.Range.To)
	if err1 != nil || err2 != nil || to <= from {
		writeError(w, http.StatusBadRequest, "invalid range")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	out := make([]map[string]any, 0, len(req.Targets))
	for _, target := range req.Targets {
		hr, duration, err := s.requestHistory(ctx, historyRequest{
			Metric:      target.Metric,
			StartTimeNS: from * int64(time.Millisecond),
			EndTimeNS:   to * int64(time.Millisecond),
			RequestType: historyRequestTypeAggregate,
			Timeout:     s.cfg.QueryTimeout,
		})
		if err != nil || len(hr.Agg) != 1 {
			continue
		}
		agg := hr.Agg[0]
		mean := safeMean(agg.Sum, agg.Count)
		out = append(out, map[string]any{
			"target":            target.Metric,
			"time_measurements": map[string]any{"db": duration, "http": duration},
			"minimum":           agg.Minimum,
			"maximum":           agg.Maximum,
			"sum":               agg.Sum,
			"count":             agg.Count,
			"integral_ns":       agg.Integral,
			"active_time_ns":    agg.ActiveTime,
			"mean":              mean,
			"mean_integral":     mean,
			"mean_sum":          mean,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *service) handleCompatTimeline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Range struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"range"`
		MaxDataPoints int      `json:"maxDataPoints"`
		Metrics       []string `json:"metrics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	from, err1 := parseISOToUnixMS(req.Range.From)
	to, err2 := parseISOToUnixMS(req.Range.To)
	if err1 != nil || err2 != nil || to <= from {
		writeError(w, http.StatusBadRequest, "invalid range")
		return
	}
	if req.MaxDataPoints <= 0 {
		req.MaxDataPoints = 1000
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	resp := map[string]any{}
	for _, metric := range req.Metrics {
		hr, duration, err := s.queryMetric(ctx, metric, from, to, req.MaxDataPoints)
		if err != nil {
			resp[metric] = map[string]any{"error": err.Error()}
			continue
		}

		if len(hr.TimeDelta) == len(hr.Values) && len(hr.Values) > 0 {
			values := make([]map[string]any, 0, len(hr.Values))
			ts := int64(0)
			for i, v := range hr.Values {
				ts += hr.TimeDelta[i]
				values = append(values, buildCompatTimelineValue(ts, v))
			}
			resp[metric] = map[string]any{
				"mode":              "values",
				"time_measurements": map[string]any{"db": duration, "http": duration},
				"values":            values,
			}
			continue
		}

		if len(hr.TimeDelta) == len(hr.Agg) && len(hr.Agg) > 0 {
			aggregates := make([]map[string]any, 0, len(hr.Agg))
			ts := int64(0)
			for i, agg := range hr.Agg {
				ts += hr.TimeDelta[i]
				aggregates = append(aggregates, buildCompatTimelineAggregate(ts, agg))
			}
			resp[metric] = map[string]any{
				"mode":              "aggregates",
				"time_measurements": map[string]any{"db": duration, "http": duration},
				"aggregates":        aggregates,
			}
			continue
		}

		resp[metric] = map[string]any{
			"mode":              "empty",
			"time_measurements": map[string]any{"db": duration, "http": duration},
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *service) handleLegacyCounterStatus(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, "invalid form")
		return
	}
	selector := r.Form.Get("selector")
	if selector == "" {
		writeError(w, http.StatusBadRequest, "missing selector")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	meta, _, err := s.lookupMetrics(ctx, selector, true, 500)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	lines := make([]string, 0, len(meta))
	for metric, m := range meta {
		desc := ""
		if v, ok := m["description"].(string); ok {
			desc = v
		}
		lines = append(lines, metric+";"+desc)
	}
	sort.Strings(lines)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(strings.Join(lines, "\n")))
}

func (s *service) handleLegacyCounterData(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("cntr")
	start, _ := strconv.ParseInt(r.URL.Query().Get("start"), 10, 64)
	stop, _ := strconv.ParseInt(r.URL.Query().Get("stop"), 10, 64)
	width, _ := strconv.Atoi(r.URL.Query().Get("width"))
	if metric == "" || start <= 0 || stop <= start {
		writeError(w, http.StatusBadRequest, "invalid parameters")
		return
	}
	if width <= 0 {
		width = 1000
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	hr, _, err := s.queryMetric(ctx, metric, start, stop, width)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"description": "error", "unit": "", "data": []any{}})
		return
	}
	series := historyToSeries(metric, hr, 0)
	data := make([][2]float64, 0)
	if series.Mode == "values" {
		for _, p := range series.Points {
			data = append(data, [2]float64{float64(p.T), p.V})
		}
	} else {
		for _, p := range series.AggPoints {
			data = append(data, [2]float64{float64(p.T), p.Avg})
		}
	}
	ctxMeta, cancelMeta := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancelMeta()
	meta, _ := s.lookupMetadata(ctxMeta, metric)
	desc, _ := meta["description"].(string)
	unit, _ := meta["unit"].(string)
	writeJSON(w, http.StatusOK, map[string]any{"description": desc, "unit": unit, "data": data})
}
