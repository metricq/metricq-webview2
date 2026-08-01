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

func TestBucketCandlesticks(t *testing.T) {
	// Two buckets of width 1000ms across [0,2000): [0,1000) and [1000,2000).
	raw := &metricq.TimelineValues{
		Times: []time.Time{
			time.UnixMilli(0),
			time.UnixMilli(400),
			time.UnixMilli(900),
			time.UnixMilli(1100),
			time.UnixMilli(1900),
		},
		Values: []float64{10, 5, 8, 20, 15},
	}
	series := bucketCandlesticksFromRaw("metric.c", raw, 0, 1000)

	if series.Mode != "candlestick" {
		t.Fatalf("unexpected mode: %s", series.Mode)
	}
	if len(series.AggPoints) != 2 {
		t.Fatalf("expected 2 candles, got %d", len(series.AggPoints))
	}
	if series.CandleWidthMS != 1000 {
		t.Fatalf("unexpected candle width: %d", series.CandleWidthMS)
	}

	first := series.AggPoints[0]
	if first.Open == nil || *first.Open != 10 {
		t.Fatalf("unexpected open for first bucket: %+v", first)
	}
	if first.Close == nil || *first.Close != 8 {
		t.Fatalf("unexpected close for first bucket: %+v", first)
	}
	if first.Min != 5 || first.Max != 10 {
		t.Fatalf("unexpected min/max for first bucket: %+v", first)
	}
	if first.Count != 3 {
		t.Fatalf("unexpected count for first bucket: %+v", first)
	}
	// Centered on the actual first/last sample times (0, 400, 900), not an
	// arbitrary fromMS-anchored grid position.
	if first.T != 450 {
		t.Fatalf("unexpected bucket center for first bucket: %+v", first)
	}

	second := series.AggPoints[1]
	// Open carries forward from the previous candle's close, so candles form
	// a continuous line instead of jumping at the boundary.
	if second.Open == nil || *second.Open != *first.Close {
		t.Fatalf("expected second open to equal first close: %+v vs %+v", second, first)
	}
	if second.Close == nil || *second.Close != 15 {
		t.Fatalf("unexpected close for second bucket: %+v", second)
	}
	if second.Min != 8 || second.Max != 20 {
		t.Fatalf("unexpected min/max for second bucket: %+v", second)
	}

	if series.SampleCount != 5 {
		t.Fatalf("unexpected total sample count: %v", series.SampleCount)
	}
}

func TestBucketCandlesticksFromAggregates(t *testing.T) {
	// Four sub-buckets of width 250ms resampled into two candles of width 500ms.
	subBucket := func(startMS int64, mean, min, max float64) (time.Time, *metricq.HistoryResponse_Aggregate) {
		activeTime := int64(250 * time.Millisecond)
		return time.UnixMilli(startMS), &metricq.HistoryResponse_Aggregate{
			Minimum:    min,
			Maximum:    max,
			Count:      5,
			Integral:   mean * float64(activeTime),
			ActiveTime: activeTime,
		}
	}

	t1, a1 := subBucket(0, 10, 8, 12)
	t2, a2 := subBucket(250, 14, 12, 16)
	t3, a3 := subBucket(500, 20, 18, 22)
	t4, a4 := subBucket(750, 16, 14, 18)

	data := &metricq.TimelineAggregates{
		Times: []time.Time{t1, t2, t3, t4},
		Agg:   []*metricq.HistoryResponse_Aggregate{a1, a2, a3, a4},
	}

	series := bucketCandlesticksFromAggregates("metric.d", data, 0, 500)

	if series.Mode != "candlestick" {
		t.Fatalf("unexpected mode: %s", series.Mode)
	}
	if len(series.AggPoints) != 2 {
		t.Fatalf("expected 2 candles, got %d", len(series.AggPoints))
	}

	first := series.AggPoints[0]
	if first.Open == nil || *first.Open != 10 {
		t.Fatalf("unexpected open for first candle: %+v", first)
	}
	if first.Close == nil || *first.Close != 14 {
		t.Fatalf("unexpected close for first candle: %+v", first)
	}
	if first.Min != 8 || first.Max != 16 {
		t.Fatalf("unexpected min/max for first candle: %+v", first)
	}
	if first.Avg != 12 {
		t.Fatalf("unexpected avg for first candle: %+v", first)
	}
	if first.Count != 10 {
		t.Fatalf("unexpected count for first candle: %+v", first)
	}

	second := series.AggPoints[1]
	// Open carries forward from the previous candle's close, so candles form
	// a continuous line instead of jumping at the boundary.
	if second.Open == nil || *second.Open != *first.Close {
		t.Fatalf("expected second open to equal first close: %+v vs %+v", second, first)
	}
	if second.Close == nil || *second.Close != 16 {
		t.Fatalf("unexpected close for second candle: %+v", second)
	}
	if second.Min != 14 || second.Max != 22 {
		t.Fatalf("unexpected min/max for second candle: %+v", second)
	}
	if second.Avg != 18 {
		t.Fatalf("unexpected avg for second candle: %+v", second)
	}

	if series.SampleCount != 20 {
		t.Fatalf("unexpected total sample count: %v", series.SampleCount)
	}
}
