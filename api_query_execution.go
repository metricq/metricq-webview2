package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
)

type plannedEvalTarget struct {
	name         string
	sourceMetric string
	expr         string
	root         exprNode
	parseErr     error
	dependencies []string
}

type expressionSourceData struct {
	series map[string]apiQuerySeries
	values map[string]map[int64]evalSample
	errs   map[string]string
}

func planEvalTargets(targets []apiQueryTarget, includeDirectMetrics bool) ([]plannedEvalTarget, []string) {
	planned := make([]plannedEvalTarget, len(targets))
	sourceMetricSet := map[string]struct{}{}

	for i, target := range targets {
		planned[i] = plannedEvalTarget{
			name:         target.Name,
			sourceMetric: target.Metric,
			expr:         target.Expr,
		}
		if target.Expr == "" {
			if includeDirectMetrics && target.Metric != "" {
				sourceMetricSet[target.Metric] = struct{}{}
			}
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
	return planned, sourceMetrics
}

func (s *service) loadExpressionSourceData(
	ctx context.Context,
	metrics []string,
	fromMS int64,
	toMS int64,
	maxDataPoints int,
) expressionSourceData {
	data := expressionSourceData{
		series: map[string]apiQuerySeries{},
		values: map[string]map[int64]evalSample{},
		errs:   map[string]string{},
	}
	var mu sync.Mutex

	waitGroupRun(metrics, func(_ int, metric string) {
		timeline, qErr := s.queryMetric(ctx, metric, fromMS, toMS, maxDataPoints)
		if qErr != nil {
			mu.Lock()
			data.errs[metric] = qErr.Error()
			mu.Unlock()
			return
		}
		series := historyToSeries(metric, timeline)
		mu.Lock()
		data.series[metric] = series
		if series.Error != "" {
			data.errs[metric] = series.Error
		} else {
			data.values[metric] = seriesToEvalInputMap(series)
		}
		mu.Unlock()
	})

	return data
}

func buildEvalInputs(
	target plannedEvalTarget,
	source expressionSourceData,
) (map[string]map[int64]evalSample, float64, string, string) {
	inputs := make(map[string]map[int64]evalSample, len(target.dependencies))
	depDuration := 0.0

	for _, metric := range target.dependencies {
		if errText := strings.TrimSpace(source.errs[metric]); errText != "" {
			return nil, 0, metric, errText
		}
		values, ok := source.values[metric]
		if !ok {
			return nil, 0, metric, "missing source series"
		}
		inputs[metric] = values
		if src, ok := source.series[metric]; ok && src.Duration > depDuration {
			depDuration = src.Duration
		}
	}

	return inputs, depDuration, "", ""
}

func (s *service) executeAPIQuery(ctx context.Context, req apiQueryRequest, targets []apiQueryTarget) ([]apiQuerySeries, error) {
	planned, sourceMetrics := planEvalTargets(targets, true)
	source := s.loadExpressionSourceData(ctx, sourceMetrics, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)

	results := make([]apiQuerySeries, len(planned))
	for i, target := range planned {
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
				ErrorInfo: buildExprErrorInfo(target.parseErr),
			}
			continue
		}

		inputs, depDuration, missingMetric, missingErr := buildEvalInputs(target, source)
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
