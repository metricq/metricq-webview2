import { formatCompact } from "./number-format.mjs";

export function formatFactor(value, precision = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(precision).replace(/\.?0+$/, "");
}

export function formatFactorDisplay(value, precision = 6) {
  const machine = formatFactor(value, precision);
  if (!machine) return null;
  return formatCompact(Number(machine), precision) || machine.replace(".", ",");
}

export function shownMetricFactor(metric, precision = 6) {
  if (metric?.factorMode === "manual") return formatFactorDisplay(metric.manualFactor, precision);
  return null;
}
