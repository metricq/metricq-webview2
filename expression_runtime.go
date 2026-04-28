package main

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
)

type plannedQueryTarget struct {
	name         string
	sourceMetric string
	expr         string
	root         exprNode
	parseErr     error
	dependencies []string
}

type metricSourceData struct {
	series map[string]apiQuerySeries
	values map[string]map[int64]evalSample
	errs   map[string]string
}

// expressionErrorInfo converts parser and evaluation errors into the API error payload shape.
func expressionErrorInfo(err error) *apiExprError {
	if err == nil {
		return nil
	}
	info := &apiExprError{
		Type:    "expression_error",
		Message: strings.TrimSpace(err.Error()),
	}
	var parseErr *exprParseError
	if errors.As(err, &parseErr) {
		info.Type = strings.TrimSpace(parseErr.Code)
		if info.Type == "" {
			info.Type = "expression_parse_error"
		}
		if msg := strings.TrimSpace(parseErr.Message); msg != "" {
			info.Message = msg
		}
		if tok := strings.TrimSpace(parseErr.Token); tok != "" {
			info.Token = tok
		}
		pos := parseErr.Pos
		end := parseErr.End
		info.Position = &pos
		info.End = &end
	}
	return info
}

// planQueryTargets parses expression targets and collects the source metrics they need.
func planQueryTargets(targets []apiQueryTarget, includeDirectMetrics bool) ([]plannedQueryTarget, []string) {
	planned := make([]plannedQueryTarget, len(targets))
	sourceMetricSet := map[string]struct{}{}

	for i, target := range targets {
		planned[i] = plannedQueryTarget{
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

// loadMetricSourceData fetches source series and expression inputs for a metric set.
func (s *service) loadMetricSourceData(
	ctx context.Context,
	metrics []string,
	fromMS int64,
	toMS int64,
	maxDataPoints int,
) metricSourceData {
	data := metricSourceData{
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

// buildQueryInputs assembles the evaluated dependency inputs for one computed target.
func buildQueryInputs(
	target plannedQueryTarget,
	source metricSourceData,
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
