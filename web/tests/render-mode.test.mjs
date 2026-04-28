import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetricRenderMode } from "../js/model.js";

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
