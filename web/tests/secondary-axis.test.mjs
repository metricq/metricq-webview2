import test from "node:test";
import assert from "node:assert/strict";
import { metricAxis, secondaryAxisActive, state } from "../js/model.js";

test("secondary axis only opens when both axes have visible metrics", () => {
  state.metrics = [
    { name: "a", draw: true, axis: 0 },
    { name: "b", draw: true, axis: 1 },
  ];
  assert.equal(secondaryAxisActive(), true);
  assert.equal(metricAxis(state.metrics[0]), 0);
  assert.equal(metricAxis(state.metrics[1]), 1);

  state.metrics[0].draw = false;
  assert.equal(secondaryAxisActive(), false);
  assert.equal(metricAxis(state.metrics[1]), 0);
});
