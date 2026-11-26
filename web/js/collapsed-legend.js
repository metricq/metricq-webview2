import { dom } from "./dom.js";
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

function fillLegend(host, visible, allowStacking) {
  host.innerHTML = "";
  if (visible.length === 0) {
    host.classList.add("d-none");
    return;
  }

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
  );
  if (split) {
    fillLegend(secondaryHost, visible.filter((m) => metricAxis(m) === 1), false);
  }
}
