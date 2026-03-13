package main

import (
	"math"
	"testing"
)

func TestParseExpressionSupportedForms(t *testing.T) {
	cases := []string{
		"[a]+[b]",
		"[a]-[b]",
		"[a]*[b]",
		"[a]/[b]",
		"([a]+[b])/2",
		"sum([a],[b],3.5)",
		"-[a]",
		"log [a]",
		"sum([a],[b],[c])",
		"min([a],[b],[c])",
		"max([a],[b],[c])",
		"([rack-a.power] + [b]) / [c]",
	}
	for _, expr := range cases {
		node, err := parseExpression(expr)
		if err != nil {
			t.Fatalf("parse failed for %q: %v", expr, err)
		}
		if node == nil {
			t.Fatalf("parse returned nil node for %q", expr)
		}
	}
}

func TestEvalExpressionWithScalarLiteral(t *testing.T) {
	inputs := map[string]map[int64]float64{
		"a": {1000: 10, 2000: 20},
	}
	node, err := parseExpression("[a]/2")
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	got, err := evalExpression(node, inputs)
	if err != nil {
		t.Fatalf("eval failed: %v", err)
	}
	if got[1000] != 5 || got[2000] != 10 {
		t.Fatalf("unexpected scalar division result: %#v", got)
	}
}

func TestParseExpressionRejectsInvalidForms(t *testing.T) {
	cases := []string{
		"",
		"[a]+",
		"sin(a)",
		"min()",
		"[metric.a",
		"()",
		"a",
	}
	for _, expr := range cases {
		if _, err := parseExpression(expr); err == nil {
			t.Fatalf("expected parse error for %q", expr)
		}
	}
}

func TestEvalExpressionMathOps(t *testing.T) {
	sameTs := map[int64]float64{1000: 10, 2000: 12}
	inputs := map[string]map[int64]float64{
		"a": sameTs,
		"b": {1000: 2, 2000: 3},
	}

	node, err := parseExpression("[a]+[b]")
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	got, err := evalExpression(node, inputs)
	if err != nil {
		t.Fatalf("eval failed: %v", err)
	}
	if got[1000] != 12 || got[2000] != 15 {
		t.Fatalf("unexpected add values: %#v", got)
	}

	node, _ = parseExpression("[a]-[b]")
	got, _ = evalExpression(node, inputs)
	if got[1000] != 8 || got[2000] != 9 {
		t.Fatalf("unexpected sub values: %#v", got)
	}

	node, _ = parseExpression("[a]*[b]")
	got, _ = evalExpression(node, inputs)
	if got[1000] != 20 || got[2000] != 36 {
		t.Fatalf("unexpected mul values: %#v", got)
	}

	node, _ = parseExpression("[a]/[b]")
	got, _ = evalExpression(node, inputs)
	if got[1000] != 5 || got[2000] != 4 {
		t.Fatalf("unexpected div values: %#v", got)
	}
}

func TestEvalExpressionFunctionsAndUnary(t *testing.T) {
	inputs := map[string]map[int64]float64{
		"a": {10: 10},
		"b": {10: 2},
		"c": {10: 4},
	}

	node, _ := parseExpression("sum([a],[b],[c])")
	got, _ := evalExpression(node, inputs)
	if got[10] != 16 {
		t.Fatalf("sum mismatch: %#v", got)
	}

	node, _ = parseExpression("min([a],[b],[c])")
	got, _ = evalExpression(node, inputs)
	if got[10] != 2 {
		t.Fatalf("min mismatch: %#v", got)
	}

	node, _ = parseExpression("max([a],[b],[c])")
	got, _ = evalExpression(node, inputs)
	if got[10] != 10 {
		t.Fatalf("max mismatch: %#v", got)
	}

	node, _ = parseExpression("-[a]")
	got, _ = evalExpression(node, inputs)
	if got[10] != -10 {
		t.Fatalf("neg mismatch: %#v", got)
	}

	node, _ = parseExpression("log [a]")
	got, _ = evalExpression(node, inputs)
	if math.Abs(got[10]-1.0) > 1e-12 {
		t.Fatalf("log mismatch: %#v", got)
	}
}

func TestEvalExpressionUsesIntervalValueSincePreviousPoint(t *testing.T) {
	inputs := map[string]map[int64]float64{
		"a": {1000: 1, 2000: 2, 3000: 3},
		"b": {2000: 20, 3000: 30, 4000: 40},
	}
	node, _ := parseExpression("[a]+[b]")
	got, err := evalExpression(node, inputs)
	if err != nil {
		t.Fatalf("eval failed: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("result size mismatch: %#v", got)
	}
	if got[2000] != 22 || got[3000] != 33 {
		t.Fatalf("interval-semantics merged values mismatch: %#v", got)
	}
	if _, exists := got[4000]; exists {
		t.Fatalf("did not expect extrapolation beyond last point: %#v", got)
	}
}

func TestEvalExpressionDoesNotBackfillBeforeFirstPoint(t *testing.T) {
	inputs := map[string]map[int64]float64{
		"a": {1000: 1, 2000: 2},
		"b": {2000: 20},
	}
	node, _ := parseExpression("[a]+[b]")
	got, err := evalExpression(node, inputs)
	if err != nil {
		t.Fatalf("eval failed: %v", err)
	}
	if _, exists := got[1000]; exists {
		t.Fatalf("did not expect value before first point of all dependencies: %#v", got)
	}
	if got[2000] != 22 {
		t.Fatalf("expected merged value at 2000, got: %#v", got)
	}
}

func TestParseExpressionBracketMetricName(t *testing.T) {
	node, err := parseExpression("[hpc-rack.power] + [LZR.K21.metric]")
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	metrics := metricsInExpression(node)
	if len(metrics) != 2 {
		t.Fatalf("expected 2 metrics, got %d: %#v", len(metrics), metrics)
	}
}

func TestSeriesToEvalInputMapAndAggregateConversion(t *testing.T) {
	series := apiQuerySeries{
		Mode: "aggregates",
		AggPoints: []apiAggPoint{
			{T: 2, Min: 19, Max: 22, Avg: 20, Count: 3},
			{T: 1, Min: 9, Max: 11, Avg: 10, Count: 2},
			{T: 3, Min: 0, Max: 0, Avg: 0, Count: 0},
		},
	}
	mapped := seriesToEvalInputMap(series)
	if mapped[1].avg != 10 || mapped[2].avg != 20 {
		t.Fatalf("unexpected mapped values: %#v", mapped)
	}
	if mapped[1].min != 9 || mapped[2].max != 22 {
		t.Fatalf("unexpected mapped min/max values: %#v", mapped)
	}
	if _, exists := mapped[3]; exists {
		t.Fatalf("count==0 aggregate point must be skipped: %#v", mapped)
	}

	converted := valuesToPointSeries("expr.total", map[int64]float64{2000: 2, 1000: 1}, 0.42)
	if converted.Mode != "values" || len(converted.Points) != 2 {
		t.Fatalf("unexpected converted metadata: %#v", converted)
	}
	if converted.Points[0].T != 1000 || converted.Points[1].T != 2000 {
		t.Fatalf("expected sorted timestamps, got: %#v", converted.Points)
	}
}

func TestEvalExpressionWithSamplesMinMaxUsesAggregateBounds(t *testing.T) {
	node, err := parseExpression("max([a],[b])-min([a],[b])")
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	inputs := map[string]map[int64]evalSample{
		"a": {
			1000: {avg: 10, min: 8, max: 12},
		},
		"b": {
			1000: {avg: 9, min: 5, max: 11},
		},
	}
	got, err := evalExpressionWithSamples(node, inputs)
	if err != nil {
		t.Fatalf("eval failed: %v", err)
	}
	// max() should use aggregate.max and min() aggregate.min => 12 - 5 = 7
	if got[1000] != 7 {
		t.Fatalf("expected 7, got %#v", got)
	}
}
