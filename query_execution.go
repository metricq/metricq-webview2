package main

import (
	"context"
	"fmt"
)

func (s *service) resolveQuerySeries(ctx context.Context, req apiQueryRequest, targets []apiQueryTarget) ([]apiQuerySeries, error) {
	planned, sourceMetrics := planQueryTargets(targets, true)
	source := s.loadMetricSourceData(ctx, sourceMetrics, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)

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
