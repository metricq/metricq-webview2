package main

import (
	"encoding/json"
	"math"
	"net/http/httptest"
	"testing"

	metricq "github.com/metricq/metricq-go"
)

func TestAnalyzeEndpoints(t *testing.T) {
	first, last := analyzeEndpoints(map[int64]float64{-10: math.NaN(), 30: 2, 10: 7, 20: -4, 40: math.Inf(1)})
	if first == nil || last == nil || *first != 7 || *last != 2 {
		t.Fatalf("unexpected endpoints: %v, %v", first, last)
	}
	first, last = analyzeEndpoints(map[int64]float64{1: math.NaN()})
	if first != nil || last != nil {
		t.Fatal("expected absent endpoints for invalid values")
	}
	first, last = analyzeEndpoints(map[int64]float64{1: 0})
	if first == nil || last == nil || *first != 0 || *last != 0 {
		t.Fatal("single zero sample must be both endpoints")
	}
}

func TestAnalyzeEmptyMetricPreservesOtherEntries(t *testing.T) {
	for _, aggs := range [][]*metricq.HistoryResponse_Aggregate{
		nil,
		{nil},
		{{Count: 0, Minimum: math.Inf(1), Maximum: math.Inf(-1), Sum: math.NaN()}},
	} {
		empty := apiAnalyzeEntry{Metric: "empty"}
		if populateAnalyzeAggregate(&empty, aggs) || empty.Error != "no data" {
			t.Fatalf("expected no-data entry: %+v", empty)
		}
		valid := apiAnalyzeEntry{Metric: "valid"}
		if !populateAnalyzeAggregate(&valid, []*metricq.HistoryResponse_Aggregate{{Count: 2, Minimum: 1, Maximum: 3, Sum: 4, Integral: 4, ActiveTime: 2}}) {
			t.Fatal("valid aggregate rejected")
		}
		response := httptest.NewRecorder()
		writeJSON(response, 200, map[string]any{"entries": []apiAnalyzeEntry{valid, empty}})
		var body struct {
			Entries []apiAnalyzeEntry `json:"entries"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("analysis response is not valid JSON: %v", err)
		}
		if len(body.Entries) != 2 || body.Entries[0].Mean != 2 || body.Entries[1].Error != "no data" {
			t.Fatalf("unexpected response: %+v", body)
		}
	}
}

func TestAnalyzeRejectsNonFiniteAggregate(t *testing.T) {
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		entry := apiAnalyzeEntry{Metric: "invalid"}
		if populateAnalyzeAggregate(&entry, []*metricq.HistoryResponse_Aggregate{{Count: 1, Minimum: value}}) {
			t.Fatal("non-finite aggregate accepted")
		}
		if _, err := json.Marshal(entry); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAnalyzeAggregateWithActiveTimeButNoNewSamples(t *testing.T) {
	entry := apiAnalyzeEntry{Metric: "partial"}
	if !populateAnalyzeAggregate(&entry, []*metricq.HistoryResponse_Aggregate{{
		Count: 0, Minimum: 5, Maximum: 5, Integral: 50, ActiveTime: 10,
	}}) {
		t.Fatalf("active aggregate rejected: %+v", entry)
	}
	if entry.Mean != 5 || entry.Error != "" {
		t.Fatalf("unexpected entry: %+v", entry)
	}
}

func TestAnalyzeAggregateEndpoints(t *testing.T) {
	first, last := analyzeAggregateEndpoints([]*metricq.HistoryResponse_Aggregate{
		nil,
		{Minimum: math.Inf(1), Maximum: math.Inf(-1)},
		{Count: 2, Minimum: 3, Maximum: 8},
		{Count: 4, Minimum: -20, Maximum: 100},
		{ActiveTime: 10, Minimum: 4, Maximum: 6},
		{Minimum: math.Inf(1), Maximum: math.Inf(-1)},
	})
	if first == nil || last == nil || *first != 3 || *last != 6 {
		t.Fatalf("expected first minimum 3 and last maximum 6, got %v, %v", first, last)
	}
	first, last = analyzeAggregateEndpoints([]*metricq.HistoryResponse_Aggregate{{Count: 1, Minimum: 0, Maximum: 7}})
	if first == nil || last == nil || *first != 0 || *last != 7 {
		t.Fatal("single bucket must supply its minimum and maximum")
	}
	first, last = analyzeAggregateEndpoints([]*metricq.HistoryResponse_Aggregate{{Minimum: math.NaN(), Maximum: math.NaN()}})
	if first != nil || last != nil {
		t.Fatal("empty timeline must have no endpoints")
	}
}
