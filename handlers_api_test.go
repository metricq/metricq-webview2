package main

import "testing"

func TestResolveQueryTargetsFallbackMetrics(t *testing.T) {
	targets, err := resolveQueryTargets(apiQueryRequest{Metrics: []string{"a", " b "}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("unexpected len: %d", len(targets))
	}
	if targets[1].Name != "b" || targets[1].Metric != "b" {
		t.Fatalf("unexpected target mapping: %#v", targets[1])
	}
}

func TestResolveQueryTargetsExpressionAndMetricValidation(t *testing.T) {
	_, err := resolveQueryTargets(apiQueryRequest{Targets: []apiQueryTarget{{Name: "x", Metric: "a", Expr: "a+b"}}})
	if err == nil {
		t.Fatalf("expected validation error when metric and expr are both set")
	}

	_, err = resolveQueryTargets(apiQueryRequest{Targets: []apiQueryTarget{{Name: "x"}}})
	if err == nil {
		t.Fatalf("expected validation error for empty target")
	}
}

func TestResolveQueryTargetsDuplicateNames(t *testing.T) {
	_, err := resolveQueryTargets(apiQueryRequest{Targets: []apiQueryTarget{
		{Name: "dup", Metric: "a"},
		{Name: "dup", Expr: "b+c"},
	}})
	if err == nil {
		t.Fatalf("expected duplicate name error")
	}
}
