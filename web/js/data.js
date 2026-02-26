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

let latestLoadRequestSeq = 0;

function computeMaxDataPoints() {
  const width = Math.max(320, dom.chartWrap.clientWidth || window.innerWidth || 320);
  const resolution = Math.max(1, state.resolution || 1);
  const widthBased = Math.max(200, Math.round(width / resolution));
  const hardCap = Math.max(200, state.maxPoints || 200);
  return Math.min(widthBased, hardCap);
}

function seriesDisplayTime(points, index, series) {
  const point = points?.[index];
  if (!point) return NaN;
  const isAggregateSeries = series?.mode === "aggregates";
  const isComputedValuesSeries = series?.mode === "values" && String(series?.stats?.type || "") === "computed";
  if (state.renderMode !== "ti" && index > 0 && (isAggregateSeries || isComputedValuesSeries)) {
    const prev = points[index - 1];
    return Math.round((prev.t + point.t) / 2);
  }
  return point.t;
}

function clipSeriesToVisibleRange(series) {
  const from = state.from;
  const to = state.to;
  if (series?.mode === "values") {
    const points = series.points || [];
    const clipped = [];
    for (let i = 0; i < points.length; i += 1) {
      const t = seriesDisplayTime(points, i, series);
      if (t < from || t > to) continue;
      clipped.push(points[i]);
    }
    return { ...series, points: clipped };
  }

  const aggregatePoints = series?.aggregatePoints || [];
  const clipped = [];
  for (let i = 0; i < aggregatePoints.length; i += 1) {
    const t = seriesDisplayTime(aggregatePoints, i, series);
    if (t < from || t > to) continue;
    clipped.push(aggregatePoints[i]);
  }
  return { ...series, aggregatePoints: clipped };
}

function updateVisibleState(renderChart, onStateChanged, startedAt = null, aggPoints = null, rawPoints = null, totalDbMs = null) {
  deriveExpressionUnits(state.metrics);
  const visibleSeries = new Map();
  for (const [name, series] of state.series.entries()) {
    visibleSeries.set(name, clipSeriesToVisibleRange(series));
  }
  applyAutoScaling(state.metrics, visibleSeries);
  renderMetricList({
    renderChart,
    loadData: () => loadData(renderChart, onStateChanged),
    renderCollapsedLegend,
    onStateChanged,
  });

  if (Number.isFinite(aggPoints)) dom.aggPointsEl.textContent = String(aggPoints);
  if (Number.isFinite(rawPoints)) dom.rawPointsEl.textContent = String(rawPoints);
  if (startedAt != null && Number.isFinite(totalDbMs)) {
    const totalHttpMs = Math.round(performance.now() - startedAt);
    const totalDbRoundedMs = Math.round(totalDbMs);
    dom.perfBadge.textContent = `HTTP: ${totalHttpMs} ms | DB: ${totalDbRoundedMs} ms`;
  }

}

export async function loadData(renderChart, onStateChanged = () => {}) {
  if (state.metrics.length === 0) {
    state.series.clear();
    state.loadedFrom = null;
    state.loadedTo = null;
    state.loadedMetricsKey = "";
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

  const visibleRange = Math.max(1, state.to - state.from);
  const extendedFrom = state.from - visibleRange;
  const extendedTo = state.to + visibleRange;
  const requestSeq = ++latestLoadRequestSeq;
  const targets = await buildQueryTargetsResolved(state.metrics, async (metricName) => {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metricName)}`);
    return body?.metadata?.unit || "";
  });
  if (requestSeq !== latestLoadRequestSeq) return;
  const metricsKey = JSON.stringify(targets);
  const coveredByLoadedWindow =
    state.loadedMetricsKey === metricsKey &&
    Number.isFinite(state.loadedFrom) &&
    Number.isFinite(state.loadedTo) &&
    extendedFrom >= state.loadedFrom &&
    extendedTo <= state.loadedTo;
  if (coveredByLoadedWindow) {
    updateVisibleState(renderChart, onStateChanged);
    renderChart();
    onStateChanged();
  }

  const req = {
    targets,
    from: extendedFrom,
    to: extendedTo,
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
  if (requestSeq !== latestLoadRequestSeq) return;

  state.series.clear();
  for (const series of body.series || []) {
    state.series.set(series.metric, series);
    if (series.mode === "aggregates") aggPoints += (series.aggregatePoints || []).length;
    rawPoints += Math.round(series.rawCount || 0);
    totalDbMs += Number(series.duration || 0) * 1000;
  }
  state.loadedFrom = extendedFrom;
  state.loadedTo = extendedTo;
  state.loadedMetricsKey = metricsKey;

  updateVisibleState(renderChart, onStateChanged, started, aggPoints, rawPoints, totalDbMs);
  if (state.yAxisMode === "global") {
    try {
      await ensureGlobalYAxisRange();
    } catch (_) {}
  }
  renderChart();
  onStateChanged();
}
