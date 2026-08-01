package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	metricq "github.com/metricq/metricq-go"
)

// newService constructs the MetricQ-backed application service.
func newService(ctx context.Context, cfg config) (*service, error) {
	agent, err := metricq.NewAgent(cfg.MetricQToken, cfg.MetricQServer)
	if err != nil {
		return nil, fmt.Errorf("new metricq agent: %w", err)
	}
	if err := agent.Connect(ctx); err != nil {
		return nil, fmt.Errorf("connect metricq management: %w", err)
	}

	history, err := metricq.NewHistoryClient(ctx, agent)
	if err != nil {
		agent.Close()
		return nil, fmt.Errorf("init history client: %w", err)
	}

	return &service{
		agent:   agent,
		history: history,
		cfg:     cfg,
	}, nil
}

// Close releases service-owned resources.
func (s *service) Close() {
	s.closeOnce.Do(func() {
		if s.history != nil {
			_ = s.history.Close()
		}
		if s.agent != nil {
			s.agent.Close()
		}
	})
}

// lookupMetrics resolves metrics by infix query through the history service.
func (s *service) lookupMetrics(ctx context.Context, query string, metadata bool, limit int) (map[string]map[string]any, []string, error) {
	payload := metricLookupRequest{
		Function: "get_metrics",
		Historic: true,
		Hidden:   false,
		Limit:    limit,
	}
	if metadata {
		payload.Format = "object"
	} else {
		payload.Format = "array"
	}
	if query != "" {
		payload.Infix = query
	}
	return s.lookupMetricsByPayload(ctx, payload, metadata)
}

// lookupMetricsSelector resolves metrics for one selector expression.
func (s *service) lookupMetricsSelector(ctx context.Context, selector string, metadata bool, limit int) (map[string]map[string]any, []string, error) {
	return s.lookupMetricsSelectors(ctx, selector, metadata, limit)
}

// lookupMetricsSelectors resolves metrics for one or more selector payloads.
func (s *service) lookupMetricsSelectors(ctx context.Context, selector any, metadata bool, limit int) (map[string]map[string]any, []string, error) {
	payload := metricLookupRequest{
		Function: "get_metrics",
		Historic: true,
		Hidden:   false,
		Limit:    limit,
	}
	if metadata {
		payload.Format = "object"
	} else {
		payload.Format = "array"
	}
	if selector != nil && selector != "" {
		payload.Selector = selector
	}
	return s.lookupMetricsByPayload(ctx, payload, metadata)
}

// lookupMetricsByPayload performs the shared metadata query call used by metric lookup helpers.
func (s *service) lookupMetricsByPayload(ctx context.Context, payload any, metadata bool) (map[string]map[string]any, []string, error) {
	resp, err := s.agent.Rpc(ctx, "metricq.management", "get_metrics", payload)
	if err != nil {
		return nil, nil, err
	}
	return decodeMetricLookupResponse(resp, metadata)
}

// decodeMetricLookupResponse parses metric lookup responses with optional metadata.
func decodeMetricLookupResponse(resp []byte, metadata bool) (map[string]map[string]any, []string, error) {
	if metadata {
		var out struct {
			Metrics map[string]map[string]any `json:"metrics"`
		}
		if err := json.Unmarshal(resp, &out); err != nil {
			return nil, nil, err
		}
		return out.Metrics, nil, nil
	}

	var listOut struct {
		Metrics []string `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &listOut); err == nil {
		sort.Strings(listOut.Metrics)
		return nil, listOut.Metrics, nil
	} else {
		return nil, nil, fmt.Errorf("failed to parse metrik lookup response: %w", err)
	}
}

// decodeMetricSearchResponse parses description search responses into a metric list.
func decodeMetricSearchResponse(resp []byte) ([]string, error) {
	var out metricSearchResponse
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	list := make([]string, 0, len(out.Metrics))
	for _, metric := range out.Metrics {
		if metric.Name == "" {
			continue
		}
		list = append(list, metric.Name)
	}
	sort.Strings(list)
	return list, nil
}

// lookupMetricsByDescription resolves metrics by searching textual descriptions.
func (s *service) lookupMetricsByDescription(ctx context.Context, query string, limit int) ([]string, error) {
	searchPayload := metricSearchRequest{
		Function: "metrics.search",
		Query:    query,
		Field:    "description",
		Mode:     "phrase",
		Historic: true,
		Limit:    limit,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "metrics.search", searchPayload)
	if err != nil {
		return nil, err
	}
	return decodeMetricSearchResponse(resp)
}

// lookupMetadata fetches metadata for a single metric.
func (s *service) lookupMetadata(ctx context.Context, metric string) (map[string]any, error) {
	payload := metricLookupRequest{
		Function: "get_metrics",
		Format:   "object",
		Selector: []string{metric},
		Historic: true,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "get_metrics", payload)
	if err != nil {
		return nil, err
	}
	var out struct {
		Metrics map[string]map[string]any `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	meta, ok := out.Metrics[metric]
	if !ok {
		return nil, fmt.Errorf("metric not found")
	}
	return meta, nil
}

// queryMetric fetches a timeline with raw or aggregate data depending on zoom level.
func (s *service) queryMetric(ctx context.Context, metric string, fromMS, toMS int64, maxDataPoints int) (metricq.TimelineResult, error) {
	if maxDataPoints <= 0 {
		maxDataPoints = 1000
	}
	spanNS := (toMS - fromMS) * int64(time.Millisecond)
	intervalNS := (spanNS / int64(maxDataPoints)) * 2
	if intervalNS <= 0 {
		intervalNS = int64(time.Millisecond)
	}
	return s.history.RequestTimeline(
		ctx,
		metric,
		time.UnixMilli(fromMS),
		time.UnixMilli(toMS),
		time.Duration(intervalNS),
	)
}

// candlestickSubBucketsPerCandle controls how finely we ask HTA to bucket data
// before resampling into candles. Requesting with this sub-interval (rather
// than an unbounded raw fetch) lets HTA itself decide whether to hand back raw
// values or pre-aggregated rows, which keeps the response bounded by the
// requested resolution instead of by however much raw data exists in range.
const candlestickSubBucketsPerCandle = 6

// candlestickDensityFactor widens candles relative to maxDataPoints (which is
// sized for ~1 line point per pixel). Candlesticks need a few pixels of width
// each to read cleanly, so we render somewhat fewer, wider candles than a
// line/aggregate series would at the same zoom level.
const candlestickDensityFactor = 0.7

// candlestickMinCandles is the floor on candle count so tightly zoomed ranges
// still resample into more than a couple of buckets.
const candlestickMinCandles = 20

// queryMetricCandles resamples a metric into OHLC candlestick buckets. HTA's
// aggregate storage only keeps min/max/avg/count per bucket, never open/close,
// so we request at a finer sub-interval than the final candle width and derive
// open/close from the first/last sample (or sub-bucket) seen in each candle.
func (s *service) queryMetricCandles(ctx context.Context, metric string, fromMS, toMS int64, maxCandles int) (apiQuerySeries, error) {
	if maxCandles <= 0 {
		maxCandles = 200
	}
	maxCandles = int(float64(maxCandles) * candlestickDensityFactor)
	if maxCandles < candlestickMinCandles {
		maxCandles = candlestickMinCandles
	}
	span := toMS - fromMS
	if span <= 0 {
		span = 1
	}
	bucketWidthMS := (span + int64(maxCandles) - 1) / int64(maxCandles)
	if bucketWidthMS < 1 {
		bucketWidthMS = 1
	}
	subIntervalNS := (bucketWidthMS * int64(time.Millisecond)) / candlestickSubBucketsPerCandle
	if subIntervalNS <= 0 {
		subIntervalNS = int64(time.Millisecond)
	}

	timeline, err := s.history.RequestTimeline(ctx, metric, time.UnixMilli(fromMS), time.UnixMilli(toMS), time.Duration(subIntervalNS))
	if err != nil {
		return apiQuerySeries{Metric: metric, Error: err.Error()}, nil
	}

	switch data := timeline.(type) {
	case nil:
		return apiQuerySeries{Metric: metric, Mode: "empty", Stats: map[string]any{"type": "empty"}}, nil
	case *metricq.TimelineValues:
		if len(data.Values) == 0 {
			return apiQuerySeries{Metric: metric, Mode: "empty", Stats: map[string]any{"type": "empty"}}, nil
		}
		if len(data.Values) <= maxCandles {
			// Zoomed in far enough that there's roughly one raw sample per
			// candle or fewer: candles would be degenerate (no wick, just a
			// dot), so show the raw samples themselves instead, same as
			// line/TI mode does at this zoom level.
			return historyToSeries(metric, data), nil
		}
		series := bucketCandlesticksFromRaw(metric, data, fromMS, bucketWidthMS)
		series.Duration = data.Duration.Seconds()
		return series, nil
	case *metricq.TimelineAggregates:
		if len(data.Agg) == 0 {
			return apiQuerySeries{Metric: metric, Mode: "empty", Stats: map[string]any{"type": "empty"}}, nil
		}
		series := bucketCandlesticksFromAggregates(metric, data, fromMS, bucketWidthMS)
		series.Duration = data.Duration.Seconds()
		return series, nil
	default:
		return apiQuerySeries{Metric: metric, Error: "unexpected timeline response"}, nil
	}
}

type candleBucket struct {
	open, high, low, close, sum float64
	count                       uint64
	firstMS, lastMS             int64
}

// bucketCandlesticksFromRaw resamples raw values into candles with exact open/close.
func bucketCandlesticksFromRaw(metric string, raw *metricq.TimelineValues, fromMS, bucketWidthMS int64) apiQuerySeries {
	buckets := map[int64]*candleBucket{}
	order := []int64{}
	for i, v := range raw.Values {
		t := raw.Times[i].UnixMilli()
		idx := (t - fromMS) / bucketWidthMS
		b, exists := buckets[idx]
		if !exists {
			b = &candleBucket{open: v, high: v, low: v, firstMS: t}
			buckets[idx] = b
			order = append(order, idx)
		}
		if v > b.high {
			b.high = v
		}
		if v < b.low {
			b.low = v
		}
		b.close = v
		b.sum += v
		b.count++
		b.lastMS = t
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })

	points := make([]apiAggPoint, 0, len(order))
	var sampleCount uint64
	havePrevClose := false
	var prevClose float64
	for _, idx := range order {
		b := buckets[idx]
		// Center on the actual first/last sample timestamps seen in this
		// bucket rather than an arbitrary fromMS-anchored grid position, so
		// candles line up with where line/TI mode plots the same samples.
		centerMS := (b.firstMS + b.lastMS) / 2
		// Carry the previous candle's close forward as this candle's open so
		// candles form a continuous line, matching what the metric's value
		// actually was going into this bucket rather than just the first
		// sample that happened to land in it.
		open := b.open
		if havePrevClose {
			open = prevClose
		}
		high := b.high
		low := b.low
		if open > high {
			high = open
		}
		if open < low {
			low = open
		}
		closeV := b.close
		points = append(points, apiAggPoint{
			T:     centerMS,
			Min:   low,
			Max:   high,
			Avg:   b.sum / float64(b.count),
			Count: b.count,
			Open:  &open,
			Close: &closeV,
		})
		sampleCount += b.count
		prevClose = closeV
		havePrevClose = true
	}

	return apiQuerySeries{
		Metric:        metric,
		Mode:          "candlestick",
		AggPoints:     points,
		CandleWidthMS: bucketWidthMS,
		SampleCount:   sampleCount,
		Stats:         map[string]any{"type": "candlestick"},
	}
}

type candleAggBucket struct {
	firstMean, lastMean float64
	minVal, maxVal      float64
	sumIntegral         float64
	sumActiveTime       int64
	sumCount            uint64
	firstMS, lastMS     int64
}

// bucketCandlesticksFromAggregates resamples HTA's own (finer-grained) aggregate
// rows into candles. Since aggregate storage has no raw open/close, open/close
// are approximated as the mean of the first/last sub-bucket within each candle.
func bucketCandlesticksFromAggregates(metric string, data *metricq.TimelineAggregates, fromMS, bucketWidthMS int64) apiQuerySeries {
	buckets := map[int64]*candleAggBucket{}
	order := []int64{}
	for i, agg := range data.Agg {
		if agg == nil || agg.Count == 0 {
			continue
		}
		t := data.Times[i].UnixMilli()
		idx := (t - fromMS) / bucketWidthMS
		mean := aggregateMean(agg)
		b, exists := buckets[idx]
		if !exists {
			b = &candleAggBucket{firstMean: mean, minVal: agg.Minimum, maxVal: agg.Maximum, firstMS: t}
			buckets[idx] = b
			order = append(order, idx)
		}
		if agg.Maximum > b.maxVal {
			b.maxVal = agg.Maximum
		}
		if agg.Minimum < b.minVal {
			b.minVal = agg.Minimum
		}
		b.lastMean = mean
		b.sumIntegral += agg.Integral
		b.sumActiveTime += agg.ActiveTime
		b.sumCount += agg.Count
		b.lastMS = t
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })

	points := make([]apiAggPoint, 0, len(order))
	var sampleCount uint64
	havePrevClose := false
	var prevClose float64
	for _, idx := range order {
		b := buckets[idx]
		// Center on the actual first/last sub-bucket timestamps seen in this
		// candle rather than an arbitrary fromMS-anchored grid position, so
		// candles line up with where line/TI mode plots the same aggregates.
		centerMS := (b.firstMS + b.lastMS) / 2
		avg := b.firstMean
		if b.sumActiveTime > 0 {
			avg = b.sumIntegral / float64(b.sumActiveTime)
		}
		// Carry the previous candle's close forward as this candle's open,
		// same as bucketCandlesticksFromRaw, so candles form a continuous line.
		open := b.firstMean
		if havePrevClose {
			open = prevClose
		}
		high := b.maxVal
		low := b.minVal
		if open > high {
			high = open
		}
		if open < low {
			low = open
		}
		closeV := b.lastMean
		points = append(points, apiAggPoint{
			T:     centerMS,
			Min:   low,
			Max:   high,
			Avg:   avg,
			Count: b.sumCount,
			Open:  &open,
			Close: &closeV,
		})
		sampleCount += b.sumCount
		prevClose = closeV
		havePrevClose = true
	}

	return apiQuerySeries{
		Metric:        metric,
		Mode:          "candlestick",
		AggPoints:     points,
		CandleWidthMS: bucketWidthMS,
		SampleCount:   sampleCount,
		Stats:         map[string]any{"type": "candlestick"},
	}
}

// historyToSeries converts a MetricQ timeline result into the API wire format.
func historyToSeries(metric string, timeline metricq.TimelineResult) apiQuerySeries {
	series := apiQuerySeries{Metric: metric, Stats: map[string]any{}}
	switch data := timeline.(type) {
	case nil:
		series.Mode = "empty"
		series.Stats["type"] = "empty"
		return series
	case *metricq.TimelineValues:
		series.Duration = data.Duration.Seconds()
		series.Mode = "values"
		series.Points = make([]apiPoint, 0, len(data.Values))
		for i, value := range data.Values {
			series.Points = append(series.Points, apiPoint{T: data.Times[i].UnixMilli(), V: value})
		}
		series.SampleCount = uint64(len(series.Points))
		series.Stats["type"] = "raw"
		return series
	case *metricq.TimelineAggregates:
		series.Duration = data.Duration.Seconds()
		series.Mode = "aggregates"
		series.AggPoints = make([]apiAggPoint, 0, len(data.Agg))
		var sampleCount uint64
		for i, agg := range data.Agg {
			avg := aggregateMean(agg)
			activeTimeMS := agg.ActiveTime / int64(time.Millisecond)
			if agg.ActiveTime > 0 && activeTimeMS == 0 {
				activeTimeMS = 1
			}
			series.AggPoints = append(series.AggPoints, apiAggPoint{
				T:            data.Times[i].UnixMilli(),
				Min:          agg.Minimum,
				Max:          agg.Maximum,
				Avg:          avg,
				Count:        agg.Count,
				ActiveTimeMS: activeTimeMS,
			})
			sampleCount += agg.Count
		}
		series.SampleCount = sampleCount
		series.Stats["type"] = "aggregate"
		return series
	default:
		series.Error = "unexpected timeline response"
		return series
	}
}

// scaleValueByFunction extracts and scales one aggregate statistic.
func scaleValueByFunction(agg *metricq.HistoryResponse_Aggregate, fn string, scale float64) float64 {
	switch fn {
	case "min":
		return agg.Minimum * scale
	case "max":
		return agg.Maximum * scale
	case "count":
		return float64(agg.Count)
	default:
		return aggregateMean(agg) * scale
	}
}

// aggregateMean returns the arithmetic mean for an aggregate response.
func aggregateMean(agg *metricq.HistoryResponse_Aggregate) float64 {
	if agg == nil {
		return 0
	}
	if mean, err := agg.Mean(); err == nil {
		return mean
	}
	return 0
}

// safeMean divides sum by count while handling empty inputs.
func safeMean(sum float64, count uint64) float64 {
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

// waitGroupRun executes a metric callback in parallel and waits for completion.
func waitGroupRun(metrics []string, fn func(i int, metric string)) {
	var wg sync.WaitGroup
	wg.Add(len(metrics))
	for i, metric := range metrics {
		i := i
		metric := metric
		go func() {
			defer wg.Done()
			fn(i, metric)
		}()
	}
	wg.Wait()
}

// avgOrNaN returns the average or NaN when the count is zero.
func avgOrNaN(sum float64, count uint64) float64 {
	if count == 0 {
		return math.NaN()
	}
	return sum / float64(count)
}

// suggestFieldValues returns suggested metadata values for one field.
func (s *service) suggestFieldValues(ctx context.Context, field string, filter map[string]any, limit int) ([]metricSuggestValue, error) {
	payload := metricSuggestRequest{
		Function: "metrics.suggest",
		Field:    field,
		Filter:   filter,
		Limit:    limit,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "metrics.suggest", payload)
	if err != nil {
		return nil, err
	}
	var out metricSuggestResponse
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	return out.Values, nil
}

// resolveMetricsByFilter resolves metrics that match a structured metadata filter.
func (s *service) resolveMetricsByFilter(ctx context.Context, filter map[string]any, limit, offset int) ([]metricResolveEntry, error) {
	payload := metricResolveRequest{
		Function: "metrics.resolve",
		Filter:   filter,
		Limit:    limit,
		Offset:   offset,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "metrics.resolve", payload)
	if err != nil {
		return nil, err
	}
	var out metricResolveResponse
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	return out.Metrics, nil
}

// searchMetricsAdvanced dispatches advanced metric search by mode and filter state.
func (s *service) searchMetricsAdvanced(ctx context.Context, query, mode string, filter map[string]any, limit, offset int) ([]advancedSearchResult, error) {
	switch mode {
	case "infix", "selector":
		return s.advancedSearchByName(ctx, query, mode, limit)
	case "description":
		return s.advancedSearchByDescription(ctx, query, limit, offset)
	default:
		return s.advancedSearchByFilter(ctx, filter, limit, offset)
	}
}

// advancedSearchByName searches metrics by name or selector semantics.
func (s *service) advancedSearchByName(ctx context.Context, query, mode string, limit int) ([]advancedSearchResult, error) {
	var (
		metaMap map[string]map[string]any
		err     error
	)
	if mode == "selector" {
		metaMap, _, err = s.lookupMetricsSelectors(ctx, query, true, limit)
	} else {
		metaMap, _, err = s.lookupMetrics(ctx, query, true, limit)
	}
	if err != nil {
		return nil, err
	}
	results := make([]advancedSearchResult, 0, len(metaMap))
	for name, meta := range metaMap {
		desc, _ := meta["description"].(string)
		results = append(results, advancedSearchResult{
			Name:        name,
			Description: desc,
			Metadata:    meta,
		})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Name < results[j].Name })
	return results, nil
}

// advancedSearchByDescription searches metrics by textual descriptions.
func (s *service) advancedSearchByDescription(ctx context.Context, query string, limit, offset int) ([]advancedSearchResult, error) {
	searchPayload := struct {
		Function string         `json:"function"`
		Query    string         `json:"query"`
		Fields   []string       `json:"fields"`
		Mode     string         `json:"mode"`
		Filter   map[string]any `json:"filter,omitempty"`
		Historic bool           `json:"historic"`
		Limit    int            `json:"limit"`
		Offset   int            `json:"offset"`
	}{
		Function: "metrics.search",
		Query:    query,
		Fields:   []string{"description"},
		Mode:     "words",
		Historic: true,
		Limit:    limit,
		Offset:   offset,
	}
	resp, err := s.agent.Rpc(ctx, "metricq.management", "metrics.search", searchPayload)
	if err != nil {
		return nil, err
	}
	var out metricSearchResponse
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, err
	}
	results := make([]advancedSearchResult, 0, len(out.Metrics))
	for _, m := range out.Metrics {
		if m.Name == "" {
			continue
		}
		desc, _ := m.Metadata["description"].(string)
		results = append(results, advancedSearchResult{
			Name:        m.Name,
			Description: desc,
			Metadata:    m.Metadata,
		})
	}
	return results, nil
}

// advancedSearchByFilter searches metrics by structured metadata filters only.
func (s *service) advancedSearchByFilter(ctx context.Context, filter map[string]any, limit, offset int) ([]advancedSearchResult, error) {
	entries, err := s.resolveMetricsByFilter(ctx, filter, limit, offset)
	if err != nil {
		return nil, err
	}
	results := make([]advancedSearchResult, 0, len(entries))
	for _, e := range entries {
		desc, _ := e.Metadata["description"].(string)
		results = append(results, advancedSearchResult{
			Name:        e.Name,
			Description: desc,
			Metadata:    e.Metadata,
		})
	}
	return results, nil
}
