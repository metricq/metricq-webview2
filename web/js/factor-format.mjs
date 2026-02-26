export function formatFactor(value, precision = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(precision).replace(/\.?0+$/, "");
}

export function shownMetricFactor(metric, precision = 6) {
  if (metric?.factorMode === "manual") return formatFactor(metric.manualFactor, precision);
  return null;
}
