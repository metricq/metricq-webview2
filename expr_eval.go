package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"
)

type exprNode interface {
	eval(inputs map[string]map[int64]float64) (map[int64]float64, error)
	collectMetrics(dst map[string]struct{})
}

type metricNode struct {
	name string
}

func (n metricNode) eval(inputs map[string]map[int64]float64) (map[int64]float64, error) {
	series, ok := inputs[n.name]
	if !ok {
		return nil, fmt.Errorf("unknown metric %q", n.name)
	}
	out := make(map[int64]float64, len(series))
	for t, v := range series {
		out[t] = v
	}
	return out, nil
}

func (n metricNode) collectMetrics(dst map[string]struct{}) {
	dst[n.name] = struct{}{}
}

type unaryNode struct {
	op    string
	child exprNode
}

func (n unaryNode) eval(inputs map[string]map[int64]float64) (map[int64]float64, error) {
	child, err := n.child.eval(inputs)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]float64, len(child))
	for t, v := range child {
		switch n.op {
		case "-":
			out[t] = -v
		case "log":
			if v > 0 {
				out[t] = math.Log10(v)
			}
		default:
			return nil, fmt.Errorf("unknown unary operator %q", n.op)
		}
	}
	return out, nil
}

func (n unaryNode) collectMetrics(dst map[string]struct{}) {
	n.child.collectMetrics(dst)
}

type binaryNode struct {
	op          string
	left, right exprNode
}

func (n binaryNode) eval(inputs map[string]map[int64]float64) (map[int64]float64, error) {
	left, err := n.left.eval(inputs)
	if err != nil {
		return nil, err
	}
	right, err := n.right.eval(inputs)
	if err != nil {
		return nil, err
	}
	if len(left) == 0 || len(right) == 0 {
		return map[int64]float64{}, nil
	}

	out := make(map[int64]float64, minInt(len(left), len(right)))
	for t, lv := range left {
		rv, ok := right[t]
		if !ok {
			continue
		}
		switch n.op {
		case "+":
			out[t] = lv + rv
		case "-":
			out[t] = lv - rv
		case "*":
			out[t] = lv * rv
		case "/":
			if rv != 0 {
				out[t] = lv / rv
			}
		default:
			return nil, fmt.Errorf("unknown binary operator %q", n.op)
		}
	}
	return out, nil
}

func (n binaryNode) collectMetrics(dst map[string]struct{}) {
	n.left.collectMetrics(dst)
	n.right.collectMetrics(dst)
}

type funcNode struct {
	name string
	args []exprNode
}

func (n funcNode) eval(inputs map[string]map[int64]float64) (map[int64]float64, error) {
	if len(n.args) == 0 {
		return nil, fmt.Errorf("function %s requires arguments", n.name)
	}
	series := make([]map[int64]float64, 0, len(n.args))
	for _, arg := range n.args {
		v, err := arg.eval(inputs)
		if err != nil {
			return nil, err
		}
		series = append(series, v)
	}

	base := series[0]
	if len(base) == 0 {
		return map[int64]float64{}, nil
	}
	out := make(map[int64]float64, len(base))

	for t, first := range base {
		values := make([]float64, 0, len(series))
		values = append(values, first)
		all := true
		for i := 1; i < len(series); i++ {
			v, exists := series[i][t]
			if !exists {
				all = false
				break
			}
			values = append(values, v)
		}
		if !all {
			continue
		}

		switch n.name {
		case "min":
			best := values[0]
			for i := 1; i < len(values); i++ {
				if values[i] < best {
					best = values[i]
				}
			}
			out[t] = best
		case "max":
			best := values[0]
			for i := 1; i < len(values); i++ {
				if values[i] > best {
					best = values[i]
				}
			}
			out[t] = best
		case "sum":
			sum := 0.0
			for _, v := range values {
				sum += v
			}
			out[t] = sum
		default:
			return nil, fmt.Errorf("unknown function %q", n.name)
		}
	}
	return out, nil
}

func (n funcNode) collectMetrics(dst map[string]struct{}) {
	for _, arg := range n.args {
		arg.collectMetrics(dst)
	}
}

type exprToken struct {
	kind string
	val  string
}

func tokenizeExpr(input string) ([]exprToken, error) {
	out := make([]exprToken, 0, len(input)+1)
	runes := []rune(strings.TrimSpace(input))
	for i := 0; i < len(runes); {
		r := runes[i]
		if unicode.IsSpace(r) {
			i++
			continue
		}

		switch r {
		case '+', '-', '*', '/', '(', ')', ',':
			out = append(out, exprToken{kind: string(r), val: string(r)})
			i++
			continue
		case '[':
			start := i + 1
			i++
			for i < len(runes) && runes[i] != ']' {
				i++
			}
			if i >= len(runes) {
				return nil, fmt.Errorf("missing closing ]")
			}
			name := strings.TrimSpace(string(runes[start:i]))
			if name == "" {
				return nil, fmt.Errorf("empty metric reference []")
			}
			out = append(out, exprToken{kind: "metric", val: name})
			i++
			continue
		default:
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
			out = append(out, exprToken{kind: "ident", val: word})
			continue
		}
		return nil, fmt.Errorf("unexpected character %q", string(r))
	}
	out = append(out, exprToken{kind: "eof"})
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
		return nil, fmt.Errorf("unexpected token %q", p.peek().val)
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
			return nil, fmt.Errorf("missing closing parenthesis")
		}
		p.take()
		return node, nil
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
	return nil, fmt.Errorf("unexpected token %q", tok.val)
}

func (p *exprParser) parseFunctionCall(name string) (exprNode, error) {
	fn := strings.ToLower(strings.TrimSpace(name))
	if fn != "min" && fn != "max" && fn != "sum" {
		return nil, fmt.Errorf("unsupported function %q", name)
	}
	if p.peek().kind != "(" {
		return nil, fmt.Errorf("missing function opening parenthesis")
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
		return nil, fmt.Errorf("missing closing parenthesis in %s", fn)
	}
	p.take()
	if len(args) == 0 {
		return nil, fmt.Errorf("%s requires at least one argument", fn)
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

func evalExpression(root exprNode, inputs map[string]map[int64]float64) (map[int64]float64, error) {
	if root == nil {
		return nil, fmt.Errorf("empty expression")
	}
	return root.eval(inputs)
}

func seriesToValueMap(series apiQuerySeries) map[int64]float64 {
	out := map[int64]float64{}
	if series.Mode == "values" {
		for _, p := range series.Points {
			out[p.T] = p.V
		}
		return out
	}
	if series.Mode == "aggregates" {
		for _, p := range series.AggPoints {
			out[p.T] = p.Avg
		}
	}
	return out
}

func valuesToAggregateSeries(name string, values map[int64]float64, duration float64) apiQuerySeries {
	keys := make([]int64, 0, len(values))
	for t := range values {
		keys = append(keys, t)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	points := make([]apiAggPoint, 0, len(keys))
	for _, t := range keys {
		v := values[t]
		points = append(points, apiAggPoint{T: t, Min: v, Max: v, Avg: v, Count: 1})
	}

	return apiQuerySeries{
		Metric:     name,
		Mode:       "aggregates",
		Duration:   duration,
		AggPoints:  points,
		PointCount: len(points),
		RawCount:   float64(len(points)),
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
