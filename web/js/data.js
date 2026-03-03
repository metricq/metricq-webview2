import { apiFetch } from "./api.js";
import { applyAutoScaling } from "./auto-factor.mjs";
import { renderCollapsedLegend } from "./collapsed-legend.js";
import { dom } from "./dom.js";
import { deriveExpressionUnits, deriveExpressionUnitsResolved } from "./expression-units.mjs";
import { renderMetricList } from "./metrics.js";
import { state } from "./model.js";
import { buildQueryTargetsResolved } from "./targets.mjs";
import { parseRangeFromInputs } from "./utils.js";
import { ensureGlobalYAxisRange } from "./y-axis.mjs";

let latestLoadRequestSeq = 0;
const metadataUnitCache = new Map();

async function fetchMetricUnitCached(metricName) {
  const key = String(metricName || "").trim();
  if (!key) return "";
  if (metadataUnitCache.has(key)) return metadataUnitCache.get(key);
  let unit = "";
  try {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(key)}`);
    unit = String(body?.metadata?.unit || "").trim();
  } catch (_) {
    unit = "";
  }
  metadataUnitCache.set(key, unit);
  return unit;
}

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
  if (state.yAxisStacked) return point.t;
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
  applyAutoScaling(state.metrics, visibleSeries, { preferredDisplayUnit: state.yAxisUnitOverride });
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
    state.stackedAligned = null;
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
  await deriveExpressionUnitsResolved(state.metrics, fetchMetricUnitCached);
  if (requestSeq !== latestLoadRequestSeq) return;
  const now = Date.now();
  const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
  const targets = await buildQueryTargetsResolved(state.metrics, fetchMetricUnitCached, async (metricName) => {
    const body = await apiFetch("/api/query/range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metrics: [metricName],
        from: now - tenYearsMs,
        to: now,
      }),
    });
    return { minimum: body?.minimum, maximum: body?.maximum };
  });
  if (requestSeq !== latestLoadRequestSeq) return;
  const stackModes = state.metrics.map((metric) => ({
    name: metric.name,
    stackMode: metric.stackMode === "normal" ? "normal" : "stack",
    draw: !!metric.draw,
  }));
  const metricsKey = JSON.stringify({
    targets,
    yAxisStacked: !!state.yAxisStacked,
    renderMode: state.renderMode,
    stackModes,
  });
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
  const stackedNames = new Set(
    state.metrics
      .filter((metric) => metric.stackMode !== "normal")
      .map((metric) => metric.name),
  );
  const queryTargets = state.yAxisStacked
    ? targets.filter((target) => !stackedNames.has(target.name))
    : targets;
  const stackedTargets = targets.filter((target) => stackedNames.has(target.name));
  req.targets = queryTargets;

  const started = performance.now();
  const [body, stackedBody] = await Promise.all([
    (queryTargets.length > 0)
      ? apiFetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      })
      : Promise.resolve({ series: [] }),
    (state.yAxisStacked && stackedTargets.length > 0)
      ? apiFetch("/api/query/stacked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: stackedTargets,
          from: extendedFrom,
          to: extendedTo,
          maxDataPoints: computeMaxDataPoints(),
        }),
      })
      : Promise.resolve(null),
  ]);

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
  state.stackedAligned = stackedBody
    ? {
      times: Array.isArray(stackedBody.times) ? stackedBody.times : [],
      metrics: Array.isArray(stackedBody.metrics) ? stackedBody.metrics : [],
      values: Array.isArray(stackedBody.values) ? stackedBody.values : [],
    }
    : null;
  if (state.yAxisStacked && state.stackedAligned) {
    const times = state.stackedAligned.times || [];
    const metrics = state.stackedAligned.metrics || [];
    const values = state.stackedAligned.values || [];
    for (let i = 0; i < metrics.length; i += 1) {
      const name = metrics[i];
      const row = Array.isArray(values[i]) ? values[i] : [];
      const points = [];
      const limit = Math.min(times.length, row.length);
      for (let j = 0; j < limit; j += 1) {
        if (row[j] == null) continue;
        const t = Number(times[j]);
        const v = Number(row[j]);
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        points.push({ t, v });
      }
      state.series.set(name, {
        metric: name,
        mode: "values",
        duration: 0,
        points,
        rawCount: points.length,
        stats: { type: "stacked-aligned" },
      });
    }
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
