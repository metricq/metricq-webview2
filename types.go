package main

import (
	"time"

	"sync"

	metricq "github.com/metricq/metricq-go"
)

type config struct {
	ListenAddr    string
	MetricQServer string
	MetricQToken  string
	QueryTimeout  time.Duration
	WebDir        string
}

type service struct {
	agent   *metricq.Agent
	history *metricq.HistoryClient
	cfg     config

	closeOnce sync.Once
}

const (
	historyRequestTypeAggregateTimeline = metricq.HistoryRequestTypeAggregateTimeline
	historyRequestTypeAggregate         = metricq.HistoryRequestTypeAggregate
	historyRequestTypeLastValue         = metricq.HistoryRequestTypeLastValue
	historyRequestTypeFlexTimeline      = metricq.HistoryRequestTypeFlexTimeline
)

type metricLookupRequest struct {
	Function string `json:"function"`
	Format   string `json:"format"`
	Infix    string `json:"infix,omitempty"`
	Selector any    `json:"selector,omitempty"`
	Historic bool   `json:"historic,omitempty"`
	Hidden   bool   `json:"hidden,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

type apiQueryRequest struct {
	Targets       []apiQueryTarget `json:"targets,omitempty"`
	Metrics       []string         `json:"metrics,omitempty"`
	FromUnixMS    int64            `json:"from"`
	ToUnixMS      int64            `json:"to"`
	MaxDataPoints int              `json:"maxDataPoints"`
}

type apiQueryTarget struct {
	Name   string `json:"name,omitempty"`
	Metric string `json:"metric,omitempty"`
	Expr   string `json:"expr,omitempty"`
}

type apiQuerySeries struct {
	Metric      string         `json:"metric"`
	Mode        string         `json:"mode"`
	Duration    float64        `json:"duration"`
	Points      []apiPoint     `json:"points,omitempty"`
	AggPoints   []apiAggPoint  `json:"aggregatePoints,omitempty"`
	Error       string         `json:"error,omitempty"`
	ErrorInfo   *apiExprError  `json:"errorInfo,omitempty"`
	SampleCount uint64         `json:"sampleCount"`
	Stats       map[string]any `json:"stats,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
}

type apiExprError struct {
	Type     string `json:"type,omitempty"`
	Message  string `json:"message"`
	Token    string `json:"token,omitempty"`
	Position *int   `json:"position,omitempty"`
	End      *int   `json:"end,omitempty"`
}

type apiPoint struct {
	T int64   `json:"t"`
	V float64 `json:"v"`
}

type apiAggPoint struct {
	T     int64   `json:"t"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Avg   float64 `json:"avg"`
	Count uint64  `json:"count"`
	// ActiveTimeMS limits how far this aggregate avg is valid backwards under last semantics.
	ActiveTimeMS int64 `json:"activeTimeMs,omitempty"`
}

type apiAnalyzeRequest struct {
	Targets    []apiQueryTarget `json:"targets,omitempty"`
	Metrics    []string         `json:"metrics,omitempty"`
	FromUnixMS int64            `json:"from"`
	ToUnixMS   int64            `json:"to"`
}

type apiExpressionValidateRequest struct {
	Expr string `json:"expr"`
}

type apiExpressionValidateResponse struct {
	Valid     bool          `json:"valid"`
	Error     string        `json:"error,omitempty"`
	ErrorInfo *apiExprError `json:"errorInfo,omitempty"`
}

type apiAnalyzeEntry struct {
	Metric    string        `json:"metric"`
	Minimum   float64       `json:"minimum"`
	Maximum   float64       `json:"maximum"`
	Sum       float64       `json:"sum"`
	Count     uint64        `json:"count"`
	Mean      float64       `json:"mean"`
	Duration  float64       `json:"duration"`
	Error     string        `json:"error,omitempty"`
	ErrorInfo *apiExprError `json:"errorInfo,omitempty"`
}

type apiYRangeGlobalRequest struct {
	Metrics    []string `json:"metrics"`
	FromUnixMS int64    `json:"from,omitempty"`
	ToUnixMS   int64    `json:"to,omitempty"`
}

type apiYRangeGlobalResponse struct {
	Minimum float64  `json:"minimum"`
	Maximum float64  `json:"maximum"`
	Metrics []string `json:"metrics"`
}

type apiStackedSeriesResponse struct {
	Duration float64      `json:"duration"`
	Times    []int64      `json:"times"`
	Metrics  []string     `json:"metrics"`
	Values   [][]*float64 `json:"values"`
}
