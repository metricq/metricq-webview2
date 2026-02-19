import test from "node:test";
import assert from "node:assert/strict";

import { deriveExpressionUnits } from "../js/expression-units.mjs";

test("propagates compatible additive units to expression metrics", () => {
  const metrics = [
    { name: "a", unit: "W", displayUnit: "W", factorMode: "auto", expr: "" },
    { name: "b", unit: "kW", displayUnit: "kW", factorMode: "auto", expr: "" },
    { name: "sum", unit: "", displayUnit: "", factorMode: "auto", expr: "[a]+[b]" },
  ];

  deriveExpressionUnits(metrics);
  assert.equal(metrics[2].unit, "kW");
  assert.equal(metrics[2].displayUnit, "kW");
});

test("clears unit when expression uses multiplicative operators", () => {
  const metrics = [
    { name: "a", unit: "W", displayUnit: "W", factorMode: "auto", expr: "" },
    { name: "b", unit: "kW", displayUnit: "kW", factorMode: "auto", expr: "" },
    { name: "mul", unit: "W", displayUnit: "W", factorMode: "auto", expr: "[a]*[b]" },
  ];

  deriveExpressionUnits(metrics);
  assert.equal(metrics[2].unit, "");
  assert.equal(metrics[2].displayUnit, "");
});

test("keeps manual expression metric untouched", () => {
  const metrics = [
    { name: "a", unit: "W", displayUnit: "W", factorMode: "auto", expr: "" },
    { name: "manual", unit: "kW", displayUnit: "kW", factorMode: "manual", expr: "a" },
  ];

  deriveExpressionUnits(metrics);
  assert.equal(metrics[1].unit, "kW");
  assert.equal(metrics[1].displayUnit, "kW");
});
