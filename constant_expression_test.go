package main

import (
	"context"
	"testing"
)

func TestConstantExpressionQueryAndAnalyze(t *testing.T) {
	// No history client: a constant must work without any database requests.
	s := &service{}
	targets := []apiQueryTarget{{Name: "constant", Expr: "5+7"}, {Name: "zero", Expr: "0"}}
	req := apiQueryRequest{FromUnixMS: 1000, ToUnixMS: 9000, MaxDataPoints: 9}
	series, err := s.resolveQuerySeries(context.Background(), req, targets)
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 2 {
		t.Fatalf("unexpected series: %+v", series)
	}
	for i, expected := range []float64{12, 0} {
		item := series[i]
		if item.Error != "" || len(item.AggPoints) != 9 {
			t.Fatalf("unexpected constant series: %+v", item)
		}
		if item.AggPoints[0].T != 1000 || item.AggPoints[8].T != 9000 {
			t.Fatal("constant must cover the requested range")
		}
		for _, point := range item.AggPoints {
			if point.Min != expected || point.Max != expected || point.Avg != expected {
				t.Fatalf("unexpected constant point: %+v", point)
			}
		}
	}
	stacked, err := alignStackedSeries(series, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)
	if err != nil {
		t.Fatal(err)
	}
	if len(stacked.Times) == 0 || len(stacked.Values) != 2 {
		t.Fatalf("missing stacked constants: %+v", stacked)
	}
	for i, row := range stacked.Values {
		for _, value := range row {
			if value == nil || *value != []float64{12, 0}[i] {
				t.Fatalf("unexpected stacked value: %v", value)
			}
		}
	}
	entries := s.analyzeQueryTargets(context.Background(), apiAnalyzeRequest{FromUnixMS: 1000, ToUnixMS: 9000}, targets)
	for i, entry := range entries {
		expected := []float64{12, 0}[i]
		if entry.Error != "" || entry.Mean != expected || entry.Minimum != expected || entry.Maximum != expected || entry.First == nil || entry.Last == nil || *entry.First != expected || *entry.Last != expected {
			t.Fatalf("unexpected constant analysis: %+v", entry)
		}
	}
}

func TestConstantExpressionArithmetic(t *testing.T) {
	for expression, expected := range map[string]float64{"5+7": 12, "(5+7)*2": 24, "-3": -3, "log(100)": 2, "min(3,7)": 3} {
		node, err := parseExpression(expression)
		if err != nil {
			t.Fatal(err)
		}
		values, err := evalExpression(node, nil)
		if err != nil || len(values) != 1 || values[0] != expected {
			t.Fatalf("%s: got %v, %v", expression, values, err)
		}
	}
	for _, expression := range []string{"1/0", "log(-1)", "1e308*1e308"} {
		node, err := parseExpression(expression)
		if err != nil {
			t.Fatal(err)
		}
		values, err := evalExpression(node, nil)
		if err != nil || len(values) != 0 {
			t.Fatalf("undefined constant %s must have no finite data: %v, %v", expression, values, err)
		}
	}
}
