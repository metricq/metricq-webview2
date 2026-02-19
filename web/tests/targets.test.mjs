import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComputedExpression,
  buildQueryTargets,
  expressionTokenForMetric,
} from "../js/targets.mjs";

test("expressionTokenForMetric wraps metric names in brackets", () => {
  assert.equal(expressionTokenForMetric("metric.a"), "[metric.a]");
  assert.equal(expressionTokenForMetric(" x "), "[x]");
});

test("buildQueryTargets emits plain metric targets", () => {
  const out = buildQueryTargets([{ name: "metric.a", expr: "" }]);
  assert.deepEqual(out, [{ name: "metric.a", metric: "metric.a" }]);
});

test("buildQueryTargets emits expression targets", () => {
  const out = buildQueryTargets([
    { name: "a", factor: 0.1, expr: "" },
    { name: "b", factor: 2, expr: "" },
    { name: "sum.power", expr: "[a]+[b]" },
  ]);
  assert.deepEqual(out, [{ name: "a", metric: "a" }, { name: "b", metric: "b" }, { name: "sum.power", expr: "([a]*0.1)+([b]*2)" }]);
});

test("buildQueryTargets skips empty names", () => {
  const out = buildQueryTargets([
    { name: "", expr: "[a]+[b]" },
    { name: "ok", expr: "" },
  ]);
  assert.deepEqual(out, [{ name: "ok", metric: "ok" }]);
});

test("buildComputedExpression applies factors per metric reference", () => {
  const text = buildComputedExpression("sum([a], [b], c)", [
    { name: "a", factor: 0.001 },
    { name: "b", factor: 1 },
    { name: "c", factor: 2.5 },
  ]);
  assert.equal(text, "sum(([a]*0.001), [b], ([c]*2.5))");
});
