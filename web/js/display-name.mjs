export function metricDisplayName(metric) {
  if (!metric) return "";
  const alias = String(metric.alias || "").trim();
  if (alias) return alias;
  return String(metric.name || "").trim();
}
