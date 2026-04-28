package main

import (
	"fmt"
	"strings"
)

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
