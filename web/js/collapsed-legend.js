import { dom } from "./dom.js";
import { metricDisplayName } from "./display-name.mjs";
import { state } from "./model.js";

function formatFactor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(6).replace(/\.?0+$/, "");
}

function shownMetricFactor(metric) {
  if (metric.factorMode === "manual") return formatFactor(metric.manualFactor);
  return null;
}

function truncateMiddle(text, maxLen) {
  const raw = String(text || "");
  if (raw.length <= maxLen) return raw;
  const keep = Math.max(8, Math.floor((maxLen - 1) / 2));
  return `${raw.slice(0, keep)}…${raw.slice(raw.length - keep)}`;
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

  for (const metric of visible) {
    const row = document.createElement("div");
    row.className = "collapsed-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "collapsed-legend-color";
    swatch.style.background = metric.color;

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

    row.append(swatch, labelWrap);
    host.appendChild(row);
  }

  host.classList.remove("d-none");
}
