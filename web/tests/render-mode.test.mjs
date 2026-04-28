import test from "node:test";
import assert from "node:assert/strict";
import { metricShownUnit, normalizeMetricRenderMode, state } from "../js/model.js";

test("normalizeMetricRenderMode keeps supported render modes", () => {
  assert.equal(normalizeMetricRenderMode("bands"), "bands");
  assert.equal(normalizeMetricRenderMode("line"), "line");
  assert.equal(normalizeMetricRenderMode("count"), "count");
});

test("normalizeMetricRenderMode falls back to bands", () => {
  assert.equal(normalizeMetricRenderMode(""), "bands");
  assert.equal(normalizeMetricRenderMode("BANDS"), "bands");
  assert.equal(normalizeMetricRenderMode("invalid"), "bands");
  assert.equal(normalizeMetricRenderMode(null), "bands");
});

test("metricShownUnit uses per-second unit in count mode", () => {
  const previous = state.metricRenderMode;
  state.metricRenderMode = "count";
  assert.equal(metricShownUnit({ unit: "kW", displayUnit: "kW" }), "#/s");
  state.metricRenderMode = previous;
});
