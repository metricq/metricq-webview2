import test from "node:test";
import assert from "node:assert/strict";
import { applyYAxisSettings, serializeYAxisSettings } from "../js/axis-settings.mjs";
import { createYScale, logarithmicTicks, formatLogarithmicTick } from "../js/y-scale.mjs";
import { applyAutoScaling } from "../js/auto-factor.mjs";
import { state } from "../js/model.js";
import { resolveYAxisDomain, resolveLogConstant } from "../js/y-axis.mjs";

test("axis settings survive JSON link round trip and old links restore defaults", () => {
  const settings = { yAxisMode: "manual", yAxisManualMin: -20, yAxisManualMax: 100, yAxisStacked: true, yAxisScale: "symlog", yAxisUnits: { W: 0, V: 3 } };
  const payload = JSON.parse(JSON.stringify(serializeYAxisSettings(settings)));
  const restored = {};
  applyYAxisSettings(restored, payload);
  assert.equal(restored.yAxisScale, "symlog");
  assert.deepEqual(restored.yAxisUnits, { W: 0, V: 3 });
  assert.equal(restored.yAxisManualMin, -20);
  applyYAxisSettings(restored, { m: "global" });
  assert.equal(restored.yAxisScale, "linear");
  assert.deepEqual(restored.yAxisUnits, {});
  assert.equal(restored.yAxisMode, "global");
  applyYAxisSettings(restored, null);
  assert.equal(serializeYAxisSettings(restored), null);
  applyYAxisSettings(restored, { scale: "unknown", units: { W: "3", V: 4, nonsense: 0, A: -6 } });
  assert.deepEqual(restored.yAxisUnits, { A: -6 });
});

test("fixed SI prefixes override near-zero majority and preserve manual factors", () => {
  const metrics = [
    { name: "small1", unit: "W" }, { name: "small2", unit: "W" },
    { name: "large", unit: "kW", factorMode: "manual", manualFactor: 2 },
    { name: "voltage", unit: "V" },
  ];
  const series = new Map(metrics.map((metric, i) => [metric.name, { mode: "values", points: [{ t: 1, v: [1e-6, 1e-7, 0.1, 220][i] }] }]));
  applyAutoScaling(metrics, series, { W: 0, V: -3 });
  assert.deepEqual(metrics.map((m) => m.displayUnit), ["W", "W", "W", "mV"]);
  assert.equal(metrics[2].factor, 2000);
  applyAutoScaling(metrics, series, {});
  assert.notEqual(metrics[0].displayUnit, "W");
});

test("log scale handles zero and negatives, inverts hover values, and is SI invariant", () => {
  const scale = createYScale(-100, 100, true, 1e-7);
  assert.equal(scale.position(0), 0.5);
  for (const value of [-100, -1e-6, 0, 1e-6, 100]) {
    const roundtrip = scale.valueAt(scale.position(value));
    assert.ok(Math.abs(roundtrip - value) < Math.max(1e-15, Math.abs(value) * 1e-12));
  }
  assert.ok(scale.position(1e-6) - scale.position(0) > 0.01);
  const milli = createYScale(-100000, 100000, true, 1e-4);
  assert.ok(Math.abs(milli.position(0.001) - scale.position(1e-6)) < 1e-12);
  const ticks = logarithmicTicks(-100, 100, 600, scale);
  assert.ok(ticks.some((v) => v < 0));
  assert.ok(ticks.some((v) => v > 0));
  assert.ok(ticks.every((v) => Number.isFinite(scale.position(v))));
});

test("logarithmic domain padding preserves small positive values and manual bounds", () => {
  const old = { yAxisScale: state.yAxisScale, yAxisMode: state.yAxisMode, yAxisManualMin: state.yAxisManualMin, yAxisManualMax: state.yAxisManualMax };
  try {
    state.yAxisScale = "symlog";
    state.yAxisMode = "local";
    const list = [{ metric: { factor: 1 }, series: { mode: "values", points: [{ v: 1e-6 }, { v: 100 }] } }];
    const constant = resolveLogConstant(list);
    const domain = resolveYAxisDomain(list, null, constant);
    assert.ok(domain.minY > 0 && domain.minY < 1e-6);
    assert.ok(domain.maxY > 100);
    state.yAxisMode = "manual";
    state.yAxisManualMin = -5;
    state.yAxisManualMax = 50;
    assert.deepEqual(resolveYAxisDomain(list, null, constant), { minY: -5, maxY: 50 });
  } finally { Object.assign(state, old); }
});

test("logarithmic labels stay compact, unique and signed across many decades", () => {
  const values = [-100, -1e-6, -1e-9, 0, 1e-9, 1e-6, 1, 100, 1e7];
  const labels = values.map(formatLogarithmicTick);
  assert.equal(new Set(labels).size, values.length);
  assert.equal(formatLogarithmicTick(1e-6), "10⁻⁶");
  assert.equal(formatLogarithmicTick(-1e-6), "−10⁻⁶");
  assert.equal(formatLogarithmicTick(1e7), "10⁷");
  assert.ok(labels.every((label) => label.length <= 6));
});
