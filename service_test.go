package main

import (
	"testing"
	"time"

	metricq "github.com/metricq/metricq-go"
)

func TestScaleValueByFunction(t *testing.T) {
	agg := metricq.HistoryResponse_Aggregate{
		Minimum:    1.5,
		Maximum:    9.5,
		Sum:        30,
		Count:      10,
		Integral:   30,
		ActiveTime: 10,
	}
	scale := 2.0

	if got := scaleValueByFunction(&agg, "min", scale); got != 3.0 {
		t.Fatalf("min scale mismatch: got %v", got)
	}
	if got := scaleValueByFunction(&agg, "max", scale); got != 19.0 {
		t.Fatalf("max scale mismatch: got %v", got)
	}
	if got := scaleValueByFunction(&agg, "count", scale); got != 10.0 {
		t.Fatalf("count mismatch: got %v", got)
	}
	if got := scaleValueByFunction(&agg, "avg", scale); got != 6.0 {
		t.Fatalf("avg scale mismatch: got %v", got)
	}
}

func TestHistoryToSeriesValues(t *testing.T) {
	hr := &metricq.TimelineValues{
		Times: []time.Time{
			time.UnixMilli(1),
			time.UnixMilli(3),
		},
		Values:   []float64{1.25, 2.5},
		Duration: 500 * time.Millisecond,
	}
	got := historyToSeries("metric.a", hr)

	if got.Mode != "values" {
		t.Fatalf("unexpected mode: %s", got.Mode)
	}
	if got.Points[0].T != 1 || got.Points[1].T != 3 {
		t.Fatalf("unexpected timestamps: %+v", got.Points)
	}
}

func TestHistoryToSeriesAggregates(t *testing.T) {
	hr := &metricq.TimelineAggregates{
		Times: []time.Time{
			time.UnixMilli(1),
			time.UnixMilli(2),
		},
		Agg: []*metricq.HistoryResponse_Aggregate{
			{Minimum: 1, Maximum: 3, Sum: 4, Count: 2, Integral: 2, ActiveTime: 1},
			{Minimum: 2, Maximum: 6, Sum: 12, Count: 3, Integral: 4, ActiveTime: 1},
		},
		Duration: 200 * time.Millisecond,
	}
	got := historyToSeries("metric.b", hr)

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
