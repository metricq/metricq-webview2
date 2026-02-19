import { apiFetch } from "./api.js";
import { state } from "./model.js";

function collectSeriesExtents(seriesList) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of seriesList) {
    if (item.series.mode === "values") {
      for (const p of item.series.points || []) {
        const y = p.v * item.metric.factor;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    } else {
      for (const p of item.series.aggregatePoints || []) {
        minY = Math.min(minY, p.min * item.metric.factor);
        maxY = Math.max(maxY, p.max * item.metric.factor);
      }
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

function withPadding(minY, maxY) {
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return { minY: 0, maxY: 1 };
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const pad = (maxY - minY) * 0.05;
  return { minY: minY - pad, maxY: maxY + pad };
}

export function resolveYAxisDomain(seriesList) {
  const localRaw = collectSeriesExtents(seriesList);
  if (!localRaw) return { minY: 0, maxY: 1 };

  if (state.yAxisMode === "manual") {
    if (Number.isFinite(state.yAxisManualMin) && Number.isFinite(state.yAxisManualMax) && state.yAxisManualMin < state.yAxisManualMax) {
      return { minY: state.yAxisManualMin, maxY: state.yAxisManualMax };
    }
  }

  if (state.yAxisMode === "global") {
    if (Number.isFinite(state.yAxisGlobalMin) && Number.isFinite(state.yAxisGlobalMax) && state.yAxisGlobalMin < state.yAxisGlobalMax) {
      const h = applyZeroMinimumHeuristic(state.yAxisGlobalMin, state.yAxisGlobalMax);
      return withPadding(h.minY, h.maxY);
    }
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
  const metrics = state.metrics
    .filter((m) => m.draw)
    .map((m) => ({
      name: m.name,
      factor: Number.isFinite(m.factor) ? m.factor : 1,
    }));
  const key = metrics
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => `${m.name}:${m.factor.toPrecision(12)}`)
    .join("\n");
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
        const body = await apiFetch("/api/y-range/global", {
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
        };
      } catch (_) {
        return null;
      }
    }),
  );

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of results) {
    if (!r) continue;
    if (r.min < minY) minY = r.min;
    if (r.max > maxY) maxY = r.max;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY >= maxY) {
    throw new Error("no global y-range available for visible metrics");
  }

  state.yAxisGlobalMin = minY;
  state.yAxisGlobalMax = maxY;
  state.yAxisGlobalMetricsKey = key;
}
