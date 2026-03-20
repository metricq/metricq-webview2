import { dom } from "./dom.js";
import { shownMetricFactor } from "./factor-format.mjs";
import { metricDisplayName, state } from "./model.js";

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
  const unit = metric.displayUnit || metric.unit || "";
  const factor = shownMetricFactor(metric);
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

function buildSectionHeader({ stacked = false, count = 0 } = {}) {
  const header = document.createElement("div");
  header.className = `collapsed-legend-section-header${stacked ? " is-stacked" : ""}`;

  const icon = document.createElement("span");
  icon.className = `collapsed-legend-section-header-icon${stacked ? " is-stacked" : ""}`;
  icon.innerHTML = stacked
    ? '<i class="bi bi-layers-fill" aria-hidden="true"></i>'
    : '<i class="bi bi-dash-lg" aria-hidden="true"></i>';

  const text = document.createElement("span");
  text.className = "collapsed-legend-section-header-text";
  text.textContent = stacked ? `Stack (${count})` : "Einzeln";

  header.append(icon, text);
  return header;
}

function appendLegendSection(
  host,
  metrics,
  { stacked = false, forceNormalIndicator = false } = {},
) {
  const section = document.createElement("section");
  section.className = `collapsed-legend-section${stacked ? " is-stacked" : ""}`;
  section.appendChild(buildSectionHeader({ stacked, count: metrics.length }));
  for (const metric of metrics) {
    section.appendChild(buildLegendRow(metric, { forceNormalIndicator }));
  }
  host.appendChild(section);
}

export function renderCollapsedLegend() {
  const host = dom.collapsedLegend;
  if (!host) return;
  host.innerHTML = "";

  if (!state.sidebarCollapsed) {
    host.classList.add("d-none");
    return;
  }

  const visible = state.metrics.filter((m) => m.draw);
  if (visible.length === 0) {
    host.classList.add("d-none");
    return;
  }

  if (state.yAxisStacked) {
    const nonStacked = visible.filter((metric) => metric.stackMode === "normal");
    const stacked = visible.filter((metric) => metric.stackMode !== "normal");
    if (nonStacked.length > 0)
      appendLegendSection(host, nonStacked, { stacked: false });
    if (stacked.length > 0)
      appendLegendSection(host, stacked, { stacked: true });
  } else {
    appendLegendSection(
      host,
      visible,
      { stacked: false, forceNormalIndicator: true },
    );
  }

  host.classList.remove("d-none");
}
