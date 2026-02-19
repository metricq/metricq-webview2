import test from "node:test";
import assert from "node:assert/strict";
import { applyAutoScaling } from "../js/auto-factor.mjs";

function runCase({ metrics, series }) {
  const metricsCopy = metrics.map((m) => ({ ...m }));
  const seriesMap = new Map(series.map((entry) => [entry.name, entry.data]));
  applyAutoScaling(metricsCopy, seriesMap);
  return metricsCopy;
}

function byName(metrics, name) {
  return metrics.find((m) => m.name === name);
}

test("auto-factor case matrix", async (t) => {
  const cases = [
    {
      name: "W + kW settle on kW for kilorange values",
      input: {
        metrics: [
          { name: "w", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "kw", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "w", data: { mode: "values", points: [{ t: 1, v: 2500 }] } },
          { name: "kw", data: { mode: "values", points: [{ t: 1, v: 2.5 }] } },
        ],
      },
      expect: {
        w: { displayUnit: "kW", factor: 0.001 },
        kw: { displayUnit: "kW", factor: 1 },
      },
    },
    {
      name: "W + kW settle on W for small values",
      input: {
        metrics: [
          { name: "w", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "kw", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "w", data: { mode: "values", points: [{ t: 1, v: 5 }] } },
          { name: "kw", data: { mode: "values", points: [{ t: 1, v: 0.005 }] } },
        ],
      },
      expect: {
        w: { displayUnit: "W", factor: 1 },
        kw: { displayUnit: "W", factor: 1000 },
      },
    },
    {
      name: "W + kW + MW settle on MW for very large values",
      input: {
        metrics: [
          { name: "w", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "kw", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
          { name: "mw", unit: "MW", factor: 1, factorMode: "auto", displayUnit: "MW" },
        ],
        series: [
          { name: "w", data: { mode: "values", points: [{ t: 1, v: 4_000_000 }] } },
          { name: "kw", data: { mode: "values", points: [{ t: 1, v: 4000 }] } },
          { name: "mw", data: { mode: "values", points: [{ t: 1, v: 4 }] } },
        ],
      },
      expect: {
        w: { displayUnit: "MW", factor: 0.000001 },
        kw: { displayUnit: "MW", factor: 0.001 },
        mw: { displayUnit: "MW", factor: 1 },
      },
    },
    {
      name: "W + kW around 40 kW should prefer kW, not MW",
      input: {
        metrics: [
          { name: "w", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "kw", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "w", data: { mode: "values", points: [{ t: 1, v: 40_000 }] } },
          { name: "kw", data: { mode: "values", points: [{ t: 1, v: 40 }] } },
        ],
      },
      expect: {
        w: { displayUnit: "kW", factor: 0.001 },
        kw: { displayUnit: "kW", factor: 1 },
      },
    },
    {
      name: "Wh + kWh settle on kWh",
      input: {
        metrics: [
          { name: "wh", unit: "Wh", factor: 1, factorMode: "auto", displayUnit: "Wh" },
          { name: "kwh", unit: "kWh", factor: 1, factorMode: "auto", displayUnit: "kWh" },
        ],
        series: [
          { name: "wh", data: { mode: "values", points: [{ t: 1, v: 5000 }] } },
          { name: "kwh", data: { mode: "values", points: [{ t: 1, v: 5 }] } },
        ],
      },
      expect: {
        wh: { displayUnit: "kWh", factor: 0.001 },
        kwh: { displayUnit: "kWh", factor: 1 },
      },
    },
    {
      name: "mV + V + kV settle on V",
      input: {
        metrics: [
          { name: "mv", unit: "mV", factor: 1, factorMode: "auto", displayUnit: "mV" },
          { name: "v", unit: "V", factor: 1, factorMode: "auto", displayUnit: "V" },
          { name: "kv", unit: "kV", factor: 1, factorMode: "auto", displayUnit: "kV" },
        ],
        series: [
          { name: "mv", data: { mode: "values", points: [{ t: 1, v: 3200 }] } },
          { name: "v", data: { mode: "values", points: [{ t: 1, v: 3.2 }] } },
          { name: "kv", data: { mode: "values", points: [{ t: 1, v: 0.0032 }] } },
        ],
      },
      expect: {
        mv: { displayUnit: "V", factor: 0.001 },
        v: { displayUnit: "V", factor: 1 },
        kv: { displayUnit: "V", factor: 1000 },
      },
    },
    {
      name: "aggregate mode is considered (avg values)",
      input: {
        metrics: [
          { name: "a", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "b", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "a", data: { mode: "aggregates", aggregatePoints: [{ t: 1, avg: 3000 }] } },
          { name: "b", data: { mode: "aggregates", aggregatePoints: [{ t: 1, avg: 3 }] } },
        ],
      },
      expect: {
        a: { displayUnit: "kW", factor: 0.001 },
        b: { displayUnit: "kW", factor: 1 },
      },
    },
    {
      name: "manual factor is applied on top of normalization",
      input: {
        metrics: [
          { name: "manual", unit: "W", factor: 1, manualFactor: 42, factorMode: "manual", displayUnit: "W" },
          { name: "auto", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "manual", data: { mode: "values", points: [{ t: 1, v: 4200 }] } },
          { name: "auto", data: { mode: "values", points: [{ t: 1, v: 4.2 }] } },
        ],
      },
      expect: {
        manual: { displayUnit: "kW", factor: 0.042, manualFactor: 42 },
        auto: { displayUnit: "kW", factor: 1 },
      },
    },
    {
      name: "unknown units stay untouched",
      input: {
        metrics: [
          { name: "x", unit: "°C", factor: 7, factorMode: "auto", displayUnit: "°C" },
          { name: "y", unit: "%", factor: 3, factorMode: "auto", displayUnit: "%" },
        ],
        series: [
          { name: "x", data: { mode: "values", points: [{ t: 1, v: 20 }] } },
          { name: "y", data: { mode: "values", points: [{ t: 1, v: 55 }] } },
        ],
      },
      expect: {
        x: { displayUnit: "°C", factor: 1 },
        y: { displayUnit: "%", factor: 1 },
      },
    },
    {
      name: "same unit family, missing series still converges to available",
      input: {
        metrics: [
          { name: "has", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
          { name: "missing", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
        ],
        series: [
          { name: "has", data: { mode: "values", points: [{ t: 1, v: 2 }] } },
        ],
      },
      expect: {
        has: { displayUnit: "kW", factor: 1 },
        missing: { displayUnit: "kW", factor: 0.001 },
      },
    },
    {
      name: "zero-only series falls back to exponent average and prefers larger prefix on ties",
      input: {
        metrics: [
          { name: "w", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "kw", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "w", data: { mode: "values", points: [{ t: 1, v: 0 }] } },
          { name: "kw", data: { mode: "values", points: [{ t: 1, v: 0 }] } },
        ],
      },
      expect: {
        w: { displayUnit: "kW", factor: 0.001 },
        kw: { displayUnit: "kW", factor: 1 },
      },
    },
    {
      name: "different SI families are handled independently (W and V)",
      input: {
        metrics: [
          { name: "power", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
          { name: "power2", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
          { name: "volt", unit: "mV", factor: 1, factorMode: "auto", displayUnit: "mV" },
          { name: "volt2", unit: "V", factor: 1, factorMode: "auto", displayUnit: "V" },
        ],
        series: [
          { name: "power", data: { mode: "values", points: [{ t: 1, v: 2000 }] } },
          { name: "power2", data: { mode: "values", points: [{ t: 1, v: 2 }] } },
          { name: "volt", data: { mode: "values", points: [{ t: 1, v: 5000 }] } },
          { name: "volt2", data: { mode: "values", points: [{ t: 1, v: 5 }] } },
        ],
      },
      expect: {
        power: { displayUnit: "kW", factor: 0.001 },
        power2: { displayUnit: "kW", factor: 1 },
        volt: { displayUnit: "V", factor: 0.001 },
        volt2: { displayUnit: "V", factor: 1 },
      },
    },
    {
      name: "voltage units with suffixes are normalized and scaled to readable prefix",
      input: {
        metrics: [
          { name: "v1", unit: "Veff", factor: 1, factorMode: "auto", displayUnit: "Veff" },
          { name: "v2", unit: "V", factor: 1, factorMode: "auto", displayUnit: "V" },
          { name: "p1", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
        ],
        series: [
          { name: "v1", data: { mode: "values", points: [{ t: 1, v: 12000 }] } },
          { name: "v2", data: { mode: "values", points: [{ t: 1, v: 230 }] } },
          { name: "p1", data: { mode: "values", points: [{ t: 1, v: 200 }] } },
        ],
      },
      expect: {
        v1: { displayUnit: "kV", factor: 0.001 },
        v2: { displayUnit: "kV", factor: 0.001 },
        p1: { displayUnit: "kW", factor: 1 },
      },
    },
    {
      name: "no metrics: no crash",
      input: {
        metrics: [],
        series: [],
      },
      expect: {},
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const out = runCase(testCase.input);
      for (const [metricName, exp] of Object.entries(testCase.expect)) {
        const metric = byName(out, metricName);
        assert.ok(metric, `metric '${metricName}' should exist`);
        assert.equal(metric.displayUnit, exp.displayUnit, `${metricName} displayUnit`);
        assert.equal(metric.factor, exp.factor, `${metricName} factor`);
        if (Object.prototype.hasOwnProperty.call(exp, "manualFactor")) {
          assert.equal(metric.manualFactor, exp.manualFactor, `${metricName} manualFactor`);
        }
      }
    });
  }
});
