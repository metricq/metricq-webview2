package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *service) handleAPIConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"legacyChartsBaseUrl": strings.TrimSpace(s.cfg.LegacyChartsBaseURL),
	})
}

func (s *service) handleAPIMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("query"))
	mode := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mode")))
	infix, selector := resolveMetricSearchQuery(query, mode)
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 5000 {
			limit = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var (
		list []string
		err  error
	)
	if mode == "description" {
		list, err = s.lookupMetricsByDescription(ctx, query, limit)
	} else if selectors, ok := expandHostlistQuery(infix, limit); ok {
		_, list, err = s.lookupMetricsSelectors(ctx, selectors, false, limit)
	} else if selector != "" {
		_, list, err = s.lookupMetricsSelector(ctx, selector, false, limit)
	} else {
		_, list, err = s.lookupMetrics(ctx, infix, false, limit)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrics": list})
}

func (s *service) handleAPIMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	metric := strings.TrimSpace(r.URL.Query().Get("metric"))
	if metric == "" {
		writeError(w, http.StatusBadRequest, "metric is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	meta, err := s.lookupMetadata(ctx, metric)
	if err != nil {
		writeError(w, http.StatusNotFound, "metric not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metric": metric, "metadata": meta})
}

func (s *service) handleAPIQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	targets, err := resolveQueryTargets(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(targets) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	results, err := s.executeAPIQuery(ctx, req, targets)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"series": results})
}

func (s *service) handleAPIExpressionValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiExpressionValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	expr := strings.TrimSpace(req.Expr)
	if expr == "" {
		pos := 0
		writeJSON(w, http.StatusOK, apiExpressionValidateResponse{
			Valid: false,
			Error: "empty expression",
			ErrorInfo: &apiExprError{
				Type:     "empty_expression",
				Message:  "empty expression",
				Position: &pos,
				End:      &pos,
			},
		})
		return
	}
	if _, err := parseExpression(expr); err != nil {
		writeJSON(w, http.StatusOK, apiExpressionValidateResponse{
			Valid:     false,
			Error:     err.Error(),
			ErrorInfo: buildExprErrorInfo(err),
		})
		return
	}
	writeJSON(w, http.StatusOK, apiExpressionValidateResponse{Valid: true})
}

func (s *service) handleAPIQueryStacked(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	targets, err := resolveQueryTargets(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(targets) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	results, err := s.executeAPIQuery(ctx, req, targets)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	resp, err := alignStackedSeries(results, req.FromUnixMS, req.ToUnixMS, req.MaxDataPoints)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *service) handleAPIAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiAnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	targets, err := resolveQueryTargets(apiQueryRequest{
		Targets: req.Targets,
		Metrics: req.Metrics,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(targets) == 0 || req.ToUnixMS <= req.FromUnixMS {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	writeJSON(w, http.StatusOK, map[string]any{
		"entries": s.executeAPIAnalyze(ctx, req, targets),
	})
}

func (s *service) handleAPIMetricsSuggestFields(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"fields": suggestableFields})
}

func (s *service) handleAPIMetricsSuggest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	field := strings.TrimSpace(r.URL.Query().Get("field"))
	if field == "" {
		writeError(w, http.StatusBadRequest, "field is required")
		return
	}
	if _, ok := suggestableFieldSet[field]; !ok {
		writeError(w, http.StatusBadRequest, "field is not suggestable")
		return
	}

	var filter map[string]any
	if raw := strings.TrimSpace(r.URL.Query().Get("filter")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &filter); err != nil {
			writeError(w, http.StatusBadRequest, "invalid filter json")
			return
		}
	}

	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	values, err := s.suggestFieldValues(ctx, field, filter, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"field": field, "values": values})
}

func (s *service) handleAPIMetricsResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Filter map[string]any `json:"filter"`
		Limit  int            `json:"limit"`
		Offset int            `json:"offset"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Limit <= 0 || req.Limit > 500 {
		req.Limit = 200
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	entries, err := s.resolveMetricsByFilter(ctx, req.Filter, req.Limit, req.Offset)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrics": entries})
}

func (s *service) handleAPIMetricsAdvancedSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req advancedSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Limit <= 0 || req.Limit > 500 {
		req.Limit = 100
	}
	req.Mode = strings.ToLower(strings.TrimSpace(req.Mode))
	if req.Mode == "" {
		req.Mode = "infix"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	results, err := s.searchMetricsAdvanced(ctx, req.Query, req.Mode, req.Filter, req.Limit, req.Offset)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrics": results})
}

func (s *service) handleAPIYRangeGlobal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req apiYRangeGlobalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.Metrics) == 0 {
		writeError(w, http.StatusBadRequest, "metrics are required")
		return
	}

	nowMS := time.Now().UnixMilli()
	toMS := req.ToUnixMS
	if toMS <= 0 {
		toMS = nowMS
	}
	fromMS := req.FromUnixMS
	if fromMS <= 0 || fromMS >= toMS {
		fromMS = toMS - int64((24*time.Hour*365*10)/time.Millisecond)
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	resp, err := s.computeGlobalYRange(ctx, req.Metrics, fromMS, toMS)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
