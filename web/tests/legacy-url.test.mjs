import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLegacyChartsUrl,
  collectLegacyCompatibleMetrics,
  stringifyJsUrl,
} from "../js/legacy-url.mjs";

test("stringifyJsUrl serializes the legacy chart payload shape", () => {
  const out = stringifyJsUrl({
    cntr: ["metric.a", "metric b"],
    start: 1,
    stop: 2,
    type: "default",
  });
  assert.equal(
    out,
    "~(cntr~(~'metric.a~'metric*20b)~start~1~stop~2~type~'default)",
  );
});

test("collectLegacyCompatibleMetrics keeps only visible raw metrics", () => {
  const out = collectLegacyCompatibleMetrics([
    { name: "metric.a", draw: true, expr: "" },
    { name: "expr.sum", draw: true, expr: "[a]+[b]" },
    { name: "metric.hidden", draw: false, expr: "" },
    { name: " metric.b ", draw: true, expr: "" },
  ]);
  assert.deepEqual(out, ["metric.a", "metric.b"]);
});

test("buildLegacyChartsUrl resolves base URL and writes legacy hash", () => {
  const out = buildLegacyChartsUrl(
    "/legacy/charts/content/index.html",
    {
      metrics: [{ name: "metric.a", draw: true, expr: "" }],
      from: 1000,
      to: 2000,
    },
    "https://example.invalid/webview/",
  );
  assert.equal(
    out,
    "https://example.invalid/legacy/charts/content/index.html#~(cntr~(~'metric.a)~start~1000~stop~2000~type~'default)-",
  );
});

test("buildLegacyChartsUrl returns null without compatible metrics", () => {
  const out = buildLegacyChartsUrl("https://legacy.example/charts/", {
    metrics: [{ name: "expr.only", draw: true, expr: "[a]+[b]" }],
    from: 1000,
    to: 2000,
  });
  assert.equal(out, null);
});
