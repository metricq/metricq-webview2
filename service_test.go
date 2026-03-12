package main

import "testing"

func TestScaleValueByFunction(t *testing.T) {
	agg := historyAggregate{Minimum: 1.5, Maximum: 9.5, Sum: 30, Count: 10}
	scale := 2.0

	if got := scaleValueByFunction(agg, "min", scale); got != 3.0 {
		t.Fatalf("min scale mismatch: got %v", got)
	}
	if got := scaleValueByFunction(agg, "max", scale); got != 19.0 {
		t.Fatalf("max scale mismatch: got %v", got)
	}
	if got := scaleValueByFunction(agg, "count", scale); got != 10.0 {
		t.Fatalf("count mismatch: got %v", got)
	}
	if got := scaleValueByFunction(agg, "avg", scale); got != 6.0 {
		t.Fatalf("avg scale mismatch: got %v", got)
	}
}

func TestHistoryToSeriesValues(t *testing.T) {
	hr := historyResponse{
		TimeDelta: []int64{1_000_000, 2_000_000},
		Values:    []float64{1.25, 2.5},
	}
	got := historyToSeries("metric.a", hr, 0.5)

	if got.Mode != "values" {
		t.Fatalf("unexpected mode: %s", got.Mode)
	}
	if got.Points[0].T != 1 || got.Points[1].T != 3 {
		t.Fatalf("unexpected timestamps: %+v", got.Points)
	}
}

func TestHistoryToSeriesAggregates(t *testing.T) {
	hr := historyResponse{
		TimeDelta: []int64{1_000_000, 1_000_000},
		Agg: []historyAggregate{
			{Minimum: 1, Maximum: 3, Sum: 4, Count: 2},
			{Minimum: 2, Maximum: 6, Sum: 12, Count: 3},
		},
	}
	got := historyToSeries("metric.b", hr, 0.2)

	if got.Mode != "aggregates" {
		t.Fatalf("unexpected mode: %s", got.Mode)
	}
	if got.SampleCount != 5 {
		t.Fatalf("unexpected sample count: %v", got.SampleCount)
	}
	if got.AggPoints[0].Avg != 2 || got.AggPoints[1].Avg != 4 {
		t.Fatalf("unexpected averages: %+v", got.AggPoints)
	}
}
