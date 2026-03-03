import { collectExpressionReferences } from "./expression-refs.mjs";
import { formatFactor } from "./factor-format.mjs";
import { SI_PREFIXES, formatSIUnit, parseSIUnit } from "./si-units.mjs";

export function expressionTokenForMetric(name) {
  return `[${String(name || "").trim()}]`;
}

const RESERVED_FUNCTIONS = new Set(["log", "min", "max", "sum"]);

const metadataUnitCache = new Map();
const metadataRangeCache = new Map();

function wrapScaledMetric(metricName, factorText) {
  return `([${metricName}]*${factorText})`;
}

function expressionSupportsUnitPropagation(expr) {
  const withoutScalarMult = String(expr || "")
    .replace(/(^|[+\-/*(,\s])([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*\*/gi, "$1")
    .replace(/\*\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?=$|[+\-/*),\s])/gi, "");
  const withoutScalarOps = withoutScalarMult
    .replace(/\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?=$|[+\-/*),\s])/gi, "");
  const text = withoutScalarOps.toLowerCase();
  return !text.includes("*") && !text.includes("/") && !/\blog\b/.test(text);
}

async function resolveMetricUnit(metricName, fetchMetricUnit) {
  const key = String(metricName || "").trim();
  if (!key) return "";
  if (metadataUnitCache.has(key)) return metadataUnitCache.get(key);
  let unit = "";
  try {
    unit = String((await fetchMetricUnit(key)) || "").trim();
  } catch (_) {
    unit = "";
  }
  metadataUnitCache.set(key, unit);
  return unit;
}

async function resolveMetricRange(metricName, fetchMetricRange) {
  const key = String(metricName || "").trim();
  if (!key) return null;
  if (metadataRangeCache.has(key)) return metadataRangeCache.get(key);
  let out = null;
  try {
    const value = await fetchMetricRange(key);
    const minimum = Number(value?.minimum);
    const maximum = Number(value?.maximum);
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
      out = { minimum, maximum };
    }
  } catch (_) {
    out = null;
  }
  metadataRangeCache.set(key, out);
  return out;
}

function chooseDisplayExpFromRepresentative(repBase) {
  if (!Number.isFinite(repBase) || repBase <= 0) return null;
  const baseLog = Math.log10(repBase);
  let bestExp = SI_PREFIXES[0].exp;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of SI_PREFIXES) {
    const transformedLog = baseLog - entry.exp;
    let score = 0;
    if (transformedLog < -0.2) score += (-0.2 - transformedLog) * 3.0;
    else if (transformedLog < 0) score += -transformedLog;
    if (transformedLog > 3) score += (transformedLog - 3) * 1.8;
    score += Math.abs(transformedLog - 1.2) * 0.1;
    if (score < bestScore || (score === bestScore && entry.exp > bestExp)) {
      bestScore = score;
      bestExp = entry.exp;
    }
  }
  return bestExp;
}

async function inferDisplayParsed(refName, parsedUnit, fetchMetricRange) {
  if (!parsedUnit?.family || !Number.isFinite(parsedUnit?.exp) || typeof fetchMetricRange !== "function") {
    return null;
  }
  const range = await resolveMetricRange(refName, fetchMetricRange);
  const min = Number(range?.minimum);
  const max = Number(range?.maximum);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const rep = Math.max(Math.abs(min), Math.abs(max));
  if (!(rep > 0)) return null;
  const repBase = rep * (10 ** parsedUnit.exp);
  const displayExp = chooseDisplayExpFromRepresentative(repBase);
  if (!Number.isFinite(displayExp)) return null;
  return { family: parsedUnit.family, exp: displayExp };
}

function computeFactorByUnit(ref, targetExp) {
  if (!ref?.parsedUnit || !Number.isFinite(targetExp)) return 1;
  return 10 ** (ref.parsedUnit.exp - targetExp);
}

function pickTargetExp(refsInFamily) {
  const knownTargets = refsInFamily
    .map((r) => r.displayParsed?.exp)
    .filter((exp) => Number.isFinite(exp));
  if (knownTargets.length > 0) return knownTargets[0];

  const sourceExps = refsInFamily
    .map((r) => r.parsedUnit?.exp)
    .filter((exp) => Number.isFinite(exp));
  if (sourceExps.length === 0) return null;

  const avg = sourceExps.reduce((sum, exp) => sum + exp, 0) / sourceExps.length;
  let best = SI_PREFIXES[0].exp;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of SI_PREFIXES) {
    const dist = Math.abs(entry.exp - avg);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry.exp;
    }
  }
  return best;
}

async function buildExpressionFactorMap(expression, metrics, fetchMetricUnit, fetchMetricRange) {
  const refs = collectExpressionReferences(expression);
  if (refs.length === 0) return new Map();

  const byName = new Map((metrics || []).map((m) => [m.name, m]));
  const refEntries = [];

  for (const refName of refs) {
    const localMetric = byName.get(refName);
    if (localMetric) {
      const localUnit = String(localMetric.unit || "").trim();
      const unit = localUnit || (await resolveMetricUnit(refName, fetchMetricUnit));
      const displayUnit = String(localMetric.displayUnit || "").trim();
      const parsedUnit = parseSIUnit(unit);
      const inferredDisplayParsed = await inferDisplayParsed(refName, parsedUnit, fetchMetricRange);
      const displayParsed = inferredDisplayParsed || parseSIUnit(displayUnit);
      const manual = localMetric.factorMode === "manual"
        ? Number(localMetric.manualFactor)
        : 1;
      refEntries.push({
        name: refName,
        parsedUnit,
        displayParsed,
        manualFactor: Number.isFinite(manual) ? manual : 1,
      });
      continue;
    }

    const unit = await resolveMetricUnit(refName, fetchMetricUnit);
    const parsedUnit = parseSIUnit(unit);
    const displayParsed = await inferDisplayParsed(refName, parsedUnit, fetchMetricRange);
    refEntries.push({ name: refName, parsedUnit, displayParsed, manualFactor: 1 });
  }

  const factorMap = new Map();

  const families = new Map();
  for (const ref of refEntries) {
    const family = ref.parsedUnit?.family;
    if (!family) continue;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(ref);
  }

  for (const refsInFamily of families.values()) {
    const targetExp = pickTargetExp(refsInFamily);
    if (!Number.isFinite(targetExp)) continue;
    for (const ref of refsInFamily) {
      factorMap.set(ref.name, computeFactorByUnit(ref, targetExp) * (ref.manualFactor || 1));
    }
  }

  for (const ref of refEntries) {
    if (factorMap.has(ref.name)) continue;
    const manual = Number(ref.manualFactor);
    if (Number.isFinite(manual) && Math.abs(manual - 1) > 1e-12) {
      factorMap.set(ref.name, manual);
    }
  }

  return factorMap;
}

async function alignExpressionMetricUnit(metric, metrics, factorMap, fetchMetricUnit) {
  if (!metric?.expr) return;
  if (metric?.factorMode === "manual") {
    const unit = String(metric?.unit || "").trim();
    const displayUnit = String(metric?.displayUnit || "").trim();
    if (unit && displayUnit) return;
  }
  if (!expressionSupportsUnitPropagation(metric.expr)) return;
  if (!(factorMap instanceof Map)) return;
  if (typeof fetchMetricUnit !== "function") return;

  const refs = collectExpressionReferences(metric.expr);
  if (refs.length === 0) return;
  const byName = new Map((metrics || []).map((m) => [m.name, m]));

  let family = "";
  let resolvedExp = NaN;
  for (const refName of refs) {
    const local = byName.get(refName);
    const sourceUnit = local
      ? String(local.unit || "").trim() || await resolveMetricUnit(refName, fetchMetricUnit)
      : await resolveMetricUnit(refName, fetchMetricUnit);
    const parsed = parseSIUnit(sourceUnit);
    if (!parsed) return;

    let factor = Number(factorMap.get(refName));
    if (!Number.isFinite(factor)) factor = 1;
    if (local?.factorMode === "manual") {
      const manual = Number(local.manualFactor);
      if (Number.isFinite(manual) && Math.abs(manual) > 1e-12) factor /= manual;
    }
    if (!(factor > 0)) return;

    const shift = Math.log10(factor);
    const roundedShift = Math.round(shift);
    if (Math.abs(shift - roundedShift) > 1e-9) return;
    const nextExp = parsed.exp - roundedShift;

    if (!family) {
      family = parsed.family;
      resolvedExp = nextExp;
      continue;
    }
    if (parsed.family !== family || !Number.isFinite(resolvedExp) || Math.abs(nextExp - resolvedExp) > 1e-9) return;
  }

  if (!family || !Number.isFinite(resolvedExp)) return;
  const unit = formatSIUnit(family, resolvedExp);
  metric.unit = unit;
  metric.displayUnit = unit;
}

export function buildComputedExpression(expression, metrics, factorMapOverride = null) {
  const text = String(expression || "");
  if (!text) return "";

  const factorMap = factorMapOverride instanceof Map ? factorMapOverride : new Map();
  if (factorMap.size === 0) {
    for (const metric of metrics || []) {
      const name = String(metric?.name || "").trim();
      if (!name) continue;
      const factor = Number(metric?.factor);
      if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-12) continue;
      factorMap.set(name, factor);
    }
  }

  if (factorMap.size === 0) return text;

  let out = "";
  for (let i = 0; i < text.length;) {
    const ch = text[i];

    if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end === -1) {
        out += text.slice(i);
        break;
      }
      const name = text.slice(i + 1, end).trim();
      const factorText = formatFactor(factorMap.get(name), 12);
      out += factorText ? wrapScaledMetric(name, factorText) : text.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_:.\-]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      const factorText = RESERVED_FUNCTIONS.has(lower) ? null : formatFactor(factorMap.get(word), 12);
      out += factorText ? wrapScaledMetric(word, factorText) : word;
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function buildQueryTargets(metrics) {
  return (metrics || [])
    .map((metric) => {
      const name = String(metric?.name || "").trim();
      const expr = String(metric?.expr || "").trim();
      if (!name) return null;
      if (expr) return { name, expr: buildComputedExpression(expr, metrics) };
      return { name, metric: name };
    })
    .filter(Boolean);
}

export async function buildQueryTargetsResolved(metrics, fetchMetricUnit, fetchMetricRange = null) {
  const out = [];
  const byName = new Map((metrics || []).map((m) => [m?.name, m]));
  for (const metric of metrics || []) {
    const name = String(metric?.name || "").trim();
    const expr = String(metric?.expr || "").trim();
    if (!name) continue;
    if (!expr) {
      out.push({ name, metric: name });
      continue;
    }

    let factorMap = null;
    if (typeof fetchMetricUnit === "function") {
      factorMap = await buildExpressionFactorMap(expr, metrics, fetchMetricUnit, fetchMetricRange);
      const localMetric = byName.get(name);
      await alignExpressionMetricUnit(localMetric, metrics, factorMap, fetchMetricUnit);
    }
    out.push({
      name,
      expr: buildComputedExpression(expr, metrics, factorMap),
    });
  }
  return out;
}
