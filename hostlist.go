package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var hostlistRangePattern = regexp.MustCompile(`^(\d+)-(\d+)$`)

func expandHostlistQuery(query string, limit int) ([]string, bool) {
	q := strings.TrimSpace(query)
	if q == "" || !strings.Contains(q, "[") || !strings.Contains(q, "]") {
		return nil, false
	}
	if limit <= 0 {
		limit = 25
	}
	values, ok := expandHostlistSegment(q, limit)
	if !ok || len(values) == 0 {
		return nil, false
	}
	return values, true
}

func expandHostlistSegment(query string, limit int) ([]string, bool) {
	if query == "" {
		return []string{""}, true
	}
	open := strings.IndexByte(query, '[')
	if open < 0 {
		return []string{query}, true
	}
	close := strings.IndexByte(query[open+1:], ']')
	if close < 0 {
		return nil, false
	}
	close += open + 1
	prefix := query[:open]
	body := query[open+1 : close]
	suffix := query[close+1:]
	items, ok := expandHostlistItems(body, limit)
	if !ok || len(items) == 0 {
		return nil, false
	}
	rest, ok := expandHostlistSegment(suffix, limit)
	if !ok || len(rest) == 0 {
		return nil, false
	}
	out := make([]string, 0, len(items)*len(rest))
	for _, item := range items {
		for _, tail := range rest {
			if len(out) == limit {
				return out, true
			}
			out = append(out, prefix+item+tail)
		}
	}
	return out, true
}

func expandHostlistItems(body string, limit int) ([]string, bool) {
	parts := strings.Split(body, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, false
		}
		if m := hostlistRangePattern.FindStringSubmatch(part); m != nil {
			startRaw, endRaw := m[1], m[2]
			start, errStart := strconv.Atoi(startRaw)
			end, errEnd := strconv.Atoi(endRaw)
			if errStart != nil || errEnd != nil || end < start {
				return nil, false
			}
			width := len(startRaw)
			if len(endRaw) > width {
				width = len(endRaw)
			}
			for value := start; value <= end; value++ {
				if len(out) == limit {
					return out, true
				}
				out = append(out, fmt.Sprintf("%0*d", width, value))
			}
			continue
		}
		out = append(out, part)
		if len(out) > limit {
			return nil, false
		}
	}
	return out, true
}
