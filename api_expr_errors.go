package main

import (
	"errors"
	"strings"
)

func buildExprErrorInfo(err error) *apiExprError {
	if err == nil {
		return nil
	}
	info := &apiExprError{
		Type:    "expression_error",
		Message: strings.TrimSpace(err.Error()),
	}
	var parseErr *exprParseError
	if errors.As(err, &parseErr) {
		info.Type = strings.TrimSpace(parseErr.Code)
		if info.Type == "" {
			info.Type = "expression_parse_error"
		}
		if msg := strings.TrimSpace(parseErr.Message); msg != "" {
			info.Message = msg
		}
		if tok := strings.TrimSpace(parseErr.Token); tok != "" {
			info.Token = tok
		}
		pos := parseErr.Pos
		end := parseErr.End
		info.Position = &pos
		info.End = &end
	}
	return info
}
