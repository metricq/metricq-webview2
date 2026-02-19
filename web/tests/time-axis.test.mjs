import test from "node:test";
import assert from "node:assert/strict";
import { buildXTicks, formatAbsoluteTime, formatAxisTime, pickTimeTickStep } from "../js/time-axis.mjs";

test("formatAbsoluteTime renders stable millisecond format", () => {
  const ts = new Date(2026, 1, 18, 12, 34, 56, 789).getTime();
  assert.equal(formatAbsoluteTime(ts), "2026-02-18 12:34:56.789");
});

test("formatAxisTime uses milliseconds for very small tick steps", () => {
  const ts = new Date(2026, 1, 18, 12, 0, 1, 9).getTime();
  assert.equal(formatAxisTime(ts, 30_000, 10), "12:00:01.009");
});

test("formatAxisTime uses HH:mm:ss for second-level tick steps", () => {
  const ts = new Date(2026, 1, 18, 7, 8, 9, 123).getTime();
  assert.equal(formatAxisTime(ts, 300_000, 1000), "07:08:09");
});

test("pickTimeTickStep picks increasing steps with larger ranges", () => {
  const stepSmall = pickTimeTickStep(1_000, 10);
  const stepLarge = pickTimeTickStep(60_000, 10);
  assert.ok(stepLarge >= stepSmall);
});

test("buildXTicks aligns to step and stays inside range", () => {
  const ticks = buildXTicks(1050, 3200, 500);
  assert.deepEqual(ticks, [1500, 2000, 2500, 3000]);
});
