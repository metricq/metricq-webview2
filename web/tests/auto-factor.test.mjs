import test from "node:test";
import assert from "node:assert/strict";
import { applyAutoScaling } from "../js/auto-factor.mjs";

test("applyAutoScaling aligns W and kW to a shared readable SI unit", () => {
  const metrics = [
    { name: "a", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
    { name: "b", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
  ];
  const series = new Map([
    ["a", { mode: "values", points: [{ t: 1, v: 1400 }, { t: 2, v: 2200 }] }],
    ["b", { mode: "values", points: [{ t: 1, v: 1.4 }, { t: 2, v: 2.2 }] }],
  ]);

  applyAutoScaling(metrics, series);

  assert.equal(metrics[0].displayUnit, "kW");
  assert.equal(metrics[1].displayUnit, "kW");
  assert.equal(metrics[0].factor, 0.001);
  assert.equal(metrics[1].factor, 1);
});

test("applyAutoScaling does not override manual factors", () => {
  const metrics = [
    { name: "a", unit: "W", factor: 1, manualFactor: 2, factorMode: "manual", displayUnit: "W" },
    { name: "b", unit: "kW", factor: 1, factorMode: "auto", displayUnit: "kW" },
  ];
  const series = new Map([
    ["a", { mode: "values", points: [{ t: 1, v: 500 }] }],
    ["b", { mode: "values", points: [{ t: 1, v: 2 }] }],
  ]);

  applyAutoScaling(metrics, series);

  assert.equal(metrics[0].manualFactor, 2);
  assert.equal(metrics[0].factor, 0.002);
  assert.equal(metrics[0].displayUnit, "kW");
  assert.equal(metrics[1].displayUnit, "kW");
  assert.equal(metrics[1].factor, 1);
});

test("applyAutoScaling scales single auto metric to a readable unit", () => {
  const metrics = [
    { name: "only", unit: "W", factor: 1, factorMode: "auto", displayUnit: "W" },
  ];
  const series = new Map([
    ["only", { mode: "values", points: [{ t: 1, v: 4_000_000 }] }],
  ]);

  applyAutoScaling(metrics, series);

  assert.equal(metrics[0].displayUnit, "MW");
  assert.equal(metrics[0].factor, 0.000001);
});
