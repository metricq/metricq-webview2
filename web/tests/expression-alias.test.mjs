import test from "node:test";
import assert from "node:assert/strict";

import { expandExpressionAliases } from "../js/expression-alias.mjs";

const metrics = [
  { name: "metric.power.a", expr: "" },
  { name: "metric.power.b", expr: "" },
  { name: "expr.derived", expr: "[metric.power.a]+[metric.power.b]" },
];

test("maps simple a+b aliases to first base metrics", () => {
  const out = expandExpressionAliases("a+b", metrics);
  assert.equal(out, "[metric.power.a]+[metric.power.b]");
});

test("keeps function names and replaces function args", () => {
  const out = expandExpressionAliases("sum(a,b)-log a", metrics);
  assert.equal(out, "sum([metric.power.a],[metric.power.b])-log [metric.power.a]");
});

test("keeps bracketed metric references untouched", () => {
  const out = expandExpressionAliases("[custom.metric]+a", metrics);
  assert.equal(out, "[custom.metric]+[metric.power.a]");
});

test("does not replace identifiers longer than one char", () => {
  const out = expandExpressionAliases("alpha+beta+a", metrics);
  assert.equal(out, "alpha+beta+[metric.power.a]");
});
