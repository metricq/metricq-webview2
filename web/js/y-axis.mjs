import { createYScale } from "./y-scale.mjs";
import { apiFetch } from "./api.js";
import { axisConfig, metricAxis, metricRenderShowsCounts, state, yAxisStackingActive } from "./model.js";

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

// axis 0 = primary (left), axis 1 = secondary (right). Each axis has its own
// scale and range mode; stacking only applies to the primary axis.
export function resolveYAxisDomain(seriesList, stackedByMetric = null, logConstant = 1, axis = 0) {
  const cfg = axisConfig(axis);
  const stacking = axis === 0 && yAxisStackingActive();
  const localRaw = stacking
    ? (collectStackedExtents(stackedByMetric) || collectSeriesExtents(seriesList))
    : collectSeriesExtents(seriesList);
  if (!localRaw) return { minY: 0, maxY: 1 };

  if (cfg.mode === "manual") {
    if (Number.isFinite(cfg.manualMin) && Number.isFinite(cfg.manualMax) && cfg.manualMin < cfg.manualMax) {
      return { minY: cfg.manualMin, maxY: cfg.manualMax };
    }
  }

  const range = { min: cfg.globalMin, max: cfg.globalMax };
  if (cfg.scale === "symlog") {
    const global = cfg.mode === "global" && Number.isFinite(range.min) && Number.isFinite(range.max);
    let minY = global ? range.min : localRaw.minY;
    let maxY = global ? range.max : localRaw.maxY;
    const scale = createYScale(minY, maxY, true, logConstant);
    const low = scale.transform(minY);
    const high = scale.transform(maxY);
    const pad = Math.max(high - low, 0.1) * 0.05;
    return { minY: scale.inverse(low - pad), maxY: scale.inverse(high + pad) };
  }
  if (cfg.mode === "global") {
    if (Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max) {
      if (stacking) {
        const minY = 0;
        const maxY = Math.max(range.max, 0);
        return withPadding(minY, maxY, true);
      }
      const h = applyZeroMinimumHeuristic(range.min, range.max);
      return withPadding(h.minY, h.maxY);
    }
  }

  if (stacking) {
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
  if (axisConfig(0).mode === "global") await ensureGlobalRangeForAxis(0);
  if (axisConfig(1).mode === "global") await ensureGlobalRangeForAxis(1);
}

function storeGlobalRange(axis, min, max, key) {
  if (axis === 1) {
    state.yAxis2GlobalMin = min;
    state.yAxis2GlobalMax = max;
    state.yAxis2GlobalMetricsKey = key;
  } else {
    state.yAxisGlobalMin = min;
    state.yAxisGlobalMax = max;
    state.yAxisGlobalMetricsKey = key;
  }
}

async function ensureGlobalRangeForAxis(axis) {
  const axisMetrics = state.metrics.filter((m) => m.draw && metricAxis(m) === axis);
  if (axis === 1 && axisMetrics.length === 0) {
    storeGlobalRange(1, null, null, "");
    return;
  }
  if (metricRenderShowsCounts()) {
    const visibleSeries = axisMetrics
      .map((metric) => ({ metric, series: state.series.get(metric.name) }))
      .filter((item) => item.series && !item.series.error);
    const extents = collectSeriesExtents(visibleSeries);
    if (!extents) return;
    storeGlobalRange(axis, extents.minY, extents.maxY, `${visibleMetricsKey()}\nmode:count`);
    return;
  }
  const stacked = axis === 0 && yAxisStackingActive();
  const metrics = axisMetrics
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
  const cached = axis === 1
    ? { key: state.yAxis2GlobalMetricsKey, min: state.yAxis2GlobalMin, max: state.yAxis2GlobalMax }
    : { key: state.yAxisGlobalMetricsKey, min: state.yAxisGlobalMin, max: state.yAxisGlobalMax };
  if (key === cached.key && Number.isFinite(cached.min) && Number.isFinite(cached.max)) {
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

  storeGlobalRange(axis, minY, maxY, key);
}

// Use data magnitudes so choosing another SI prefix does not change the curve.
export function resolveLogConstant(seriesList, stackedByMetric = null) {
  let smallest = Infinity;
  const consider = (value) => {
    const magnitude = Math.abs(value);
    if (Number.isFinite(magnitude) && magnitude > 0) smallest = Math.min(smallest, magnitude);
  };
  for (const { metric, series } of seriesList) {
    const points = series.points || [];
    for (let i = 0; i < points.length; i++) {
      consider(metricRenderShowsCounts() ? valueSeriesFrequency(points, i) : points[i].v * metric.factor);
    }
    for (const point of series.aggregatePoints || []) {
      if (Number(point.count) === 0) continue;
      if (metricRenderShowsCounts()) {
        if (point.activeTimeMs > 0) consider(point.count / (point.activeTimeMs / 1000));
      } else {
        for (const value of [point.min, point.avg, point.max]) consider(value * metric.factor);
      }
    }
  }
  for (const entry of stackedByMetric?.values() || []) {
    for (let i = 0; i < entry.length; i++) {
      if (entry.valid?.[i] === 1) consider(entry.avgValues[i]);
    }
  }
  return Number.isFinite(smallest) ? Math.max(smallest / 10, Number.MIN_VALUE) : 1;
}
