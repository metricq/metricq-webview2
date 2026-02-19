import { apiFetch } from "./api.js";
import { applyAutoScaling } from "./auto-factor.mjs";
import { renderCollapsedLegend } from "./collapsed-legend.js";
import { dom } from "./dom.js";
import { deriveExpressionUnits } from "./expression-units.mjs";
import { renderMetricList } from "./metrics.js";
import { state } from "./model.js";
import { buildQueryTargetsResolved } from "./targets.mjs";
import { parseRangeFromInputs } from "./utils.js";
import { ensureGlobalYAxisRange } from "./y-axis.mjs";

function computeMaxDataPoints() {
  const width = Math.max(320, dom.chartWrap.clientWidth || window.innerWidth || 320);
  const resolution = Math.max(1, state.resolution || 1);
  const widthBased = Math.max(200, Math.round(width / resolution));
  const hardCap = Math.max(200, state.maxPoints || 200);
  return Math.min(widthBased, hardCap);
}

export async function loadData(renderChart, onStateChanged = () => {}) {
  if (state.metrics.length === 0) {
    state.series.clear();
    renderChart();
    onStateChanged();
    return;
  }

  try {
    parseRangeFromInputs();
  } catch (err) {
    dom.perfBadge.textContent = err.message;
    return;
  }

  const req = {
    targets: await buildQueryTargetsResolved(state.metrics, async (metricName) => {
      const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metricName)}`);
      return body?.metadata?.unit || "";
    }),
    from: state.from,
    to: state.to,
    maxDataPoints: computeMaxDataPoints(),
  };

  const started = performance.now();
  const body = await apiFetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  let aggPoints = 0;
  let rawPoints = 0;
  let totalDbMs = 0;

  state.series.clear();
  for (const series of body.series || []) {
    state.series.set(series.metric, series);
    if (series.mode === "aggregates") aggPoints += series.pointCount || 0;
    rawPoints += Math.round(series.rawCount || 0);
    totalDbMs += Number(series.duration || 0) * 1000;
  }

  deriveExpressionUnits(state.metrics);
  applyAutoScaling(state.metrics, state.series);
  renderMetricList({
    renderChart,
    loadData: () => loadData(renderChart, onStateChanged),
    renderCollapsedLegend,
    onStateChanged,
  });
  if (state.yAxisMode === "global") {
    try {
      await ensureGlobalYAxisRange();
    } catch (_) {}
  }

  dom.aggPointsEl.textContent = String(aggPoints);
  dom.rawPointsEl.textContent = String(rawPoints);

  const totalHttpMs = Math.round(performance.now() - started);
  const totalDbRoundedMs = Math.round(totalDbMs);
  dom.perfBadge.textContent = `HTTP: ${totalHttpMs} ms | DB: ${totalDbRoundedMs} ms`;

  renderChart();
  onStateChanged();
}
