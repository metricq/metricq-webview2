package main

import (
	"context"
	"fmt"
	"strings"
)

// resolveQuerySeries resolves request targets into API series, including expression targets.
func (s *service) resolveQuerySeries(ctx context.Context, req apiQueryRequest, targets []apiQueryTarget) ([]apiQuerySeries, error) {
	planned, sourceMetrics := planQueryTargets(targets, true)
	source := s.loadMetricSourceData(ctx, sourceMetrics, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)

	results := make([]apiQuerySeries, len(planned))
	s.fillCandlestickResults(ctx, req, targets, planned, results)

	for i, target := range planned {
		if strings.TrimSpace(targets[i].Render) == "candlestick" && target.expr == "" {
			continue
		}
		if target.expr == "" {
			base, ok := source.series[target.sourceMetric]
			if !ok {
				results[i] = apiQuerySeries{Metric: target.name, Error: source.errs[target.sourceMetric]}
				continue
			}
			base.Metric = target.name
			results[i] = base
			continue
		}
		if target.parseErr != nil {
			results[i] = apiQuerySeries{
				Metric:    target.name,
				Error:     fmt.Sprintf("invalid expression: %v", target.parseErr),
				ErrorInfo: expressionErrorInfo(target.parseErr),
			}
			continue
		}

		inputs, depDuration, missingMetric, missingErr := buildQueryInputs(target, source)
		if missingMetric != "" {
			results[i] = apiQuerySeries{
				Metric: target.name,
				Error:  fmt.Sprintf("source metric %q failed: %s", missingMetric, missingErr),
			}
			continue
		}

		values, evalErr := evalExpressionSamples(target.root, inputs)
		if evalErr != nil {
			results[i] = apiQuerySeries{
				Metric: target.name,
				Error:  fmt.Sprintf("failed to evaluate expression: %v", evalErr),
			}
			continue
		}
		results[i] = samplesToAggregateSeries(target.name, values, depDuration)
	}

	return results, nil
}

// fillCandlestickResults resolves candlestick-rendered metric targets via raw OHLC
// resampling (queryMetricCandles) in parallel, writing directly into results by index.
// Candlestick targets are excluded from the shared fetch in planQueryTargets, so the
// caller's main assembly loop must skip the indices this fills.
func (s *service) fillCandlestickResults(ctx context.Context, req apiQueryRequest, targets []apiQueryTarget, planned []plannedQueryTarget, results []apiQuerySeries) {
	var idx []int
	var metrics []string
	for i, target := range targets {
		if target.Expr == "" && strings.TrimSpace(target.Render) == "candlestick" {
			idx = append(idx, i)
			metrics = append(metrics, target.Metric)
		}
	}
	if len(idx) == 0 {
		return
	}
	waitGroupRun(metrics, func(j int, metric string) {
		series, _ := s.queryMetricCandles(ctx, metric, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)
		series.Metric = planned[idx[j]].name
		results[idx[j]] = series
	})
}
