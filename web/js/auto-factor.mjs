import { normalizeSIUnit } from "./units.mjs";

const SI_PREFIXES = [
  { exp: -9, prefix: "n" },
  { exp: -6, prefix: "u" },
  { exp: -3, prefix: "m" },
  { exp: 0, prefix: "" },
  { exp: 3, prefix: "k" },
  { exp: 6, prefix: "M" },
  { exp: 9, prefix: "G" },
];

const BASE_UNITS = ["W", "Wh", "V", "A", "VA", "Pa", "Hz", "B"];

function buildUnitTable() {
  const table = new Map();
  for (const base of BASE_UNITS) {
    for (const item of SI_PREFIXES) {
      table.set(`${item.prefix}${base}`, { family: base, exp: item.exp });
    }
  }
  return table;
}

const UNIT_TABLE = buildUnitTable();

function parseUnit(unit) {
  if (!unit) return null;
  const normalized = normalizeSIUnit(unit);
  return UNIT_TABLE.get(normalized) || null;
}

function formatUnit(family, exp) {
  const prefix = SI_PREFIXES.find((item) => item.exp === exp)?.prefix;
  if (prefix == null) return family;
  return `${prefix}${family}`;
}

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

export function applyAutoScaling(metrics, seriesMap) {
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
    const parsed = parseUnit(metric.unit);
    if (!parsed) continue;
    const rep = representativeMagnitude(seriesMap.get(metric.name));
    const repBase = rep == null ? null : rep * 10 ** parsed.exp;
    if (!groups.has(parsed.family)) groups.set(parsed.family, []);
    groups.get(parsed.family).push({ metric, exp: parsed.exp, repBase });
  }

  for (const [family, group] of groups.entries()) {
    const targetExp = chooseTargetExp(group);
    const targetUnit = formatUnit(family, targetExp);
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
