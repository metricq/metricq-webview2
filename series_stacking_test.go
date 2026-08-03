package main

import "testing"

// TestStackedValueAtLastSemanticsHoldsForward locks in the direction fix: a
// report at time T describes what's happening from T onward (forward),
// holding until superseded — not the interval before T. Regression coverage
// for a bug where the aggregate whose window contains a query time was
// picked backward, so a query landing inside a report's own forward window
// returned a completely unrelated (often much older) value instead.
func TestStackedValueAtLastSemanticsHoldsForward(t *testing.T) {
	points := []stackedValuePoint{
		{t: 1000, v: 10, validUntilMS: 2000},
		{t: 2000, v: 20, validUntilMS: 3000},
		{t: 3000, v: 30, validUntilMS: 4000},
	}

	cases := []struct {
		name      string
		query     int64
		wantValue float64
		wantOK    bool
	}{
		{"exactly at a report's own timestamp", 2000, 20, true},
		{"mid-way through a report's forward window", 2500, 20, true},
		{"just before the next report supersedes it", 2999, 20, true},
		{"before the first report", 500, 0, false},
		{"after the last report's window (gap)", 4500, 0, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value, ok := stackedValueAtLastSemantics(points, tc.query)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if ok && value != tc.wantValue {
				t.Fatalf("value = %v, want %v", value, tc.wantValue)
			}
		})
	}
}

// TestSeriesToStackedPointsAggregateValidUntil verifies the forward window is
// derived as [T, T+ActiveTimeMS], matching how HTA labels aggregate buckets
// by their start (confirmed against real query responses: a bucket's
// reported min/max exactly matches the raw samples in [T, T+ActiveTimeMS],
// not [T-ActiveTimeMS, T]).
func TestSeriesToStackedPointsAggregateValidUntil(t *testing.T) {
	series := apiQuerySeries{
		Mode: "aggregates",
		AggPoints: []apiAggPoint{
			{T: 1000, Avg: 5, Count: 1, ActiveTimeMS: 500},
		},
	}
	points := seriesToStackedPoints(series)
	if len(points) != 1 {
		t.Fatalf("unexpected point count: %d", len(points))
	}
	if points[0].t != 1000 || points[0].validUntilMS != 1500 {
		t.Fatalf("unexpected point: %+v", points[0])
	}
}

// TestSeriesToStackedPointsValuesHoldIndefinitely verifies raw "values"
// points (no ActiveTime) hold forward with no upper bound — classic
// last-observation-carried-forward — until superseded by the next report.
func TestSeriesToStackedPointsValuesHoldIndefinitely(t *testing.T) {
	series := apiQuerySeries{
		Mode:   "values",
		Points: []apiPoint{{T: 1000, V: 7}},
	}
	points := seriesToStackedPoints(series)
	if len(points) != 1 {
		t.Fatalf("unexpected point count: %d", len(points))
	}
	if points[0].validUntilMS != stackedNoUpperBound {
		t.Fatalf("expected unbounded forward validity, got %v", points[0].validUntilMS)
	}
}
