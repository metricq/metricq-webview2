import { AXIS_COLORS } from "./axis-colors.mjs";
import { dom } from "./dom.js";
import {
  isLegendAnchor,
  legendAnchorStyle,
  LEGEND_ANCHORS,
  nearestLegendAnchor,
  resolveLegendAnchors,
} from "./legend-position.mjs";
import { shownMetricFactor } from "./factor-format.mjs";
import {
  metricAxis,
  metricDisplayName,
  metricRenderShowsCounts,
  metricShownUnit,
  secondaryAxisActive,
  state,
  yAxisStackingActive,
} from "./model.js";

function truncateMiddle(text, maxLen) {
  const raw = String(text || "");
  if (raw.length <= maxLen) return raw;
  const keep = Math.max(8, Math.floor((maxLen - 1) / 2));
  return `${raw.slice(0, keep)}…${raw.slice(raw.length - keep)}`;
}

function buildLegendRow(metric, { forceNormalIndicator = false } = {}) {
  const row = document.createElement("div");
  row.className = "collapsed-legend-item";

  const indicator = document.createElement("span");
  if (!forceNormalIndicator && metric.stackMode !== "normal") {
    indicator.className = "collapsed-legend-icon";
    indicator.style.color = metric.color;
    indicator.innerHTML = '<i class="bi bi-layers-fill" aria-hidden="true"></i>';
  } else {
    indicator.className = "collapsed-legend-color";
    indicator.style.background = metric.color;
  }

  const labelWrap = document.createElement("div");
  labelWrap.className = "collapsed-legend-label";
  const label = document.createElement("div");
  label.className = "collapsed-legend-main";
  const unit = metricShownUnit(metric);
  const factor = metricRenderShowsCounts() ? "" : shownMetricFactor(metric);
  const formulaPrefix = metric.expr ? "ƒ " : "";
  label.textContent = formulaPrefix + metricDisplayName(metric) + (unit ? ` [${unit}]` : "") + (factor ? ` x${factor}` : "");
  labelWrap.appendChild(label);

  const description = String(metric.description || "").trim();
  if (description) {
    const desc = document.createElement("div");
    desc.className = "collapsed-legend-desc";
    desc.textContent = truncateMiddle(description, 84);
    desc.title = description;
    labelWrap.appendChild(desc);
  }

  row.append(indicator, labelWrap);
  return row;
}

function buildSectionHeader({ stacked = false, frequency = false, count = 0 } = {}) {
  const header = document.createElement("div");
  header.className = `collapsed-legend-section-header${stacked ? " is-stacked" : ""}${frequency ? " is-frequency" : ""}`;

  const icon = document.createElement("span");
  icon.className = `collapsed-legend-section-header-icon${stacked ? " is-stacked" : ""}${frequency ? " is-frequency" : ""}`;
  icon.innerHTML = stacked
    ? '<i class="bi bi-layers-fill" aria-hidden="true"></i>'
    : frequency
      ? '<i class="bi bi-activity" aria-hidden="true"></i>'
      : '<i class="bi bi-dash-lg" aria-hidden="true"></i>';

  const text = document.createElement("span");
  text.className = "collapsed-legend-section-header-text";
  text.textContent = stacked
    ? `Gestapelt (${count})`
    : frequency
      ? `Frequenz (${count})`
      : "Nicht gestapelt";

  header.append(icon, text);
  return header;
}

function appendLegendSection(
  host,
  metrics,
  {
    stacked = false,
    forceNormalIndicator = false,
    showHeader = true,
    frequency = false,
    headerCount = metrics.length,
  } = {},
) {
  const section = document.createElement("section");
  section.className = `collapsed-legend-section${stacked ? " is-stacked" : ""}${frequency ? " is-frequency" : ""}`;
  if (showHeader) {
    section.appendChild(buildSectionHeader({
      stacked,
      frequency,
      count: headerCount,
    }));
  }
  for (const metric of metrics) {
    section.appendChild(buildLegendRow(metric, { forceNormalIndicator }));
  }
  host.appendChild(section);
  return section;
}

// Bootstrap's md breakpoint (768px) — "sm or below" is everything under it.
// Below that width the legend has nowhere to sit that doesn't just cover
// the chart, so it's not worth rendering at all.
export const LEGEND_MIN_VIEWPORT_PX = 768;

const ANCHOR_STORAGE_KEY = "metricq.legendAnchors";
let anchorOverrides = loadAnchorOverrides();
let lastLayout = null;
let snapOverlay = null;

function loadAnchorOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(ANCHOR_STORAGE_KEY) || "{}");
    return {
      0: isLegendAnchor(raw?.[0]) ? raw[0] : null,
      1: isLegendAnchor(raw?.[1]) ? raw[1] : null,
    };
  } catch (_) {
    return { 0: null, 1: null };
  }
}

function saveAnchorOverrides() {
  try {
    localStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(anchorOverrides));
  } catch (_) {}
}

function legendHosts() {
  return [dom.collapsedLegend, dom.collapsedLegendSecondary];
}

// Called by the chart on every render with the current plot geometry.
export function layoutCollapsedLegends(layout) {
  lastLayout = layout;
  if (!layout || !dom.collapsedLegend) return;
  const { margin, plotW, plotH, hasSecondary } = layout;
  const anchors = resolveLegendAnchors(anchorOverrides, hasSecondary);
  const maxWidth = `${Math.max(180, Math.min(360, Math.floor(plotW * (hasSecondary ? 0.3 : 0.34))))}px`;
  legendHosts().forEach((host, axis) => {
    if (!host) return;
    Object.assign(host.style, legendAnchorStyle(anchors[axis], margin, plotW, plotH), { maxWidth });
  });
}

function showSnapOverlay(wrap, layout) {
  hideSnapOverlay();
  const { margin, plotW, plotH } = layout;
  snapOverlay = document.createElement("div");
  snapOverlay.className = "legend-snap-overlay";
  Object.assign(snapOverlay.style, {
    left: `${margin.left}px`,
    top: `${margin.top}px`,
    width: `${plotW}px`,
    height: `${plotH}px`,
  });
  for (const anchor of LEGEND_ANCHORS) {
    const cell = document.createElement("div");
    cell.className = "legend-snap-cell";
    cell.dataset.anchor = anchor;
    snapOverlay.appendChild(cell);
  }
  wrap.appendChild(snapOverlay);
}

function highlightSnapAnchor(anchor) {
  if (!snapOverlay) return;
  for (const cell of snapOverlay.children) {
    cell.classList.toggle("is-active", cell.dataset.anchor === anchor);
  }
}

function hideSnapOverlay() {
  snapOverlay?.remove();
  snapOverlay = null;
}

function wireLegendDrag(host, axis) {
  host.addEventListener("pointerdown", (event) => {
    const grip = event.target.closest(".collapsed-legend-grip");
    if (!grip || !lastLayout || event.button > 0) return;
    event.preventDefault();
    const wrap = host.offsetParent || host.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const offsetX = event.clientX - hostRect.left;
    const offsetY = event.clientY - hostRect.top;
    const { margin, plotW, plotH, hasSecondary } = lastLayout;
    const plotRect = { left: margin.left, top: margin.top, width: plotW, height: plotH };
    const before = resolveLegendAnchors(anchorOverrides, hasSecondary);
    let target = before[axis];

    showSnapOverlay(wrap, lastLayout);
    highlightSnapAnchor(target);
    host.classList.add("is-dragging");
    grip.setPointerCapture(event.pointerId);

    const move = (ev) => {
      const left = ev.clientX - wrapRect.left - offsetX;
      const top = ev.clientY - wrapRect.top - offsetY;
      Object.assign(host.style, {
        left: `${left}px`,
        top: `${top}px`,
        right: "auto",
        bottom: "auto",
        transform: "none",
      });
      target = nearestLegendAnchor(
        left + hostRect.width / 2,
        top + hostRect.height / 2,
        plotRect,
      );
      highlightSnapAnchor(target);
    };
    const finish = (ev) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", finish);
      grip.removeEventListener("pointercancel", finish);
      try {
        grip.releasePointerCapture(ev.pointerId);
      } catch (_) {}
      hideSnapOverlay();
      host.classList.remove("is-dragging");
      if (ev.type !== "pointercancel" && target !== before[axis]) {
        // Taking a spot that the other legend occupies swaps the two.
        const other = 1 - axis;
        if (hasSecondary && before[other] === target) {
          anchorOverrides[other] = before[axis];
        }
        anchorOverrides[axis] = target;
        saveAnchorOverrides();
      }
      layoutCollapsedLegends(lastLayout);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
  });
}

let legendDragWired = false;
function ensureLegendDragWired() {
  if (legendDragWired) return;
  legendHosts().forEach((host, axis) => host && wireLegendDrag(host, axis));
  legendDragWired = true;
}

function buildGrip() {
  const grip = document.createElement("span");
  grip.className = "collapsed-legend-grip";
  grip.title = "Legende verschieben";
  grip.innerHTML = '<i class="bi bi-grip-horizontal" aria-hidden="true"></i>';
  return grip;
}

function fillLegend(host, visible, allowStacking, axisStripe = null) {
  host.innerHTML = "";
  host.classList.toggle("has-axis-stripe", axisStripe != null);
  if (axisStripe != null) host.style.setProperty("--legend-axis-color", AXIS_COLORS[axisStripe]);
  if (visible.length === 0) {
    host.classList.add("d-none");
    return;
  }
  ensureLegendDragWired();
  host.appendChild(buildGrip());

  const targetHost = metricRenderShowsCounts()
    ? appendLegendSection(host, [], {
      stacked: false,
      forceNormalIndicator: true,
      showHeader: true,
      frequency: true,
      headerCount: visible.length,
    })
    : host;

  if (allowStacking && yAxisStackingActive()) {
    const nonStacked = visible.filter((metric) => metric.stackMode === "normal");
    const stacked = visible.filter((metric) => metric.stackMode !== "normal");
    if (nonStacked.length > 0)
      appendLegendSection(targetHost, nonStacked, { stacked: false });
    if (stacked.length > 0)
      appendLegendSection(targetHost, stacked, { stacked: true });
  } else {
    appendLegendSection(
      targetHost,
      visible,
      { stacked: false, forceNormalIndicator: true, showHeader: false },
    );
  }

  host.classList.remove("d-none");
}

// One legend per y-axis: the primary one and, while a second axis is shown,
// a separate one for the metrics on that axis.
export function renderCollapsedLegend() {
  const host = dom.collapsedLegend;
  const secondaryHost = dom.collapsedLegendSecondary;
  if (!host) return;
  host.innerHTML = "";
  if (secondaryHost) {
    secondaryHost.innerHTML = "";
    secondaryHost.classList.add("d-none");
  }

  if (!state.sidebarCollapsed || window.innerWidth < LEGEND_MIN_VIEWPORT_PX) {
    host.classList.add("d-none");
    return;
  }

  const visible = state.metrics.filter((m) => m.draw);
  const split = secondaryAxisActive() && secondaryHost;
  fillLegend(
    host,
    split ? visible.filter((m) => metricAxis(m) === 0) : visible,
    true,
    split ? 0 : null,
  );
  if (split) {
    fillLegend(secondaryHost, visible.filter((m) => metricAxis(m) === 1), false, 1);
  }
}
