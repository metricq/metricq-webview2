import { collectExpressionReferences } from "./expression-refs.mjs";
import { formatFactor } from "./factor-format.mjs";
import { SI_PREFIXES, parseSIUnit } from "./si-units.mjs";

export function expressionTokenForMetric(name) {
  return `[${String(name || "").trim()}]`;
}

const RESERVED_FUNCTIONS = new Set(["log", "min", "max", "sum"]);

const metadataUnitCache = new Map();

function wrapScaledMetric(metricName, factorText) {
  return `([${metricName}]*${factorText})`;
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

async function buildExpressionFactorMap(expression, metrics, fetchMetricUnit) {
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
      const manual = localMetric.factorMode === "manual"
        ? Number(localMetric.manualFactor)
        : 1;
      refEntries.push({
        name: refName,
        parsedUnit: parseSIUnit(unit),
        displayParsed: parseSIUnit(displayUnit),
        manualFactor: Number.isFinite(manual) ? manual : 1,
      });
      continue;
    }

    const unit = await resolveMetricUnit(refName, fetchMetricUnit);
    refEntries.push({ name: refName, parsedUnit: parseSIUnit(unit), displayParsed: null, manualFactor: 1 });
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

export async function buildQueryTargetsResolved(metrics, fetchMetricUnit) {
  const out = [];
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
      factorMap = await buildExpressionFactorMap(expr, metrics, fetchMetricUnit);
    }
    out.push({
      name,
      expr: buildComputedExpression(expr, metrics, factorMap),
    });
  }
  return out;
}
