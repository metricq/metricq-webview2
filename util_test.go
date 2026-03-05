package main

import (
	"slices"
	"testing"
)

func TestParseISOToUnixMS(t *testing.T) {
	got, err := parseISOToUnixMS("1970-01-01T00:00:00.001Z")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	const want int64 = 1
	if got != want {
		t.Fatalf("unexpected unix ms: got %d want %d", got, want)
	}
}

func TestContainsFn(t *testing.T) {
	list := []string{"min", "avg", "max"}
	if !slices.Contains(list, "avg") {
		t.Fatalf("expected to find function")
	}
	if slices.Contains(list, "count") {
		t.Fatalf("did not expect to find count")
	}
}
