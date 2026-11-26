// Legend placement on a 3x3 grid over the plot area ("top-left", "top",
// "top-right", "left", "center", "right", "bottom-left", "bottom",
// "bottom-right"). Pure helpers; DOM wiring lives in collapsed-legend.js.

export const LEGEND_ANCHORS = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
];

const FALLBACK_ORDER = ["top-right", "top-left", "bottom-right", "bottom-left"];

export function isLegendAnchor(value) {
  return LEGEND_ANCHORS.includes(value);
}

function parts(anchor) {
  const v = anchor.startsWith("top") ? "top" : anchor.startsWith("bottom") ? "bottom" : "middle";
  const h = anchor.endsWith("left") ? "left" : anchor.endsWith("right") ? "right" : "center";
  return { v, h };
}

export function defaultLegendAnchor(axis, hasSecondary) {
  if (axis === 1) return "top-right";
  return hasSecondary ? "top-left" : "top-right";
}

// overrides: { 0: anchor|null, 1: anchor|null } chosen by the user.
export function resolveLegendAnchors(overrides, hasSecondary) {
  const pick = (axis) =>
    isLegendAnchor(overrides?.[axis]) ? overrides[axis] : defaultLegendAnchor(axis, hasSecondary);
  const first = pick(0);
  let second = pick(1);
  if (hasSecondary && second === first) {
    second = FALLBACK_ORDER.find((candidate) => candidate !== first) || second;
  }
  return [first, second];
}

// Inline CSS (px values / strings) placing a legend in the plot area.
export function legendAnchorStyle(anchor, margin, plotW, plotH, inset = 4) {
  const { v, h } = parts(anchor);
  const style = { left: "auto", right: "auto", top: "auto", bottom: "auto" };
  const transforms = [];
  if (h === "left") style.left = `${margin.left + inset}px`;
  else if (h === "right") style.right = `${margin.right + inset}px`;
  else {
    style.left = `${margin.left + plotW / 2}px`;
    transforms.push("translateX(-50%)");
  }
  if (v === "top") style.top = `${margin.top + inset}px`;
  else if (v === "bottom") style.bottom = `${margin.bottom + inset}px`;
  else {
    style.top = `${margin.top + plotH / 2}px`;
    transforms.push("translateY(-50%)");
  }
  style.transform = transforms.join(" ") || "none";
  return style;
}

// Top-left corner of a legend box of size (boxW, boxH) for the given anchor,
// in canvas coordinates; mirrors legendAnchorStyle for canvas drawing.
export function legendBoxPosition(anchor, margin, plotW, plotH, boxW, boxH, inset = 4) {
  const { v, h } = parts(anchor);
  const x = h === "left"
    ? margin.left + inset
    : h === "right"
      ? margin.left + plotW - inset - boxW
      : margin.left + (plotW - boxW) / 2;
  const y = v === "top"
    ? margin.top + inset
    : v === "bottom"
      ? margin.top + plotH - inset - boxH
      : margin.top + (plotH - boxH) / 2;
  return { x, y };
}

// Cell of the 3x3 grid containing (x, y); rect is relative to the same origin.
export function nearestLegendAnchor(x, y, rect) {
  const rel = (value, start, size) => (size > 0 ? (value - start) / size : 0.5);
  const fx = rel(x, rect.left, rect.width);
  const fy = rel(y, rect.top, rect.height);
  const col = fx < 1 / 3 ? 0 : fx > 2 / 3 ? 2 : 1;
  const row = fy < 1 / 3 ? 0 : fy > 2 / 3 ? 2 : 1;
  return LEGEND_ANCHORS[row * 3 + col];
}
