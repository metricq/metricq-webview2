package main

import (
	"encoding/json"
	metricq "github.com/metricq/metricq-go"
	"math"
	"net/http/httptest"
	"testing"
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
