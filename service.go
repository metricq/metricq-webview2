package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	metricq "github.com/metricq/metricq-go"
)

func newService(ctx context.Context, cfg config) (*service, error) {
	agent, err := metricq.NewAgent(cfg.MetricQToken, cfg.MetricQServer)
	if err != nil {
		return nil, fmt.Errorf("new metricq agent: %w", err)
	}
	if err := agent.Connect(ctx); err != nil {
		return nil, fmt.Errorf("connect metricq management: %w", err)
	}

	history, err := metricq.NewHistoryClient(ctx, agent)
	if err != nil {
		agent.Close()
		return nil, fmt.Errorf("init history client: %w", err)
	}

	return &service{
		agent:   agent,
		history: history,
		cfg:     cfg,
	}, nil
}

func (s *service) Close() {
	s.closeOnce.Do(func() {
		if s.history != nil {
			_ = s.history.Close()
		}
		if s.agent != nil {
			s.agent.Close()
		}
	})
}

func (s *service) lookupMetrics(ctx context.Context, query string, metadata bool, limit int) (map[string]map[string]any, []string, error) {
	payload := metricLookupRequest{
		Function: "get_metrics",
		Historic: true,
		Hidden:   false,
		Limit:    limit,
	}
	if metadata {
		payload.Format = "object"
	} else {
		payload.Format = "array"
	}
	if query != "" {
		payload.Infix = query
	}
	return s.lookupMetricsByPayload(ctx, payload, metadata, "metrics.list", "get_metrics")
}

func (s *service) lookupMetricsSelector(ctx context.Context, selector string, metadata bool, limit int) (map[string]map[string]any, []string, error) {
	return s.lookupMetricsSelectors(ctx, selector, metadata, limit)
}

func (s *service) lookupMetricsSelectors(ctx context.Context, selector any, metadata bool, limit int) (map[string]map[string]any, []string, error) {
	payload := metricLookupRequest{
		Function: "get_metrics",
		Historic: true,
		Hidden:   false,
		Limit:    limit,
	}
	if metadata {
		payload.Format = "object"
	} else {
		payload.Format = "array"
	}
	if selector != nil && selector != "" {
		payload.Selector = selector
	}
	return s.lookupMetricsByPayload(ctx, payload, metadata, "metrics.list", "get_metrics")
}

func (s *service) lookupMetricsByPayload(ctx context.Context, payload any, metadata bool, rpcNames ...string) (map[string]map[string]any, []string, error) {
	if len(rpcNames) == 0 {
		rpcNames = []string{"get_metrics"}
	}
	var lastErr error
	for _, rpcName := range rpcNames {
		resp, err := s.agent.Rpc(ctx, "metricq.management", rpcName, payload)
		if err != nil {
			lastErr = err
			continue
		}
		return decodeMetricLookupResponse(resp, metadata)
	}
	return nil, nil, lastErr
}

func decodeMetricLookupResponse(resp []byte, metadata bool) (map[string]map[string]any, []string, error) {
	if metadata {
		var out struct {
			Metrics map[string]map[string]any `json:"metrics"`
		}
		if err := json.Unmarshal(resp, &out); err != nil {
			return nil, nil, err
		}
		return out.Metrics, nil, nil
	}

	var listOut struct {
		Metrics []string `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &listOut); err == nil && listOut.Metrics != nil {
		sort.Strings(listOut.Metrics)
		return nil, listOut.Metrics, nil
	}
	var objectOut struct {
		Metrics map[string]json.RawMessage `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &objectOut); err != nil {
		return nil, nil, err
	}
	list := make([]string, 0, len(objectOut.Metrics))
	for key := range objectOut.Metrics {
		list = append(list, key)
	}
	sort.Strings(list)
	return nil, list, nil
}

func decodeMetricSearchResponse(resp []byte) ([]string, error) {
	var out metricSearchResponse
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	list := make([]string, 0, len(out.Metrics))
	for _, metric := range out.Metrics {
		if metric.Name == "" {
			continue
		}
		list = append(list, metric.Name)
	}
	sort.Strings(list)
	return list, nil
}

func (s *service) lookupMetricsByDescription(ctx context.Context, query string, limit int) ([]string, error) {
	searchPayload := metricSearchRequest{
		Function: "metrics.search",
		Query:    query,
		Field:    "description",
		Mode:     "phrase",
		Historic: true,
		Limit:    limit,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "metrics.search", searchPayload)
	if err != nil {
		return nil, err
	}
	return decodeMetricSearchResponse(resp)
}

func (s *service) lookupMetadata(ctx context.Context, metric string) (map[string]any, error) {
	payload := metricLookupRequest{
		Function: "get_metrics",
		Format:   "object",
		Selector: []string{metric},
		Historic: true,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "get_metrics", payload)
	if err != nil {
		return nil, err
	}
	var out struct {
		Metrics map[string]map[string]any `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	meta, ok := out.Metrics[metric]
	if !ok {
		return nil, fmt.Errorf("metric not found")
	}
	return meta, nil
}

func (s *service) queryMetric(ctx context.Context, metric string, fromMS, toMS int64, maxDataPoints int) (metricq.TimelineResult, error) {
	if maxDataPoints <= 0 {
		maxDataPoints = 1000
	}
	spanNS := (toMS - fromMS) * int64(time.Millisecond)
	intervalNS := (spanNS / int64(maxDataPoints)) * 2
	if intervalNS <= 0 {
		intervalNS = int64(time.Millisecond)
	}
	return s.history.RequestTimeline(
		ctx,
		metric,
		time.UnixMilli(fromMS),
		time.UnixMilli(toMS),
		time.Duration(intervalNS),
	)
}

func historyToSeries(metric string, timeline metricq.TimelineResult) apiQuerySeries {
	series := apiQuerySeries{Metric: metric, Stats: map[string]any{}}
	switch data := timeline.(type) {
	case nil:
		series.Mode = "empty"
		series.Stats["type"] = "empty"
		return series
	case *metricq.TimelineValues:
		series.Duration = data.Duration.Seconds()
		series.Mode = "values"
		series.Points = make([]apiPoint, 0, len(data.Values))
		for i, value := range data.Values {
			series.Points = append(series.Points, apiPoint{T: data.Times[i].UnixMilli(), V: value})
		}
		series.SampleCount = uint64(len(series.Points))
		series.Stats["type"] = "raw"
		return series
	case *metricq.TimelineAggregates:
		series.Duration = data.Duration.Seconds()
		series.Mode = "aggregates"
		series.AggPoints = make([]apiAggPoint, 0, len(data.Agg))
		var sampleCount uint64
		for i, agg := range data.Agg {
			avg := aggregateMean(agg)
			activeTimeMS := agg.ActiveTime / int64(time.Millisecond)
			if agg.ActiveTime > 0 && activeTimeMS == 0 {
				activeTimeMS = 1
			}
			series.AggPoints = append(series.AggPoints, apiAggPoint{
				T:            data.Times[i].UnixMilli(),
				Min:          agg.Minimum,
				Max:          agg.Maximum,
				Avg:          avg,
				Count:        agg.Count,
				ActiveTimeMS: activeTimeMS,
			})
			sampleCount += agg.Count
		}
		series.SampleCount = sampleCount
		series.Stats["type"] = "aggregate"
		return series
	default:
		series.Error = "unexpected timeline response"
		return series
	}
}

func scaleValueByFunction(agg *metricq.HistoryResponse_Aggregate, fn string, scale float64) float64 {
	switch fn {
	case "min":
		return agg.Minimum * scale
	case "max":
		return agg.Maximum * scale
	case "count":
		return float64(agg.Count)
	default:
		return aggregateMean(agg) * scale
	}
}

func aggregateMean(agg *metricq.HistoryResponse_Aggregate) float64 {
	if agg == nil {
		return 0
	}
	if mean, err := agg.Mean(); err == nil {
		return mean
	}
	return 0
}

func safeMean(sum float64, count uint64) float64 {
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

func waitGroupRun(metrics []string, fn func(i int, metric string)) {
	var wg sync.WaitGroup
	wg.Add(len(metrics))
	for i, metric := range metrics {
		i := i
		metric := metric
		go func() {
			defer wg.Done()
			fn(i, metric)
		}()
	}
	wg.Wait()
}

func avgOrNaN(sum float64, count uint64) float64 {
	if count == 0 {
		return math.NaN()
	}
	return sum / float64(count)
}
