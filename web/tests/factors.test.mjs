import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFactor } from "../js/factors.mjs";

test("sanitizeFactor accepts finite numbers and rejects invalid values", () => {
  assert.equal(sanitizeFactor("2.5"), 2.5);
  assert.equal(sanitizeFactor("-3"), -3);
  assert.equal(sanitizeFactor("abc"), 1);
  assert.equal(sanitizeFactor("0"), 1);
  assert.equal(sanitizeFactor("", 5), 5);
});
