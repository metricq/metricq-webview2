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

func (s *service) requestHistory(ctx context.Context, req historyRequest) (historyResponse, float64, error) {
	if req.Timeout <= 0 {
		req.Timeout = s.cfg.QueryTimeout
	}
	callCtx := ctx
	var cancel context.CancelFunc
	if req.Timeout > 0 {
		callCtx, cancel = context.WithTimeout(ctx, req.Timeout)
		defer cancel()
	}

	resp, duration, err := s.history.Request(
		callCtx,
		req.Metric,
		time.Unix(0, req.StartTimeNS),
		time.Unix(0, req.EndTimeNS),
		time.Duration(req.IntervalMax),
		req.RequestType,
	)
	if err != nil {
		return historyResponse{}, 0, err
	}
	aggs := resp.GetAggregate()
	outAgg := make([]historyAggregate, len(aggs))
	for i, agg := range aggs {
		if agg != nil {
			outAgg[i] = *agg
		}
	}
	return historyResponse{
		TimeDelta: resp.GetTimeDelta(),
		Values:    resp.GetValue(),
		Agg:       outAgg,
		Error:     resp.GetError(),
	}, duration.Seconds(), nil
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
	return s.lookupMetricsByPayload(ctx, payload, metadata)
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
	return s.lookupMetricsByPayload(ctx, payload, metadata)
}

func (s *service) lookupMetricsByPayload(ctx context.Context, payload metricLookupRequest, metadata bool) (map[string]map[string]any, []string, error) {

	resp, err := s.agent.Rpc(ctx, "metricq.management", "get_metrics", payload)
	if err != nil {
		return nil, nil, err
	}

	if metadata {
		var out struct {
			Metrics map[string]map[string]any `json:"metrics"`
		}
		if err := json.Unmarshal(resp, &out); err != nil {
			return nil, nil, err
		}
		return out.Metrics, nil, nil
	}

	var out struct {
		Metrics []string `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, nil, err
	}
	sort.Strings(out.Metrics)
	return nil, out.Metrics, nil
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

func (s *service) queryMetric(ctx context.Context, metric string, fromMS, toMS int64, maxDataPoints int) (historyResponse, float64, error) {
	if maxDataPoints <= 0 {
		maxDataPoints = 1000
	}
	spanNS := (toMS - fromMS) * int64(time.Millisecond)
	intervalNS := (spanNS / int64(maxDataPoints)) * 2
	if intervalNS <= 0 {
		intervalNS = int64(time.Millisecond)
	}
	return s.requestHistory(ctx, historyRequest{
		Metric:      metric,
		StartTimeNS: fromMS * int64(time.Millisecond),
		EndTimeNS:   toMS * int64(time.Millisecond),
		IntervalMax: intervalNS,
		RequestType: historyRequestTypeFlexTimeline,
		Timeout:     s.cfg.QueryTimeout,
	})
}

func historyToSeries(metric string, hr historyResponse, duration float64) apiQuerySeries {
	series := apiQuerySeries{Metric: metric, Duration: duration, Stats: map[string]any{}}
	if hr.Error != "" {
		series.Error = hr.Error
		return series
	}
	if len(hr.TimeDelta) == len(hr.Values) && len(hr.Values) > 0 {
		series.Mode = "values"
		series.Points = make([]apiPoint, 0, len(hr.Values))
		ts := int64(0)
		for i, value := range hr.Values {
			ts += hr.TimeDelta[i]
			series.Points = append(series.Points, apiPoint{T: ts / int64(time.Millisecond), V: value})
		}
		series.SampleCount = uint64(len(series.Points))
		series.Stats["type"] = "raw"
		return series
	}
	if len(hr.TimeDelta) == len(hr.Agg) && len(hr.Agg) > 0 {
		series.Mode = "aggregates"
		series.AggPoints = make([]apiAggPoint, 0, len(hr.Agg))
		ts := int64(0)
		var sampleCount uint64
		for i, agg := range hr.Agg {
			ts += hr.TimeDelta[i]
			avg := aggregateMean(agg)
			activeTimeMS := agg.ActiveTime / int64(time.Millisecond)
			if agg.ActiveTime > 0 && activeTimeMS == 0 {
				activeTimeMS = 1
			}
			series.AggPoints = append(series.AggPoints, apiAggPoint{
				T:            ts / int64(time.Millisecond),
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
	}
	series.Mode = "empty"
	series.Stats["type"] = "empty"
	return series
}

func scaleValueByFunction(agg historyAggregate, fn string, scale float64) float64 {
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

func aggregateMean(agg historyAggregate) float64 {
	// Prefer time-weighted mean for last-semantics aggregates.
	if agg.ActiveTime > 0 {
		return agg.Integral / float64(agg.ActiveTime)
	}
	if agg.Count > 0 {
		return agg.Sum / float64(agg.Count)
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
