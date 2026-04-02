package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeMetricLookupResponseAcceptsTopLevelArray(t *testing.T) {
	_, list, err := decodeMetricLookupResponse([]byte(`["b","a"]`), false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list) != 2 || list[0] != "a" || list[1] != "b" {
		t.Fatalf("unexpected list: %#v", list)
	}
}

func TestDecodeMetricLookupResponseAcceptsTopLevelObject(t *testing.T) {
	_, list, err := decodeMetricLookupResponse([]byte(`{"b":{},"a":{}}`), false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list) != 2 || list[0] != "a" || list[1] != "b" {
		t.Fatalf("unexpected list: %#v", list)
	}
}

func TestResolveQueryTargetsFallbackMetrics(t *testing.T) {
	targets, err := resolveQueryTargets(apiQueryRequest{Metrics: []string{"a", " b "}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("unexpected len: %d", len(targets))
	}
	if targets[1].Name != "b" || targets[1].Metric != "b" {
		t.Fatalf("unexpected target mapping: %#v", targets[1])
	}
}

func TestResolveQueryTargetsExpressionAndMetricValidation(t *testing.T) {
	_, err := resolveQueryTargets(apiQueryRequest{Targets: []apiQueryTarget{{Name: "x", Metric: "a", Expr: "a+b"}}})
	if err == nil {
		t.Fatalf("expected validation error when metric and expr are both set")
	}

	_, err = resolveQueryTargets(apiQueryRequest{Targets: []apiQueryTarget{{Name: "x"}}})
	if err == nil {
		t.Fatalf("expected validation error for empty target")
	}
}

func TestResolveQueryTargetsDuplicateNames(t *testing.T) {
	_, err := resolveQueryTargets(apiQueryRequest{Targets: []apiQueryTarget{
		{Name: "dup", Metric: "a"},
		{Name: "dup", Expr: "b+c"},
	}})
	if err == nil {
		t.Fatalf("expected duplicate name error")
	}
}

func TestResolveMetricSearchQueryMode(t *testing.T) {
	infix, selector := resolveMetricSearchQuery("foo", "infix")
	if infix != "foo" || selector != "" {
		t.Fatalf("unexpected infix mode split: infix=%q selector=%q", infix, selector)
	}

	infix, selector = resolveMetricSearchQuery("foo.*", "selector")
	if infix != "" || selector != "foo.*" {
		t.Fatalf("unexpected selector mode split: infix=%q selector=%q", infix, selector)
	}

	infix, selector = resolveMetricSearchQuery("/foo.*/", "")
	if infix != "/foo.*/" || selector != "" {
		t.Fatalf("unexpected default mode split: infix=%q selector=%q", infix, selector)
	}

	infix, selector = resolveMetricSearchQuery("temperatur", "description")
	if infix != "temperatur" || selector != "" {
		t.Fatalf("unexpected description mode split: infix=%q selector=%q", infix, selector)
	}
}

func TestExpandHostlistQuery(t *testing.T) {
	got, ok := expandHostlistQuery("foo[01-03].bar", 25)
	if !ok {
		t.Fatalf("expected hostlist expansion")
	}
	want := []string{"foo01.bar", "foo02.bar", "foo03.bar"}
	if len(got) != len(want) {
		t.Fatalf("unexpected hostlist len: got=%d want=%d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected hostlist item %d: got=%q want=%q", i, got[i], want[i])
		}
	}
}

func TestExpandHostlistQueryMultipleRanges(t *testing.T) {
	got, ok := expandHostlistQuery("rack[1-2]-node[7,9]", 10)
	if !ok {
		t.Fatalf("expected hostlist expansion")
	}
	want := []string{
		"rack1-node7",
		"rack1-node9",
		"rack2-node7",
		"rack2-node9",
	}
	if len(got) != len(want) {
		t.Fatalf("unexpected hostlist len: got=%d want=%d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected hostlist item %d: got=%q want=%q", i, got[i], want[i])
		}
	}
}

func TestExpandHostlistQueryRejectsOversizedExpansion(t *testing.T) {
	if got, ok := expandHostlistQuery("n[1-30]", 25); ok || got != nil {
		t.Fatalf("expected oversized hostlist to fall back, got ok=%v values=%v", ok, got)
	}
}

func TestHandleAPIConfigIncludesLegacyChartsBaseURL(t *testing.T) {
	svc := &service{cfg: config{LegacyChartsBaseURL: "https://legacy.example/charts/content/index.html"}}
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rec := httptest.NewRecorder()

	svc.handleAPIConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body == "" || !strings.Contains(body, "legacy.example/charts/content/index.html") {
		t.Fatalf("unexpected body: %s", body)
	}
}
