import { formatSIUnit, parseSIUnit, SI_PREFIXES } from "./si-units.mjs";

function representativeMagnitude(series) {
  if (!series) return null;
  let best = 0;
  if (series.mode === "values") {
    for (const p of series.points || []) {
      const v = Math.abs(Number(p.v));
      if (Number.isFinite(v) && v > best) best = v;
    }
  } else {
    for (const p of series.aggregatePoints || []) {
      const v = Math.abs(Number(p.avg));
      if (Number.isFinite(v) && v > best) best = v;
    }
  }
  return best > 0 ? best : null;
}

function chooseTargetExp(candidates) {
  const available = SI_PREFIXES.map((item) => item.exp);
  const logs = candidates
    .map((c) => c.repBase)
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.log10(v));

  if (logs.length === 0) {
    const avgExp = candidates.reduce((sum, c) => sum + c.exp, 0) / candidates.length;
    let best = available[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const exp of available) {
      const dist = Math.abs(exp - avgExp);
      if (dist < bestDist || (dist === bestDist && exp > best)) {
        best = exp;
        bestDist = dist;
      }
    }
    return best;
  }

  let best = available[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const exp of available) {
    // Balance readability for both high and low magnitudes.
    // This keeps large values compact, but avoids pushing whole groups to overly large prefixes.
    let score = 0;
    for (const baseLog of logs) {
      const transformedLog = baseLog - exp;
      if (transformedLog < -0.2) score += (-0.2 - transformedLog) * 3.0;
      else if (transformedLog < 0) score += (0 - transformedLog) * 1.0;
      if (transformedLog > 3) score += (transformedLog - 3) * 1.8;
      score += Math.abs(transformedLog - 1.2) * 0.1;
    }
    if (score < bestScore || (score === bestScore && exp > best)) {
      best = exp;
      bestScore = score;
    }
  }
  return best;
}

export function applyAutoScaling(metrics, seriesMap, options = {}) {
  const preferredDisplayUnit = String(options?.preferredDisplayUnit || "").trim();
  const preferredParsed = parseSIUnit(preferredDisplayUnit);
  const manualFactors = new Map();
  for (const metric of metrics) {
    if (metric.factorMode === "manual") {
      const manual = Number(metric.manualFactor);
      manualFactors.set(metric.name, Number.isFinite(manual) ? manual : 1);
    }
    metric.factor = 1;
    metric.displayUnit = metric.unit || "";
  }

  const groups = new Map();
  for (const metric of metrics) {
    const parsed = parseSIUnit(metric.unit);
    if (!parsed) continue;
    const rep = representativeMagnitude(seriesMap.get(metric.name));
    const repBase = rep == null ? null : rep * 10 ** parsed.exp;
    if (!groups.has(parsed.family)) groups.set(parsed.family, []);
    groups.get(parsed.family).push({ metric, exp: parsed.exp, repBase });
  }

  for (const [family, group] of groups.entries()) {
    const targetExp = preferredParsed && preferredParsed.family === family
      ? preferredParsed.exp
      : chooseTargetExp(group);
    const targetUnit = formatSIUnit(family, targetExp);
    for (const item of group) {
      item.metric.factor = 10 ** (item.exp - targetExp);
      item.metric.displayUnit = targetUnit;
    }
  }

  for (const metric of metrics) {
    if (metric.factorMode !== "manual") continue;
    const manual = manualFactors.get(metric.name);
    if (!Number.isFinite(manual)) continue;
    metric.factor *= manual;
  }
}
