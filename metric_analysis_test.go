package main

import (
	"math"
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
