package main

import (
	"fmt"
	"strings"
)

// resolveQueryTargets normalizes explicit targets, validating metric/expr exclusivity and name uniqueness.
func resolveQueryTargets(req apiQueryRequest) ([]apiQueryTarget, error) {
	targets := make([]apiQueryTarget, 0, len(req.Targets))
	seenNames := map[string]struct{}{}
	for _, raw := range req.Targets {
		name := strings.TrimSpace(raw.Name)
		metric := strings.TrimSpace(raw.Metric)
		expr := strings.TrimSpace(raw.Expr)
		render := strings.TrimSpace(raw.Render)
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
			Render: render,
		})
	}
	return targets, nil
}
