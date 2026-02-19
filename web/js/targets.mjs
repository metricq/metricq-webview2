export function expressionTokenForMetric(name) {
  return `[${String(name || "").trim()}]`;
}

export function buildQueryTargets(metrics) {
  return (metrics || [])
    .map((metric) => {
      const name = String(metric?.name || "").trim();
      const expr = String(metric?.expr || "").trim();
      if (!name) return null;
      if (expr) return { name, expr };
      return { name, metric: name };
    })
    .filter(Boolean);
}
