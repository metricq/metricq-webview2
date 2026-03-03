import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComputedExpression,
  buildQueryTargetsResolved,
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

test("buildQueryTargetsResolved fetches units for local refs when missing", async () => {
  const metrics = [
    { name: "LZR.E00.EIN01.B83.W", unit: "", displayUnit: "", factorMode: "auto", expr: "" },
    { name: "LZR.E00.EIN02.B83.W", unit: "", displayUnit: "", factorMode: "auto", expr: "" },
    {
      name: "PUE",
      expr: "([LZR.E00.EIN01.B83.W]+[LZR.E00.EIN02.B83.W])/[LZR.IT.gesamt.Wirkleistung]",
      unit: "",
      displayUnit: "",
      factorMode: "auto",
    },
  ];
  const units = new Map([
    ["LZR.E00.EIN01.B83.W", "W"],
    ["LZR.E00.EIN02.B83.W", "W"],
    ["LZR.IT.gesamt.Wirkleistung", "kW"],
  ]);
  const out = await buildQueryTargetsResolved(metrics, async (name) => units.get(name) || "");
  const pue = out.find((t) => t.name === "PUE");
  assert.ok(pue?.expr, "expected resolved expression for PUE");
  // Equivalent normalization forms are acceptable:
  // either both local W metrics are scaled to kW, or the kW denominator is scaled to W.
  const scalesNumerator =
    /\(\[LZR\.E00\.EIN01\.B83\.W\]\*0\.001\)/.test(pue.expr) &&
    /\(\[LZR\.E00\.EIN02\.B83\.W\]\*0\.001\)/.test(pue.expr);
  const scalesDenominator = /\(\[LZR\.IT\.gesamt\.Wirkleistung\]\*1000\)/.test(pue.expr);
  assert.equal(scalesNumerator || scalesDenominator, true, `unexpected normalized expression: ${pue.expr}`);
});

test("buildQueryTargetsResolved aligns expression unit with normalized reference scaling", async () => {
  const metrics = [
    { name: "base.power", unit: "W", displayUnit: "", factorMode: "auto", expr: "" },
    { name: "capella.abwaerme", unit: "", displayUnit: "", factorMode: "auto", expr: "[base.power]*0.95" },
  ];
  const out = await buildQueryTargetsResolved(
    metrics,
    async (name) => (name === "base.power" ? "W" : ""),
    async () => ({ minimum: 0, maximum: 2000 }),
  );
  const exprTarget = out.find((t) => t.name === "capella.abwaerme");
  assert.ok(exprTarget?.expr, "expected resolved expression target");
  assert.match(exprTarget.expr, /\(\[base\.power\]\*0\.001\)/);
  assert.equal(metrics[1].unit, "kW");
  assert.equal(metrics[1].displayUnit, "kW");
});

test("buildQueryTargetsResolved prefers inferred normalization over stale local display unit", async () => {
  const metrics = [
    { name: "base.power", unit: "W", displayUnit: "W", factorMode: "auto", expr: "" },
    { name: "capella.abwaerme", unit: "", displayUnit: "", factorMode: "manual", manualFactor: 0.1, expr: "[base.power]*0.95" },
  ];
  const out = await buildQueryTargetsResolved(
    metrics,
    async (name) => (name === "base.power" ? "W" : ""),
    async () => ({ minimum: 0, maximum: 2_000_000 }),
  );
  const exprTarget = out.find((t) => t.name === "capella.abwaerme");
  assert.ok(exprTarget?.expr, "expected resolved expression target");
  assert.match(exprTarget.expr, /\(\[base\.power\]\*0\.001\)/);
  assert.equal(metrics[1].unit, "kW");
  assert.equal(metrics[1].displayUnit, "kW");
});
