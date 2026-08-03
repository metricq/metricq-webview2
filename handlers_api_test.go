package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeMetricSearchResponse(t *testing.T) {
	list, err := decodeMetricSearchResponse([]byte(`{"metrics":[{"name":"b","metadata":{}},{"name":"a","metadata":{}}]}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list) != 2 || list[0] != "a" || list[1] != "b" {
		t.Fatalf("unexpected list: %#v", list)
	}
}

func TestResolveQueryTargetsEmpty(t *testing.T) {
	targets, err := resolveQueryTargets(apiQueryRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(targets) != 0 {
		t.Fatalf("unexpected len: %d", len(targets))
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
