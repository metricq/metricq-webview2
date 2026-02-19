import test from "node:test";
import assert from "node:assert/strict";

import { buildQueryTargets, expressionTokenForMetric } from "../js/targets.mjs";

test("expressionTokenForMetric wraps metric names in brackets", () => {
  assert.equal(expressionTokenForMetric("metric.a"), "[metric.a]");
  assert.equal(expressionTokenForMetric(" x "), "[x]");
});

test("buildQueryTargets emits plain metric targets", () => {
  const out = buildQueryTargets([{ name: "metric.a", expr: "" }]);
  assert.deepEqual(out, [{ name: "metric.a", metric: "metric.a" }]);
});

test("buildQueryTargets emits expression targets", () => {
  const out = buildQueryTargets([{ name: "sum.power", expr: "[a]+[b]" }]);
  assert.deepEqual(out, [{ name: "sum.power", expr: "[a]+[b]" }]);
});

test("buildQueryTargets skips empty names", () => {
  const out = buildQueryTargets([
    { name: "", expr: "[a]+[b]" },
    { name: "ok", expr: "" },
  ]);
  assert.deepEqual(out, [{ name: "ok", metric: "ok" }]);
});
