package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	metricq "github.com/metricq/metricq-go"
	amqp "github.com/rabbitmq/amqp091-go"
)

func newService(ctx context.Context, cfg config) (*service, error) {
	agent, err := metricq.NewAgent(cfg.MetricQToken, cfg.MetricQServer)
	if err != nil {
		return nil, fmt.Errorf("new metricq agent: %w", err)
	}
	if err := agent.Connect(ctx); err != nil {
		return nil, fmt.Errorf("connect metricq management: %w", err)
	}

	respBytes, err := agent.Rpc(ctx, "metricq.management", "history.register", metricq.RpcMessage{Function: "history.register"})
	if err != nil {
		agent.Close()
		return nil, fmt.Errorf("rpc history.register: %w", err)
	}

	var reg historyRegisterResponse
	if err := json.Unmarshal(respBytes, &reg); err != nil {
		agent.Close()
		return nil, fmt.Errorf("parse history.register response: %w", err)
	}
	if reg.DataServerAddress == "" || reg.HistoryExchange == "" || reg.HistoryQueue == "" {
		agent.Close()
		return nil, fmt.Errorf("invalid history.register response")
	}

	historyURL, err := deriveDataURL(cfg.MetricQServer, reg.DataServerAddress)
	if err != nil {
		agent.Close()
		return nil, err
	}

	historyConn, err := amqp.Dial(historyURL)
	if err != nil {
		agent.Close()
		return nil, fmt.Errorf("connect history amqp: %w", err)
	}
	historyCh, err := historyConn.Channel()
	if err != nil {
		_ = historyConn.Close()
		agent.Close()
		return nil, fmt.Errorf("open history channel: %w", err)
	}

	if _, err := historyCh.QueueDeclarePassive(reg.HistoryQueue, false, false, false, false, nil); err != nil {
		_ = historyCh.Close()
		_ = historyConn.Close()
		agent.Close()
		return nil, fmt.Errorf("declare passive history queue: %w", err)
	}

	svc := &service{
		agent:        agent,
		cfg:          cfg,
		historyConn:  historyConn,
		historyCh:    historyCh,
		historyQueue: reg.HistoryQueue,
		historyEx:    reg.HistoryExchange,
		pending:      make(map[string]chan pendingResponse),
	}
	if err := svc.startConsumer(ctx); err != nil {
		svc.Close()
		return nil, err
	}
	return svc, nil
}

func deriveDataURL(baseURL, dataServerAddress string) (string, error) {
	base, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	dataURL, err := url.Parse(dataServerAddress)
	if err != nil {
		return "", err
	}
	if dataURL.Scheme == "vhost" {
		dataURL.Scheme = base.Scheme
		dataURL.Host = base.Host
	}
	if dataURL.User == nil && base.User != nil {
		dataURL.User = base.User
	}
	return dataURL.String(), nil
}

func (s *service) startConsumer(ctx context.Context) error {
	msgs, err := s.historyCh.Consume(s.historyQueue, "", false, true, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume history queue: %w", err)
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-msgs:
				if !ok {
					return
				}
				s.handleHistoryMessage(msg)
			}
		}
	}()
	return nil
}

func (s *service) handleHistoryMessage(msg amqp.Delivery) {
	defer func() {
		_ = msg.Ack(false)
	}()
	if msg.CorrelationId == "" {
		return
	}

	s.pendingMu.Lock()
	ch, ok := s.pending[msg.CorrelationId]
	s.pendingMu.Unlock()
	if !ok {
		return
	}

	duration := -1.0
	if raw, ok := msg.Headers["x-request-duration"]; ok {
		switch v := raw.(type) {
		case string:
			if parsed, err := strconv.ParseFloat(v, 64); err == nil {
				duration = parsed
			}
		case float64:
			duration = v
		case int64:
			duration = float64(v)
		case int32:
			duration = float64(v)
		}
	}

	select {
	case ch <- pendingResponse{body: msg.Body, duration: duration}:
	default:
	}
}

func (s *service) Close() {
	s.closeOnce.Do(func() {
		if s.historyCh != nil {
			_ = s.historyCh.Close()
		}
		if s.historyConn != nil {
			_ = s.historyConn.Close()
		}
		if s.agent != nil {
			s.agent.Close()
		}
	})
}

func (s *service) requestHistory(ctx context.Context, req historyRequest) (historyResponse, float64, error) {
	correlationID := "mq-history-go-" + uuid.NewString()
	payload := encodeHistoryRequest(req)

	ch := make(chan pendingResponse, 1)
	s.pendingMu.Lock()
	s.pending[correlationID] = ch
	s.pendingMu.Unlock()
	defer func() {
		s.pendingMu.Lock()
		delete(s.pending, correlationID)
		s.pendingMu.Unlock()
	}()

	msg := amqp.Publishing{
		Body:          payload,
		MessageId:     correlationID,
		CorrelationId: correlationID,
		ReplyTo:       s.historyQueue,
		AppId:         s.cfg.MetricQToken,
	}
	if err := s.historyCh.PublishWithContext(ctx, s.historyEx, req.Metric, true, false, msg); err != nil {
		return historyResponse{}, 0, fmt.Errorf("publish history request: %w", err)
	}

	timeout := req.Timeout
	if timeout <= 0 {
		timeout = s.cfg.QueryTimeout
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return historyResponse{}, 0, ctx.Err()
	case <-timer.C:
		return historyResponse{}, 0, fmt.Errorf("history request timeout")
	case response := <-ch:
		decoded, err := decodeHistoryResponse(response.body)
		if err != nil {
			return historyResponse{}, 0, err
		}
		return decoded, response.duration, nil
	}
}

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

func (s *service) lookupMetricsSelector(ctx context.Context, selector string, metadata bool, limit int) (map[string]map[string]any, []string, error) {
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
	if selector != "" {
		payload.Selector = selector
	}
	return s.lookupMetricsByPayload(ctx, payload, metadata)
}

func (s *service) lookupMetricsByPayload(ctx context.Context, payload metricLookupRequest, metadata bool) (map[string]map[string]any, []string, error) {

	resp, err := s.agent.Rpc(ctx, "metricq.management", "get_metrics", payload)
	if err != nil {
		return nil, nil, err
	}

	if metadata {
		var out struct {
			Metrics map[string]map[string]any `json:"metrics"`
		}
		if err := json.Unmarshal(resp, &out); err != nil {
			return nil, nil, err
		}
		return out.Metrics, nil, nil
	}

	var out struct {
		Metrics []string `json:"metrics"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, nil, err
	}
	sort.Strings(out.Metrics)
	return nil, out.Metrics, nil
}

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

func (s *service) queryMetric(ctx context.Context, metric string, fromMS, toMS int64, maxDataPoints int) (historyResponse, float64, error) {
	if maxDataPoints <= 0 {
		maxDataPoints = 1000
	}
	spanNS := (toMS - fromMS) * int64(time.Millisecond)
	intervalNS := (spanNS / int64(maxDataPoints)) * 2
	if intervalNS <= 0 {
		intervalNS = int64(time.Millisecond)
	}
	return s.requestHistory(ctx, historyRequest{
		Metric:      metric,
		StartTimeNS: fromMS * int64(time.Millisecond),
		EndTimeNS:   toMS * int64(time.Millisecond),
		IntervalMax: intervalNS,
		RequestType: historyRequestTypeFlexTimeline,
		Timeout:     s.cfg.QueryTimeout,
	})
}

func historyToSeries(metric string, hr historyResponse, duration float64) apiQuerySeries {
	series := apiQuerySeries{Metric: metric, Duration: duration, Stats: map[string]any{}}
	if hr.Error != "" {
		series.Error = hr.Error
		return series
	}
	if len(hr.TimeDelta) == len(hr.Values) && len(hr.Values) > 0 {
		series.Mode = "values"
		series.Points = make([]apiPoint, 0, len(hr.Values))
		ts := int64(0)
		for i, value := range hr.Values {
			ts += hr.TimeDelta[i]
			series.Points = append(series.Points, apiPoint{T: ts / int64(time.Millisecond), V: value})
		}
		series.RawCount = float64(len(series.Points))
		series.Stats["type"] = "raw"
		return series
	}
	if len(hr.TimeDelta) == len(hr.Agg) && len(hr.Agg) > 0 {
		series.Mode = "aggregates"
		series.AggPoints = make([]apiAggPoint, 0, len(hr.Agg))
		ts := int64(0)
		rawCount := 0.0
		for i, agg := range hr.Agg {
			ts += hr.TimeDelta[i]
			avg := 0.0
			if agg.Count > 0 {
				avg = agg.Sum / float64(agg.Count)
			}
			series.AggPoints = append(series.AggPoints, apiAggPoint{
				T:     ts / int64(time.Millisecond),
				Min:   agg.Minimum,
				Max:   agg.Maximum,
				Avg:   avg,
				Count: agg.Count,
			})
			rawCount += float64(agg.Count)
		}
		series.RawCount = rawCount
		series.Stats["type"] = "aggregate"
		return series
	}
	series.Mode = "empty"
	series.Stats["type"] = "empty"
	return series
}

func scaleValueByFunction(agg historyAggregate, fn string, scale float64) float64 {
	switch fn {
	case "min":
		return agg.Minimum * scale
	case "max":
		return agg.Maximum * scale
	case "count":
		return float64(agg.Count)
	default:
		if agg.Count == 0 {
			return 0
		}
		return (agg.Sum / float64(agg.Count)) * scale
	}
}

func buildCompatTimelineValue(ts int64, value float64) map[string]any {
	return map[string]any{
		"timestamp": ts * int64(time.Microsecond),
		"value":     value,
	}
}

func buildCompatTimelineAggregate(ts int64, agg historyAggregate) map[string]any {
	return map[string]any{
		"timestamp":   ts * int64(time.Microsecond),
		"minimum":     agg.Minimum,
		"maximum":     agg.Maximum,
		"sum":         agg.Sum,
		"count":       agg.Count,
		"integral_ns": agg.Integral,
		"active_time": agg.ActiveTime,
	}
}

func safeMean(sum float64, count uint64) float64 {
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

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

func avgOrNaN(sum float64, count uint64) float64 {
	if count == 0 {
		return math.NaN()
	}
	return sum / float64(count)
}
