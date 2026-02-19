package main

import (
	"sync"
	"time"

	metricq "github.com/metricq/metricq-go"
	amqp "github.com/rabbitmq/amqp091-go"
)

type config struct {
	ListenAddr    string
	MetricQServer string
	MetricQToken  string
	QueryTimeout  time.Duration
	WebDir        string
}

type historyRegisterResponse struct {
	DataServerAddress string `json:"dataServerAddress"`
	HistoryExchange   string `json:"historyExchange"`
	HistoryQueue      string `json:"historyQueue"`
}

type pendingResponse struct {
	body     []byte
	duration float64
}

type service struct {
	agent *metricq.Agent
	cfg   config

	historyConn  *amqp.Connection
	historyCh    *amqp.Channel
	historyQueue string
	historyEx    string

	pendingMu sync.Mutex
	pending   map[string]chan pendingResponse

	closeOnce sync.Once
}

type historyRequest struct {
	Metric      string
	StartTimeNS int64
	EndTimeNS   int64
	IntervalMax int64
	RequestType int64
	Timeout     time.Duration
}

const (
	historyRequestTypeAggregateTimeline int64 = 0
	historyRequestTypeAggregate         int64 = 1
	historyRequestTypeLastValue         int64 = 2
	historyRequestTypeFlexTimeline      int64 = 3
)

type historyAggregate struct {
	Minimum    float64
	Maximum    float64
	Sum        float64
	Count      uint64
	Integral   float64
	ActiveTime int64
}

type historyResponse struct {
	Metric    string
	TimeDelta []int64
	Values    []float64
	Agg       []historyAggregate
	Error     string
}

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
	Metrics       []string `json:"metrics"`
	FromUnixMS    int64    `json:"from"`
	ToUnixMS      int64    `json:"to"`
	MaxDataPoints int      `json:"maxDataPoints"`
}

type apiQuerySeries struct {
	Metric     string         `json:"metric"`
	Mode       string         `json:"mode"`
	Duration   float64        `json:"duration"`
	Points     []apiPoint     `json:"points,omitempty"`
	AggPoints  []apiAggPoint  `json:"aggregatePoints,omitempty"`
	Error      string         `json:"error,omitempty"`
	PointCount int            `json:"pointCount"`
	RawCount   float64        `json:"rawCount"`
	Stats      map[string]any `json:"stats,omitempty"`
	Meta       map[string]any `json:"meta,omitempty"`
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
}

type apiAnalyzeRequest struct {
	Metrics    []string `json:"metrics"`
	FromUnixMS int64    `json:"from"`
	ToUnixMS   int64    `json:"to"`
}

type apiAnalyzeEntry struct {
	Metric   string  `json:"metric"`
	Minimum  float64 `json:"minimum"`
	Maximum  float64 `json:"maximum"`
	Sum      float64 `json:"sum"`
	Count    uint64  `json:"count"`
	Mean     float64 `json:"mean"`
	Duration float64 `json:"duration"`
	Error    string  `json:"error,omitempty"`
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

type compatQueryRequest struct {
	Range struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"range"`
	MaxDataPoints int `json:"maxDataPoints"`
	Targets       []struct {
		Metric        string   `json:"metric"`
		Name          string   `json:"name"`
		Functions     []string `json:"functions"`
		ScalingFactor string   `json:"scalingFactor"`
	} `json:"targets"`
}

type compatAnalyzeRequest struct {
	Range struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"range"`
	Targets []struct {
		Metric string `json:"metric"`
	} `json:"targets"`
}
