package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// stackedValuePoint is a report under last-value semantics: the value at t
// was measured starting at t and holds forward until validUntilMS (a fresh
// report at t describes what's happening from t onward, until superseded —
// not what happened before t; see stackedValueAtLastSemantics).
type stackedValuePoint struct {
	t            int64
	v            float64
	validUntilMS int64
}

const stackedNoUpperBound int64 = 1<<63 - 1

// seriesToStackedPoints converts a query series into points that can be aligned under last semantics.
func seriesToStackedPoints(series apiQuerySeries) []stackedValuePoint {
	switch series.Mode {
	case "values":
		out := make([]stackedValuePoint, 0, len(series.Points))
		for _, point := range series.Points {
			if math.IsNaN(point.V) || math.IsInf(point.V, 0) {
				continue
			}
			// A raw sample has no known duration; it holds forward
			// (classic last-observation-carried-forward) until whatever
			// comes next, so there's no upper bound to apply here.
			out = append(out, stackedValuePoint{t: point.T, v: point.V, validUntilMS: stackedNoUpperBound})
		}
		return out
	case "aggregates":
		out := make([]stackedValuePoint, 0, len(series.AggPoints))
		for _, point := range series.AggPoints {
			if point.Count == 0 || math.IsNaN(point.Avg) || math.IsInf(point.Avg, 0) {
				continue
			}
			validUntil := stackedNoUpperBound
			if point.ActiveTimeMS > 0 {
				validUntil = point.T + point.ActiveTimeMS
			}
			out = append(out, stackedValuePoint{t: point.T, v: point.Avg, validUntilMS: validUntil})
		}
		return out
	default:
		return nil
	}
}

// stackedValueAtLastSemantics returns the value of the most recent report at
// or before t, provided t still falls within that report's forward validity
// window (no gap since).
func stackedValueAtLastSemantics(points []stackedValuePoint, t int64) (float64, bool) {
	if len(points) == 0 {
		return 0, false
	}
	idx := sort.Search(len(points), func(i int) bool { return points[i].t > t }) - 1
	if idx < 0 {
		return 0, false
	}
	point := points[idx]
	if t > point.validUntilMS {
		return 0, false
	}
	return point.v, true
}

// buildStackedTimeline creates the shared output timeline for stacked rendering.
func buildStackedTimeline(fromMS, toMS int64, maxDataPoints int) []int64 {
	if toMS <= fromMS {
		return []int64{}
	}
	if maxDataPoints <= 0 {
		maxDataPoints = 1000
	}
	span := toMS - fromMS
	step := (span + int64(maxDataPoints) - 1) / int64(maxDataPoints)
	if step < 1 {
		step = 1
	}

	timeline := make([]int64, 0, maxDataPoints+1)
	for t := fromMS; t <= toMS; t += step {
		timeline = append(timeline, t)
	}
	if len(timeline) == 0 || timeline[len(timeline)-1] != toMS {
		timeline = append(timeline, toMS)
	}
	return timeline
}

// alignStackedSeries aligns multiple series onto one timeline for stacked rendering.
func alignStackedSeries(series []apiQuerySeries, fromMS, toMS int64, maxDataPoints int) (apiStackedSeriesResponse, error) {
	pointsByMetric := make([][]stackedValuePoint, 0, len(series))
	metricHasData := make([]bool, 0, len(series))
	metricNames := make([]string, 0, len(series))
	totalDuration := 0.0

	for _, item := range series {
		if errText := strings.TrimSpace(item.Error); errText != "" {
			return apiStackedSeriesResponse{}, fmt.Errorf("metric %q failed: %s", item.Metric, errText)
		}
		if item.Duration > 0 && !math.IsNaN(item.Duration) && !math.IsInf(item.Duration, 0) {
			totalDuration += item.Duration
		}
		points := seriesToStackedPoints(item)
		metricNames = append(metricNames, item.Metric)
		if len(points) == 0 {
			pointsByMetric = append(pointsByMetric, nil)
			metricHasData = append(metricHasData, false)
			continue
		}
		pointsByMetric = append(pointsByMetric, points)
		metricHasData = append(metricHasData, true)
	}

	if len(metricNames) == 0 {
		return apiStackedSeriesResponse{
			Duration: totalDuration,
			Times:    []int64{},
			Metrics:  []string{},
			Values:   [][]*float64{},
		}, nil
	}

	timeline := buildStackedTimeline(fromMS, toMS, maxDataPoints)
	if len(timeline) == 0 {
		return apiStackedSeriesResponse{
			Duration: totalDuration,
			Times:    []int64{},
			Metrics:  metricNames,
			Values:   make([][]*float64, len(metricNames)),
		}, nil
	}

	values := make([][]*float64, len(metricNames))
	for i, points := range pointsByMetric {
		row := make([]*float64, len(timeline))
		if metricHasData[i] {
			for idx, t := range timeline {
				value, ok := stackedValueAtLastSemantics(points, t)
				if !ok {
					row[idx] = nil
					continue
				}
				val := value
				row[idx] = &val
			}
		}
		values[i] = row
	}

	return apiStackedSeriesResponse{
		Duration: totalDuration,
		Times:    timeline,
		Metrics:  metricNames,
		Values:   values,
	}, nil
}
