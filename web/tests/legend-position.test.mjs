import test from "node:test";
import assert from "node:assert/strict";
import {
  legendAnchorStyle,
  legendBoxPosition,
  nearestLegendAnchor,
  resolveLegendAnchors,
} from "../js/legend-position.mjs";

test("legend snaps to the 3x3 grid cell under its center", () => {
  const rect = { left: 50, top: 10, width: 300, height: 150 };
  assert.equal(nearestLegendAnchor(60, 20, rect), "top-left");
  assert.equal(nearestLegendAnchor(200, 20, rect), "top");
  assert.equal(nearestLegendAnchor(340, 20, rect), "top-right");
  assert.equal(nearestLegendAnchor(200, 85, rect), "center");
  assert.equal(nearestLegendAnchor(60, 150, rect), "bottom-left");
  assert.equal(nearestLegendAnchor(340, 85, rect), "right");
});

test("default anchors split by axis and never collide", () => {
  assert.deepEqual(resolveLegendAnchors({}, false), ["top-right", "top-right"]);
  assert.deepEqual(resolveLegendAnchors({}, true), ["top-left", "top-right"]);
  const [a, b] = resolveLegendAnchors({ 0: "top-right" }, true);
  assert.equal(a, "top-right");
  assert.notEqual(b, a);
  assert.deepEqual(resolveLegendAnchors({ 0: "bottom", 1: "center" }, true), ["bottom", "center"]);
});

test("anchor style positions relative to the plot area", () => {
  const margin = { left: 52, right: 18, top: 12, bottom: 34 };
  const s = legendAnchorStyle("bottom", margin, 400, 200);
  assert.equal(s.left, "252px");
  assert.equal(s.bottom, "38px");
  assert.equal(s.top, "auto");
  assert.equal(s.transform, "translateX(-50%)");
  assert.equal(legendAnchorStyle("top-right", margin, 400, 200).right, "22px");
});

test("canvas legend box positions mirror the css anchors", () => {
  const margin = { left: 50, right: 20, top: 10, bottom: 30 };
  assert.deepEqual(legendBoxPosition("top-left", margin, 400, 200, 100, 40), { x: 54, y: 14 });
  assert.deepEqual(legendBoxPosition("bottom-right", margin, 400, 200, 100, 40), { x: 346, y: 166 });
  assert.deepEqual(legendBoxPosition("center", margin, 400, 200, 100, 40), { x: 200, y: 90 });
});
