package main

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

type evalValue struct {
	scalar *float64
	series map[int64]float64
}

func scalarEvalValue(v float64) evalValue {
	copyV := v
	return evalValue{scalar: &copyV}
}

func seriesEvalValue(src map[int64]float64) evalValue {
	out := make(map[int64]float64, len(src))
	for t, v := range src {
		out[t] = v
	}
	return evalValue{series: out}
}

func (v evalValue) isScalar() bool {
	return v.scalar != nil
}

type exprNode interface {
	eval(inputs map[string]map[int64]float64) (evalValue, error)
	collectMetrics(dst map[string]struct{})
}

type metricNode struct {
	name string
}

func (n metricNode) eval(inputs map[string]map[int64]float64) (evalValue, error) {
	series, ok := inputs[n.name]
	if !ok {
		return evalValue{}, fmt.Errorf("unknown metric %q", n.name)
	}
	return seriesEvalValue(series), nil
}

func (n metricNode) collectMetrics(dst map[string]struct{}) {
	dst[n.name] = struct{}{}
}

type numberNode struct {
	value float64
}

func (n numberNode) eval(_ map[string]map[int64]float64) (evalValue, error) {
	return scalarEvalValue(n.value), nil
}

func (n numberNode) collectMetrics(_ map[string]struct{}) {}

type unaryNode struct {
	op    string
	child exprNode
}

func (n unaryNode) eval(inputs map[string]map[int64]float64) (evalValue, error) {
	child, err := n.child.eval(inputs)
	if err != nil {
		return evalValue{}, err
	}
	if child.isScalar() {
		v := *child.scalar
		switch n.op {
		case "-":
			return scalarEvalValue(-v), nil
		case "log":
			if v <= 0 {
				return evalValue{series: map[int64]float64{}}, nil
			}
			return scalarEvalValue(math.Log10(v)), nil
		default:
			return evalValue{}, fmt.Errorf("unknown unary operator %q", n.op)
		}
	}

	out := make(map[int64]float64, len(child.series))
	for t, v := range child.series {
		switch n.op {
		case "-":
			out[t] = -v
		case "log":
			if v > 0 {
				out[t] = math.Log10(v)
			}
		default:
			return evalValue{}, fmt.Errorf("unknown unary operator %q", n.op)
		}
	}
	return evalValue{series: out}, nil
}

func (n unaryNode) collectMetrics(dst map[string]struct{}) {
	n.child.collectMetrics(dst)
}

type binaryNode struct {
	op          string
	left, right exprNode
}

func applyBinary(op string, lv, rv float64) (float64, bool, error) {
	switch op {
	case "+":
		return lv + rv, true, nil
	case "-":
		return lv - rv, true, nil
	case "*":
		return lv * rv, true, nil
	case "/":
		if rv == 0 {
			return 0, false, nil
		}
		return lv / rv, true, nil
	default:
		return 0, false, fmt.Errorf("unknown binary operator %q", op)
	}
}

func (n binaryNode) eval(inputs map[string]map[int64]float64) (evalValue, error) {
	left, err := n.left.eval(inputs)
	if err != nil {
		return evalValue{}, err
	}
	right, err := n.right.eval(inputs)
	if err != nil {
		return evalValue{}, err
	}

	if left.isScalar() && right.isScalar() {
		v, ok, err := applyBinary(n.op, *left.scalar, *right.scalar)
		if err != nil {
			return evalValue{}, err
		}
		if !ok {
			return evalValue{series: map[int64]float64{}}, nil
		}
		return scalarEvalValue(v), nil
	}

	if left.isScalar() {
		out := make(map[int64]float64, len(right.series))
		for t, rv := range right.series {
			v, ok, applyErr := applyBinary(n.op, *left.scalar, rv)
			if applyErr != nil {
				return evalValue{}, applyErr
			}
			if ok {
				out[t] = v
			}
		}
		return evalValue{series: out}, nil
	}

	if right.isScalar() {
		out := make(map[int64]float64, len(left.series))
		for t, lv := range left.series {
			v, ok, applyErr := applyBinary(n.op, lv, *right.scalar)
			if applyErr != nil {
				return evalValue{}, applyErr
			}
			if ok {
				out[t] = v
			}
		}
		return evalValue{series: out}, nil
	}

	if len(left.series) == 0 || len(right.series) == 0 {
		return evalValue{series: map[int64]float64{}}, nil
	}
	out := make(map[int64]float64, minInt(len(left.series), len(right.series)))
	for t, lv := range left.series {
		rv, ok := right.series[t]
		if !ok {
			continue
		}
		v, okResult, applyErr := applyBinary(n.op, lv, rv)
		if applyErr != nil {
			return evalValue{}, applyErr
		}
		if okResult {
			out[t] = v
		}
	}
	return evalValue{series: out}, nil
}

func (n binaryNode) collectMetrics(dst map[string]struct{}) {
	n.left.collectMetrics(dst)
	n.right.collectMetrics(dst)
}

type funcNode struct {
	name string
	args []exprNode
}

func foldValues(name string, values []float64) (float64, error) {
	switch name {
	case "min":
		best := values[0]
		for i := 1; i < len(values); i++ {
			if values[i] < best {
				best = values[i]
			}
		}
		return best, nil
	case "max":
		best := values[0]
		for i := 1; i < len(values); i++ {
			if values[i] > best {
				best = values[i]
			}
		}
		return best, nil
	case "sum":
		s := 0.0
		for _, v := range values {
			s += v
		}
		return s, nil
	default:
		return 0, fmt.Errorf("unknown function %q", name)
	}
}

func (n funcNode) eval(inputs map[string]map[int64]float64) (evalValue, error) {
	if len(n.args) == 0 {
		return evalValue{}, fmt.Errorf("function %s requires arguments", n.name)
	}

	values := make([]evalValue, 0, len(n.args))
	var baseTimeline map[int64]float64
	for _, arg := range n.args {
		v, err := arg.eval(inputs)
		if err != nil {
			return evalValue{}, err
		}
		if !v.isScalar() && baseTimeline == nil {
			baseTimeline = v.series
		}
		values = append(values, v)
	}

	if baseTimeline == nil {
		scalars := make([]float64, 0, len(values))
		for _, v := range values {
			scalars = append(scalars, *v.scalar)
		}
		folded, err := foldValues(n.name, scalars)
		if err != nil {
			return evalValue{}, err
		}
		return scalarEvalValue(folded), nil
	}

	out := make(map[int64]float64, len(baseTimeline))
	for t := range baseTimeline {
		row := make([]float64, 0, len(values))
		all := true
		for _, v := range values {
			if v.isScalar() {
				row = append(row, *v.scalar)
				continue
			}
			item, exists := v.series[t]
			if !exists {
				all = false
				break
			}
			row = append(row, item)
		}
		if !all {
			continue
		}
		folded, err := foldValues(n.name, row)
		if err != nil {
			return evalValue{}, err
		}
		out[t] = folded
	}
	return evalValue{series: out}, nil
}

func (n funcNode) collectMetrics(dst map[string]struct{}) {
	for _, arg := range n.args {
		arg.collectMetrics(dst)
	}
}

type exprToken struct {
	kind string
	val  string
	pos  int
	end  int
}

type exprParseError struct {
	Code    string
	Message string
	Token   string
	Pos     int
	End     int
}

func (e *exprParseError) Error() string {
	if e == nil {
		return "invalid expression"
	}
	return e.Message
}

func newExprParseError(code, message string, pos, end int) error {
	return newExprParseErrorWithToken(code, message, "", pos, end)
}

func newExprParseErrorWithToken(code, message, token string, pos, end int) error {
	if pos < 0 {
		pos = 0
	}
	if end < pos {
		end = pos
	}
	return &exprParseError{
		Code:    strings.TrimSpace(code),
		Message: strings.TrimSpace(message),
		Token:   token,
		Pos:     pos,
		End:     end,
	}
}

func isNumericToken(word string) bool {
	if word == "" {
		return false
	}
	hasDigit := false
	for _, r := range word {
		if unicode.IsDigit(r) {
			hasDigit = true
			continue
		}
		if r == '.' || r == 'e' || r == 'E' || r == '+' || r == '-' {
			continue
		}
		return false
	}
	if !hasDigit {
		return false
	}
	_, err := strconv.ParseFloat(word, 64)
	return err == nil
}

func tokenizeExpr(input string) ([]exprToken, error) {
	out := make([]exprToken, 0, len(input)+1)
	runes := []rune(input)
	for i := 0; i < len(runes); {
		r := runes[i]
		if unicode.IsSpace(r) {
			i++
			continue
		}

		switch r {
		case '+', '-', '*', '/', '(', ')', ',':
			out = append(out, exprToken{kind: string(r), val: string(r), pos: i, end: i + 1})
			i++
			continue
		case '[':
			start := i + 1
			tokStart := i
			i++
			for i < len(runes) && runes[i] != ']' {
				i++
			}
			if i >= len(runes) {
				return nil, newExprParseError("missing_closing_bracket", "missing closing ]", tokStart, len(runes))
			}
			name := strings.TrimSpace(string(runes[start:i]))
			if name == "" {
				return nil, newExprParseError("empty_metric_reference", "empty metric reference []", tokStart, i+1)
			}
			out = append(out, exprToken{kind: "metric", val: name, pos: tokStart, end: i + 1})
			i++
			continue
		default:
		}

		if unicode.IsDigit(r) || (r == '.' && i+1 < len(runes) && unicode.IsDigit(runes[i+1])) {
			start := i
			hasDot := false
			hasExp := false
			if r == '.' {
				hasDot = true
			}
			i++
			for i < len(runes) {
				c := runes[i]
				if unicode.IsDigit(c) {
					i++
					continue
				}
				if c == '.' && !hasDot && !hasExp {
					hasDot = true
					i++
					continue
				}
				if (c == 'e' || c == 'E') && !hasExp {
					hasExp = true
					i++
					if i < len(runes) && (runes[i] == '+' || runes[i] == '-') {
						i++
					}
					continue
				}
				break
			}
			word := string(runes[start:i])
			if !isNumericToken(word) {
				return nil, newExprParseError("invalid_number", fmt.Sprintf("invalid number %q", word), start, i)
			}
			out = append(out, exprToken{kind: "number", val: word, pos: start, end: i})
			continue
		}

		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.' || r == ':' {
			start := i
			for i < len(runes) {
				c := runes[i]
				if unicode.IsLetter(c) || unicode.IsDigit(c) || c == '_' || c == '.' || c == ':' {
					i++
					continue
				}
				break
			}
			word := string(runes[start:i])
			out = append(out, exprToken{kind: "ident", val: word, pos: start, end: i})
			continue
		}
		return nil, newExprParseErrorWithToken("unexpected_character", fmt.Sprintf("unexpected character %q", string(r)), string(r), i, i+1)
	}
	out = append(out, exprToken{kind: "eof", pos: len(runes), end: len(runes)})
	return out, nil
}

type exprParser struct {
	tokens []exprToken
	pos    int
}

func parseExpression(input string) (exprNode, error) {
	tokens, err := tokenizeExpr(input)
	if err != nil {
		return nil, err
	}
	p := &exprParser{tokens: tokens}
	node, err := p.parseSum()
	if err != nil {
		return nil, err
	}
	if p.peek().kind != "eof" {
		tok := p.peek()
		return nil, newExprParseErrorWithToken("unexpected_token", fmt.Sprintf("unexpected token %q", tok.val), tok.val, tok.pos, tok.end)
	}
	return node, nil
}

func (p *exprParser) peek() exprToken {
	if p.pos >= len(p.tokens) {
		return exprToken{kind: "eof"}
	}
	return p.tokens[p.pos]
}

func (p *exprParser) take() exprToken {
	tok := p.peek()
	p.pos++
	return tok
}

func (p *exprParser) parseSum() (exprNode, error) {
	left, err := p.parseProduct()
	if err != nil {
		return nil, err
	}
	for {
		tok := p.peek()
		if tok.kind != "+" && tok.kind != "-" {
			break
		}
		p.take()
		right, err := p.parseProduct()
		if err != nil {
			return nil, err
		}
		left = binaryNode{op: tok.kind, left: left, right: right}
	}
	return left, nil
}

func (p *exprParser) parseProduct() (exprNode, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		tok := p.peek()
		if tok.kind != "*" && tok.kind != "/" {
			break
		}
		p.take()
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = binaryNode{op: tok.kind, left: left, right: right}
	}
	return left, nil
}

func (p *exprParser) parseUnary() (exprNode, error) {
	tok := p.peek()
	if tok.kind == "-" {
		p.take()
		child, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return unaryNode{op: "-", child: child}, nil
	}
	if tok.kind == "ident" && strings.EqualFold(tok.val, "log") {
		p.take()
		child, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return unaryNode{op: "log", child: child}, nil
	}
	return p.parsePrimary()
}

func (p *exprParser) parsePrimary() (exprNode, error) {
	tok := p.peek()
	if tok.kind == "(" {
		p.take()
		node, err := p.parseSum()
		if err != nil {
			return nil, err
		}
		if p.peek().kind != ")" {
			tok := p.peek()
			return nil, newExprParseError("missing_closing_parenthesis", "missing closing parenthesis", tok.pos, tok.end)
		}
		p.take()
		return node, nil
	}
	if tok.kind == "number" {
		p.take()
		v, err := strconv.ParseFloat(tok.val, 64)
		if err != nil {
			return nil, newExprParseError("invalid_number", fmt.Sprintf("invalid number %q", tok.val), tok.pos, tok.end)
		}
		return numberNode{value: v}, nil
	}
	if tok.kind == "metric" {
		p.take()
		return metricNode{name: tok.val}, nil
	}
	if tok.kind == "ident" {
		p.take()
		if p.peek().kind == "(" {
			return p.parseFunctionCall(tok.val)
		}
		return metricNode{name: tok.val}, nil
	}
	return nil, newExprParseErrorWithToken("unexpected_token", fmt.Sprintf("unexpected token %q", tok.val), tok.val, tok.pos, tok.end)
}

func (p *exprParser) parseFunctionCall(name string) (exprNode, error) {
	fn := strings.ToLower(strings.TrimSpace(name))
	if fn != "min" && fn != "max" && fn != "sum" {
		tok := p.peek()
		return nil, newExprParseError("unsupported_function", fmt.Sprintf("unsupported function %q", name), tok.pos, tok.end)
	}
	if p.peek().kind != "(" {
		tok := p.peek()
		return nil, newExprParseError("missing_function_opening_parenthesis", "missing function opening parenthesis", tok.pos, tok.end)
	}
	p.take()
	args := make([]exprNode, 0, 4)
	for {
		if p.peek().kind == ")" {
			break
		}
		arg, err := p.parseSum()
		if err != nil {
			return nil, err
		}
		args = append(args, arg)
		if p.peek().kind == "," {
			p.take()
			continue
		}
		break
	}
	if p.peek().kind != ")" {
		tok := p.peek()
		return nil, newExprParseError("missing_closing_parenthesis", fmt.Sprintf("missing closing parenthesis in %s", fn), tok.pos, tok.end)
	}
	p.take()
	if len(args) == 0 {
		tok := p.peek()
		return nil, newExprParseError("function_requires_argument", fmt.Sprintf("%s requires at least one argument", fn), tok.pos, tok.end)
	}
	return funcNode{name: fn, args: args}, nil
}

func metricsInExpression(root exprNode) []string {
	set := map[string]struct{}{}
	root.collectMetrics(set)
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

type tsValue struct {
	t int64
	v float64
}

type evalSample struct {
	avg float64
	min float64
	max float64
}

type metricCursor struct {
	points []tsValue
	index  int
}

func sortedSeriesPoints(series map[int64]evalSample, selector func(evalSample) float64) []tsValue {
	points := make([]tsValue, 0, len(series))
	for t, sample := range series {
		points = append(points, tsValue{t: t, v: selector(sample)})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].t < points[j].t })
	return points
}

func evalNodeAt(
	node exprNode,
	values map[string]float64,
	hasValues map[string]bool,
	minValues map[string]float64,
	maxValues map[string]float64,
) (float64, bool, error) {
	switch n := node.(type) {
	case metricNode:
		v, ok := values[n.name]
		if !ok || !hasValues[n.name] {
			return 0, false, nil
		}
		return v, true, nil
	case numberNode:
		return n.value, true, nil
	case unaryNode:
		child, ok, err := evalNodeAt(n.child, values, hasValues, minValues, maxValues)
		if err != nil || !ok {
			return 0, ok, err
		}
		switch n.op {
		case "-":
			return -child, true, nil
		case "log":
			if child <= 0 {
				return 0, false, nil
			}
			return math.Log10(child), true, nil
		default:
			return 0, false, fmt.Errorf("unknown unary operator %q", n.op)
		}
	case binaryNode:
		left, leftOK, err := evalNodeAt(n.left, values, hasValues, minValues, maxValues)
		if err != nil || !leftOK {
			return 0, leftOK, err
		}
		right, rightOK, err := evalNodeAt(n.right, values, hasValues, minValues, maxValues)
		if err != nil || !rightOK {
			return 0, rightOK, err
		}
		v, ok, err := applyBinary(n.op, left, right)
		return v, ok, err
	case funcNode:
		args := make([]float64, 0, len(n.args))
		useMetricBound := n.name == "min" || n.name == "max"
		for _, arg := range n.args {
			if useMetricBound {
				if metricArg, ok := arg.(metricNode); ok {
					if !hasValues[metricArg.name] {
						return 0, false, nil
					}
					if n.name == "min" {
						v, exists := minValues[metricArg.name]
						if !exists {
							return 0, false, nil
						}
						args = append(args, v)
						continue
					}
					v, exists := maxValues[metricArg.name]
					if !exists {
						return 0, false, nil
					}
					args = append(args, v)
					continue
				}
			}
			v, ok, err := evalNodeAt(arg, values, hasValues, minValues, maxValues)
			if err != nil || !ok {
				return 0, ok, err
			}
			args = append(args, v)
		}
		folded, err := foldValues(n.name, args)
		if err != nil {
			return 0, false, err
		}
		return folded, true, nil
	default:
		return 0, false, fmt.Errorf("unsupported expression node")
	}
}

func evalExpressionWithSamples(root exprNode, inputs map[string]map[int64]evalSample) (map[int64]float64, error) {
	if root == nil {
		return nil, fmt.Errorf("empty expression")
	}
	metrics := metricsInExpression(root)
	if len(metrics) == 0 {
		return map[int64]float64{}, nil
	}

	cursors := make(map[string]*metricCursor, len(metrics))
	minCursors := make(map[string]*metricCursor, len(metrics))
	maxCursors := make(map[string]*metricCursor, len(metrics))
	tsSet := make(map[int64]struct{})
	for _, metric := range metrics {
		series, ok := inputs[metric]
		if !ok {
			return nil, fmt.Errorf("unknown metric %q", metric)
		}
		points := sortedSeriesPoints(series, func(s evalSample) float64 { return s.avg })
		minPoints := sortedSeriesPoints(series, func(s evalSample) float64 { return s.min })
		maxPoints := sortedSeriesPoints(series, func(s evalSample) float64 { return s.max })
		cursors[metric] = &metricCursor{points: points}
		minCursors[metric] = &metricCursor{points: minPoints}
		maxCursors[metric] = &metricCursor{points: maxPoints}
		for _, p := range points {
			tsSet[p.t] = struct{}{}
		}
	}

	timestamps := make([]int64, 0, len(tsSet))
	for ts := range tsSet {
		timestamps = append(timestamps, ts)
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i] < timestamps[j] })
	if len(timestamps) == 0 {
		return map[int64]float64{}, nil
	}

	values := make(map[string]float64, len(metrics))
	minValues := make(map[string]float64, len(metrics))
	maxValues := make(map[string]float64, len(metrics))
	hasValues := make(map[string]bool, len(metrics))
	for _, metric := range metrics {
		hasValues[metric] = false
	}

	out := make(map[int64]float64, len(timestamps))
	for _, ts := range timestamps {
		for _, metric := range metrics {
			cursor := cursors[metric]
			minCursor := minCursors[metric]
			maxCursor := maxCursors[metric]
			hasValues[metric] = false
			if len(cursor.points) == 0 || ts < cursor.points[0].t {
				continue
			}
			for cursor.index < len(cursor.points) && cursor.points[cursor.index].t < ts {
				cursor.index++
				minCursor.index++
				maxCursor.index++
			}
			if cursor.index < len(cursor.points) {
				values[metric] = cursor.points[cursor.index].v
				minValues[metric] = minCursor.points[minCursor.index].v
				maxValues[metric] = maxCursor.points[maxCursor.index].v
				hasValues[metric] = true
			}
		}

		v, ok, err := evalNodeAt(root, values, hasValues, minValues, maxValues)
		if err != nil {
			return nil, err
		}
		if ok {
			out[ts] = v
		}
	}
	return out, nil
}

func evalSampleFromValue(v float64) evalSample {
	return evalSample{
		avg: v,
		min: v,
		max: v,
	}
}

func evalInputFromValueMap(values map[int64]float64) map[int64]evalSample {
	out := make(map[int64]evalSample, len(values))
	for t, v := range values {
		out[t] = evalSampleFromValue(v)
	}
	return out
}

func evalExpression(root exprNode, inputs map[string]map[int64]float64) (map[int64]float64, error) {
	converted := make(map[string]map[int64]evalSample, len(inputs))
	for name, series := range inputs {
		converted[name] = evalInputFromValueMap(series)
	}
	return evalExpressionWithSamples(root, converted)
}

func seriesToEvalInputMap(series apiQuerySeries) map[int64]evalSample {
	out := map[int64]evalSample{}
	if series.Mode == "values" {
		for _, p := range series.Points {
			out[p.T] = evalSampleFromValue(p.V)
		}
		return out
	}
	if series.Mode == "aggregates" {
		for _, p := range series.AggPoints {
			if p.Count == 0 {
				continue
			}
			out[p.T] = evalSample{
				avg: p.Avg,
				min: p.Min,
				max: p.Max,
			}
		}
	}
	return out
}

func valuesToPointSeries(name string, values map[int64]float64, duration float64) apiQuerySeries {
	keys := make([]int64, 0, len(values))
	for t := range values {
		keys = append(keys, t)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	points := make([]apiPoint, 0, len(keys))
	for _, t := range keys {
		v := values[t]
		points = append(points, apiPoint{T: t, V: v})
	}

	return apiQuerySeries{
		Metric:      name,
		Mode:        "values",
		Duration:    duration,
		Points:      points,
		SampleCount: uint64(len(points)),
		Stats: map[string]any{
			"type": "computed",
		},
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
