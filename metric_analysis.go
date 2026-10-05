package main

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	metricq "github.com/metricq/metricq-go"
)

// analyzeQueryTargets computes summary statistics for direct and computed targets.
func (s *service) analyzeQueryTargets(ctx context.Context, req apiAnalyzeRequest, targets []apiQueryTarget) []apiAnalyzeEntry {
	planned, sourceMetrics := planQueryTargets(targets, false)
	source := s.loadMetricSourceData(ctx, sourceMetrics, req.FromUnixMS, req.ToUnixMS, 4096)

	out := make([]apiAnalyzeEntry, len(planned))
	for i, target := range planned {
		entry := apiAnalyzeEntry{Metric: target.name}
		if target.expr == "" {
			s.populateAnalyzeEntryFromMetric(ctx, &entry, target.sourceMetric, req.FromUnixMS, req.ToUnixMS)
			out[i] = entry
			continue
		}
		if target.parseErr != nil {
			entry.Error = fmt.Sprintf("invalid expression: %v", target.parseErr)
			entry.ErrorInfo = expressionErrorInfo(target.parseErr)
			out[i] = entry
			continue
		}

		inputs, depDuration, missingMetric, missingErr := buildQueryInputs(target, source)
		entry.Duration = depDuration
		if missingMetric != "" {
			entry.Error = fmt.Sprintf("source metric %q failed: %s", missingMetric, missingErr)
			out[i] = entry
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
		entry.First, entry.Last = analyzeEndpoints(values)
		entry.Minimum = minimum
		entry.Maximum = maximum
		entry.Sum = sum
		entry.Count = count
		entry.Mean = safeMean(sum, count)
		out[i] = entry
	}

	return out
}

// populateAnalyzeEntryFromMetric fills an analysis entry from a single aggregate history request.
func (s *service) populateAnalyzeEntryFromMetric(
	ctx context.Context,
	entry *apiAnalyzeEntry,
	metric string,
	fromMS int64,
	toMS int64,
) {
	hr, duration, reqErr := s.history.Request(
		ctx,
		metric,
		time.UnixMilli(fromMS),
		time.UnixMilli(toMS),
		0,
		historyRequestTypeAggregate,
	)
	entry.Duration = duration.Seconds()
	if reqErr != nil {
		entry.Error = reqErr.Error()
		return
	}
	aggs := hr.GetAggregate()
	if len(aggs) != 1 {
		entry.Error = "unexpected response"
		return
	}

	agg := aggs[0]
	entry.Minimum = agg.Minimum
	entry.Maximum = agg.Maximum
	entry.Sum = agg.Sum
	entry.Count = agg.Count
	entry.Mean = aggregateMean(agg)

	// A zero interval requests raw samples, preserving exact endpoint values.
	timeline, err := s.history.RequestTimeline(ctx, metric, time.UnixMilli(fromMS), time.UnixMilli(toMS), 0)
	if err != nil {
		entry.Error = err.Error()
		return
	}
	if raw, ok := timeline.(*metricq.TimelineValues); ok {
		entry.Duration += raw.Duration.Seconds()
		values := make(map[int64]float64, len(raw.Values))
		for i, value := range raw.Values {
			if i < len(raw.Times) {
				values[raw.Times[i].UnixNano()] = value
			}
		}
		entry.First, entry.Last = analyzeEndpoints(values)
	}
}

// analyzeValueMap reduces a timestamped value map to summary statistics.
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

// computeGlobalYRange queries aggregate bounds for a metric set over a time range.
func (s *service) computeGlobalYRange(ctx context.Context, metrics []string, fromMS, toMS int64) (apiYRangeGlobalResponse, error) {
	minY := math.Inf(1)
	maxY := math.Inf(-1)
	used := make([]string, 0, len(metrics))
	var mu sync.Mutex

	waitGroupRun(metrics, func(_ int, metric string) {
		metric = strings.TrimSpace(metric)
		if metric == "" {
			return
		}
		hr, _, err := s.history.Request(
			ctx,
			metric,
			time.UnixMilli(fromMS),
			time.UnixMilli(toMS),
			0,
			historyRequestTypeAggregate,
		)
		if err != nil {
			return
		}
		aggs := hr.GetAggregate()
		if len(aggs) != 1 || aggs[0].Count == 0 {
			return
		}
		agg := aggs[0]

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
		return apiYRangeGlobalResponse{}, fmt.Errorf("no aggregate range available for requested metrics")
	}

	return apiYRangeGlobalResponse{
		Minimum: minY,
		Maximum: maxY,
		Metrics: used,
	}, nil
}

// analyzeEndpoints selects finite values by timestamp, independently of map order.
func analyzeEndpoints(values map[int64]float64) (first, last *float64) {
	var firstTime, lastTime int64
	for timestamp, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		if first == nil || timestamp < firstTime {
			v := value
			first, firstTime = &v, timestamp
		}
		if last == nil || timestamp > lastTime {
			v := value
			last, lastTime = &v, timestamp
		}
	}
	return
}
