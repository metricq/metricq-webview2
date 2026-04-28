import { apiFetch } from "./api.js";
import { metricRenderShowsCounts, state, yAxisStackingActive } from "./model.js";

function valueSeriesFrequency(points, index) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const curr = points[index];
  if (!curr) return null;
  const candidateDeltas = [];
  if (index > 0) candidateDeltas.push(Number(curr.t) - Number(points[index - 1]?.t));
  if (index + 1 < points.length) candidateDeltas.push(Number(points[index + 1]?.t) - Number(curr.t));
  for (const deltaMs of candidateDeltas) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) continue;
    return 1000 / deltaMs;
  }
  return null;
}

function collectSeriesExtents(seriesList) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of seriesList) {
    if (item.series.mode === "values") {
      const points = item.series.points || [];
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const y = metricRenderShowsCounts()
          ? valueSeriesFrequency(points, i)
          : p.v * item.metric.factor;
        if (!Number.isFinite(y)) continue;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    } else {
      for (const p of item.series.aggregatePoints || []) {
        if (Number(p.count) === 0) continue;
        if (metricRenderShowsCounts()) {
          const activeTimeMs = Number(p.activeTimeMs);
          if (!Number.isFinite(activeTimeMs) || activeTimeMs <= 0) continue;
          const rate = Number(p.count) / (activeTimeMs / 1000);
          minY = Math.min(minY, rate);
          maxY = Math.max(maxY, rate);
          continue;
        }
        minY = Math.min(minY, p.min * item.metric.factor);
        maxY = Math.max(maxY, p.max * item.metric.factor);
      }
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { minY, maxY };
}

function collectStackedExtents(stackedByMetric) {
  if (!stackedByMetric || stackedByMetric.size === 0) return null;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const entry of stackedByMetric.values()) {
    const isStacked = entry?.stacksInYAxis === true;
    const minValues = !isStacked && entry?.minValues ? entry.minValues : entry?.avgValues;
    const maxValues = !isStacked && entry?.maxValues ? entry.maxValues : entry?.avgValues;
    const valid = entry?.valid;
    const length = Number(entry?.length) || 0;
    if (minValues && maxValues && valid && Number.isFinite(length) && length > 0) {
      for (let i = 0; i < length; i += 1) {
        if (valid[i] !== 1) continue;
        const lo = minValues[i];
        const hi = maxValues[i];
        minY = Math.min(minY, lo);
        maxY = Math.max(maxY, hi);
      }
      continue;
    }
    for (const y of entry?.avgByTime?.values?.() || []) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { minY, maxY };
}

function applyZeroMinimumHeuristic(minY, maxY) {
  if (!(minY > 0) || !(maxY > 0)) return { minY, maxY };
  if (maxY <= minY) return { minY, maxY };

  // If the visible baseline is near zero relative to scale, force 0 baseline.
  const ratio = minY / maxY;
  const rangeRatio = (maxY - minY) / maxY;
  if (ratio <= 0.25 || rangeRatio >= 0.7) {
    return { minY: 0, maxY };
  }
  return { minY, maxY };
}

function withPadding(minY, maxY, lockMin = false) {
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return { minY: 0, maxY: 1 };
  if (minY === maxY) {
    minY = lockMin ? minY : (minY - 1);
    maxY += 1;
  }
  const pad = (maxY - minY) * 0.05;
  return {
    minY: lockMin ? minY : (minY - pad),
    maxY: maxY + pad,
  };
}

export function resolveYAxisDomain(seriesList, stackedByMetric = null) {
  const localRaw = yAxisStackingActive()
    ? (collectStackedExtents(stackedByMetric) || collectSeriesExtents(seriesList))
    : collectSeriesExtents(seriesList);
  if (!localRaw) return { minY: 0, maxY: 1 };

  if (state.yAxisMode === "manual") {
    if (Number.isFinite(state.yAxisManualMin) && Number.isFinite(state.yAxisManualMax) && state.yAxisManualMin < state.yAxisManualMax) {
      return { minY: state.yAxisManualMin, maxY: state.yAxisManualMax };
    }
  }

  if (state.yAxisMode === "global") {
    if (Number.isFinite(state.yAxisGlobalMin) && Number.isFinite(state.yAxisGlobalMax) && state.yAxisGlobalMin < state.yAxisGlobalMax) {
      if (yAxisStackingActive()) {
        const minY = 0;
        const maxY = Math.max(state.yAxisGlobalMax, 0);
        return withPadding(minY, maxY, true);
      }
      const h = applyZeroMinimumHeuristic(state.yAxisGlobalMin, state.yAxisGlobalMax);
      return withPadding(h.minY, h.maxY);
    }
  }

  if (yAxisStackingActive()) {
    const minY = 0;
    const maxY = Math.max(localRaw.maxY, 0);
    return withPadding(minY, maxY, true);
  }

  const h = applyZeroMinimumHeuristic(localRaw.minY, localRaw.maxY);
  return withPadding(h.minY, h.maxY);
}

export function visibleMetricsKey() {
  const names = state.metrics.filter((m) => m.draw).map((m) => m.name).sort();
  return names.join("\n");
}

export async function ensureGlobalYAxisRange() {
  if (state.yAxisMode !== "global") return;
  if (metricRenderShowsCounts()) {
    const visibleSeries = state.metrics
      .filter((metric) => metric.draw)
      .map((metric) => ({ metric, series: state.series.get(metric.name) }))
      .filter((item) => item.series && !item.series.error);
    const extents = collectSeriesExtents(visibleSeries);
    if (!extents) return;
    state.yAxisGlobalMin = extents.minY;
    state.yAxisGlobalMax = extents.maxY;
    state.yAxisGlobalMetricsKey = `${visibleMetricsKey()}\nmode:count`;
    return;
  }
  const stacked = yAxisStackingActive();
  const metrics = state.metrics
    .filter((m) => m.draw)
    .map((m) => ({
      name: m.name,
      factor: Number.isFinite(m.factor) ? m.factor : 1,
      stacksInYAxis: m.stackMode !== "normal",
    }));
  const key = metrics
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => `${m.name}:${m.factor.toPrecision(12)}:${m.stacksInYAxis ? "S" : "N"}`)
    .join("\n") + `\nstacked:${stacked ? "1" : "0"}`;
  if (!key) return;
  if (
    key === state.yAxisGlobalMetricsKey &&
    Number.isFinite(state.yAxisGlobalMin) &&
    Number.isFinite(state.yAxisGlobalMax)
  ) {
    return;
  }

  const now = Date.now();
  const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
  const results = await Promise.all(
    metrics.map(async (metric) => {
      try {
        const body = await apiFetch("/api/query/range", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metrics: [metric.name],
            from: now - tenYearsMs,
            to: now,
          }),
        });
        const minimum = Number(body.minimum);
        const maximum = Number(body.maximum);
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
        const scaledA = minimum * metric.factor;
        const scaledB = maximum * metric.factor;
        return {
          min: Math.min(scaledA, scaledB),
          max: Math.max(scaledA, scaledB),
          stacksInYAxis: metric.stacksInYAxis,
        };
      } catch (_) {
        return null;
      }
    }),
  );

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  if (stacked) {
    minY = 0;
    maxY = 0;
    for (const r of results) {
      if (!r) continue;
      if (r.stacksInYAxis) {
        minY += r.min;
        maxY += r.max;
      } else {
        minY = Math.min(minY, r.min);
        maxY = Math.max(maxY, r.max);
      }
    }
  } else {
    for (const r of results) {
      if (!r) continue;
      if (r.min < minY) minY = r.min;
      if (r.max > maxY) maxY = r.max;
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY >= maxY) {
    throw new Error("no global y-range available for visible metrics");
  }

  state.yAxisGlobalMin = minY;
  state.yAxisGlobalMax = maxY;
  state.yAxisGlobalMetricsKey = key;
}
