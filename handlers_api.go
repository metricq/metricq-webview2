package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
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
	infix, selector := splitMetricSearchQuery(query)
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 5000 {
			limit = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var (
		list []string
		err  error
	)
	if selector != "" {
		_, list, err = s.lookupMetricsSelector(ctx, selector, false, limit)
	} else {
		_, list, err = s.lookupMetrics(ctx, infix, false, limit)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrics": list})
}

func splitMetricSearchQuery(query string) (infix, selector string) {
	q := strings.TrimSpace(query)
	if len(q) >= 2 && strings.HasPrefix(q, "/") && strings.HasSuffix(q, "/") {
		mid := strings.TrimSpace(q[1 : len(q)-1])
		if mid != "" {
			return "", mid
		}
	}
	return q, ""
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
	targets, err := resolveQueryTargets(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(targets) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	results, err := s.executeAPIQuery(ctx, req, targets)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"series": results})
}

func (s *service) handleAPIQueryStacked(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	targets, err := resolveQueryTargets(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(targets) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	results, err := s.executeAPIQuery(ctx, req, targets)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	resp, err := alignStackedSeries(results)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *service) executeAPIQuery(ctx context.Context, req apiQueryRequest, targets []apiQueryTarget) ([]apiQuerySeries, error) {

	type evalTarget struct {
		name         string
		sourceMetric string
		expr         string
		root         exprNode
		parseErr     error
		dependencies []string
	}

	planned := make([]evalTarget, len(targets))
	sourceMetricSet := map[string]struct{}{}
	for i, target := range targets {
		planned[i] = evalTarget{
			name:         target.Name,
			sourceMetric: target.Metric,
			expr:         target.Expr,
		}
		if target.Expr == "" {
			sourceMetricSet[target.Metric] = struct{}{}
			continue
		}
		root, parseErr := parseExpression(target.Expr)
		if parseErr != nil {
			planned[i].parseErr = parseErr
			continue
		}
		deps := metricsInExpression(root)
		planned[i].root = root
		planned[i].dependencies = deps
		for _, metric := range deps {
			sourceMetricSet[metric] = struct{}{}
		}
	}

	sourceMetrics := make([]string, 0, len(sourceMetricSet))
	for metric := range sourceMetricSet {
		sourceMetrics = append(sourceMetrics, metric)
	}
	sort.Strings(sourceMetrics)

	sourceSeries := map[string]apiQuerySeries{}
	sourceValueMaps := map[string]map[int64]evalSample{}
	sourceErrs := map[string]string{}
	var mu sync.Mutex
	waitGroupRun(sourceMetrics, func(_ int, metric string) {
		hr, duration, qErr := s.queryMetric(ctx, metric, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)
		if qErr != nil {
			mu.Lock()
			sourceErrs[metric] = qErr.Error()
			mu.Unlock()
			return
		}
		series := historyToSeries(metric, hr, duration)
		mu.Lock()
		sourceSeries[metric] = series
		if series.Error != "" {
			sourceErrs[metric] = series.Error
		} else {
			sourceValueMaps[metric] = seriesToEvalInputMap(series)
		}
		mu.Unlock()
	})

	results := make([]apiQuerySeries, len(planned))
	for i, target := range planned {
		if target.expr == "" {
			base, ok := sourceSeries[target.sourceMetric]
			if !ok {
				results[i] = apiQuerySeries{Metric: target.name, Error: sourceErrs[target.sourceMetric]}
				continue
			}
			base.Metric = target.name
			results[i] = base
			continue
		}
		if target.parseErr != nil {
			results[i] = apiQuerySeries{
				Metric: target.name,
				Error:  fmt.Sprintf("invalid expression: %v", target.parseErr),
			}
			continue
		}

		inputs := make(map[string]map[int64]evalSample, len(target.dependencies))
		depDuration := 0.0
		missingMetric := ""
		missingErr := ""
		for _, metric := range target.dependencies {
			if errText := strings.TrimSpace(sourceErrs[metric]); errText != "" {
				missingMetric = metric
				missingErr = errText
				break
			}
			values, ok := sourceValueMaps[metric]
			if !ok {
				missingMetric = metric
				missingErr = "missing source series"
				break
			}
			inputs[metric] = values
			if src, ok := sourceSeries[metric]; ok && src.Duration > depDuration {
				depDuration = src.Duration
			}
		}
		if missingMetric != "" {
			results[i] = apiQuerySeries{
				Metric: target.name,
				Error:  fmt.Sprintf("source metric %q failed: %s", missingMetric, missingErr),
			}
			continue
		}

		values, evalErr := evalExpressionWithSamples(target.root, inputs)
		if evalErr != nil {
			results[i] = apiQuerySeries{
				Metric: target.name,
				Error:  fmt.Sprintf("failed to evaluate expression: %v", evalErr),
			}
			continue
		}
		results[i] = valuesToPointSeries(target.name, values, depDuration)
	}
	return results, nil
}

type stackedValuePoint struct {
	t int64
	v float64
}

func seriesToStackedPoints(series apiQuerySeries) []stackedValuePoint {
	switch series.Mode {
	case "values":
		out := make([]stackedValuePoint, 0, len(series.Points))
		for _, point := range series.Points {
			if math.IsNaN(point.V) || math.IsInf(point.V, 0) {
				continue
			}
			out = append(out, stackedValuePoint{t: point.T, v: point.V})
		}
		return out
	case "aggregates":
		out := make([]stackedValuePoint, 0, len(series.AggPoints))
		for _, point := range series.AggPoints {
			if point.Count == 0 || math.IsNaN(point.Avg) || math.IsInf(point.Avg, 0) {
				continue
			}
			out = append(out, stackedValuePoint{t: point.T, v: point.Avg})
		}
		return out
	default:
		return nil
	}
}

func alignStackedSeries(series []apiQuerySeries) (apiStackedSeriesResponse, error) {
	timelineSet := map[int64]struct{}{}
	pointsByMetric := make([][]stackedValuePoint, 0, len(series))
	metricNames := make([]string, 0, len(series))
	for _, item := range series {
		if errText := strings.TrimSpace(item.Error); errText != "" {
			return apiStackedSeriesResponse{}, fmt.Errorf("metric %q failed: %s", item.Metric, errText)
		}
		points := seriesToStackedPoints(item)
		if len(points) == 0 {
			continue
		}
		pointsByMetric = append(pointsByMetric, points)
		metricNames = append(metricNames, item.Metric)
		for _, point := range points {
			timelineSet[point.t] = struct{}{}
		}
	}
	if len(metricNames) == 0 {
		return apiStackedSeriesResponse{
			Times:   []int64{},
			Metrics: []string{},
			Values:  [][]float64{},
		}, nil
	}

	timeline := make([]int64, 0, len(timelineSet))
	for t := range timelineSet {
		timeline = append(timeline, t)
	}
	sort.Slice(timeline, func(i, j int) bool { return timeline[i] < timeline[j] })
	if len(timeline) == 0 {
		return apiStackedSeriesResponse{}, fmt.Errorf("no aligned timeline points")
	}

	values := make([][]float64, len(metricNames))
	for i, points := range pointsByMetric {
		row := make([]float64, len(timeline))
		cursor := 0
		last := points[0].v
		for idx, t := range timeline {
			for cursor+1 < len(points) && points[cursor+1].t <= t {
				cursor++
				last = points[cursor].v
			}
			row[idx] = last
		}
		values[i] = row
	}

	return apiStackedSeriesResponse{
		Times:   timeline,
		Metrics: metricNames,
		Values:  values,
	}, nil
}

func resolveQueryTargets(req apiQueryRequest) ([]apiQueryTarget, error) {
	if len(req.Targets) == 0 {
		targets := make([]apiQueryTarget, 0, len(req.Metrics))
		for _, metric := range req.Metrics {
			trimmed := strings.TrimSpace(metric)
			if trimmed == "" {
				continue
			}
			targets = append(targets, apiQueryTarget{Name: trimmed, Metric: trimmed})
		}
		return targets, nil
	}

	targets := make([]apiQueryTarget, 0, len(req.Targets))
	seenNames := map[string]struct{}{}
	for _, raw := range req.Targets {
		name := strings.TrimSpace(raw.Name)
		metric := strings.TrimSpace(raw.Metric)
		expr := strings.TrimSpace(raw.Expr)
		if metric == "" && expr == "" {
			return nil, fmt.Errorf("target requires metric or expr")
		}
		if metric != "" && expr != "" {
			return nil, fmt.Errorf("target %q has both metric and expr", name)
		}
		if name == "" {
			if metric != "" {
				name = metric
			} else {
				name = expr
			}
		}
		if _, exists := seenNames[name]; exists {
			return nil, fmt.Errorf("duplicate target name %q", name)
		}
		seenNames[name] = struct{}{}
		targets = append(targets, apiQueryTarget{
			Name:   name,
			Metric: metric,
			Expr:   expr,
		})
	}
	return targets, nil
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
	targets, err := resolveQueryTargets(apiQueryRequest{
		Targets: req.Targets,
		Metrics: req.Metrics,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(targets) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	type evalTarget struct {
		name         string
		sourceMetric string
		expr         string
		root         exprNode
		parseErr     error
		dependencies []string
	}

	planned := make([]evalTarget, len(targets))
	sourceMetricSet := map[string]struct{}{}
	for i, target := range targets {
		planned[i] = evalTarget{
			name:         target.Name,
			sourceMetric: target.Metric,
			expr:         target.Expr,
		}
		if target.Expr == "" {
			continue
		}
		root, parseErr := parseExpression(target.Expr)
		if parseErr != nil {
			planned[i].parseErr = parseErr
			continue
		}
		deps := metricsInExpression(root)
		planned[i].root = root
		planned[i].dependencies = deps
		for _, metric := range deps {
			sourceMetricSet[metric] = struct{}{}
		}
	}

	sourceMetrics := make([]string, 0, len(sourceMetricSet))
	for metric := range sourceMetricSet {
		sourceMetrics = append(sourceMetrics, metric)
	}
	sort.Strings(sourceMetrics)

	sourceSeries := map[string]apiQuerySeries{}
	sourceValueMaps := map[string]map[int64]evalSample{}
	sourceErrs := map[string]string{}
	var mu sync.Mutex
	waitGroupRun(sourceMetrics, func(_ int, metric string) {
		// Slightly denser timeline for stable expression stats across zoom levels.
		hr, duration, qErr := s.queryMetric(ctx, metric, req.FromUnixMS, req.ToUnixMS, 4096)
		if qErr != nil {
			mu.Lock()
			sourceErrs[metric] = qErr.Error()
			mu.Unlock()
			return
		}
		series := historyToSeries(metric, hr, duration)
		mu.Lock()
		sourceSeries[metric] = series
		if series.Error != "" {
			sourceErrs[metric] = series.Error
		} else {
			sourceValueMaps[metric] = seriesToEvalInputMap(series)
		}
		mu.Unlock()
	})

	out := make([]apiAnalyzeEntry, len(planned))
	for i, target := range planned {
		entry := apiAnalyzeEntry{Metric: target.name}
		if target.expr == "" {
			hr, duration, reqErr := s.requestHistory(ctx, historyRequest{
				Metric:      target.sourceMetric,
				StartTimeNS: req.FromUnixMS * int64(time.Millisecond),
				EndTimeNS:   req.ToUnixMS * int64(time.Millisecond),
				RequestType: historyRequestTypeAggregate,
				Timeout:     s.cfg.QueryTimeout,
			})
			entry.Duration = duration
			if reqErr != nil {
				entry.Error = reqErr.Error()
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
			continue
		}

		if target.parseErr != nil {
			entry.Error = fmt.Sprintf("invalid expression: %v", target.parseErr)
			out[i] = entry
			continue
		}
		inputs := make(map[string]map[int64]evalSample, len(target.dependencies))
		failed := false
		for _, metric := range target.dependencies {
			if errText := strings.TrimSpace(sourceErrs[metric]); errText != "" {
				entry.Error = fmt.Sprintf("source metric %q failed: %s", metric, errText)
				out[i] = entry
				failed = true
				break
			}
			values, ok := sourceValueMaps[metric]
			if !ok {
				entry.Error = fmt.Sprintf("source metric %q missing", metric)
				out[i] = entry
				failed = true
				break
			}
			inputs[metric] = values
			if src := sourceSeries[metric]; src.Duration > entry.Duration {
				entry.Duration = src.Duration
			}
		}
		if failed {
			continue
		}

		values, evalErr := evalExpressionWithSamples(target.root, inputs)
		if evalErr != nil {
			entry.Error = fmt.Sprintf("failed to evaluate expression: %v", evalErr)
			out[i] = entry
			continue
		}
		minimum, maximum, sum, count, ok := analyzeValueMap(values)
		if !ok {
			entry.Error = "no data"
			out[i] = entry
			continue
		}
		entry.Minimum = minimum
		entry.Maximum = maximum
		entry.Sum = sum
		entry.Count = count
		entry.Mean = safeMean(sum, count)
		out[i] = entry
	}

	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

func analyzeValueMap(values map[int64]float64) (minimum, maximum, sum float64, count uint64, ok bool) {
	minimum = math.Inf(1)
	maximum = math.Inf(-1)
	sum = 0
	count = 0
	for _, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		if v < minimum {
			minimum = v
		}
		if v > maximum {
			maximum = v
		}
		sum += v
		count++
	}
	if count == 0 || math.IsInf(minimum, 0) || math.IsInf(maximum, 0) {
		return 0, 0, 0, 0, false
	}
	return minimum, maximum, sum, count, true
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
