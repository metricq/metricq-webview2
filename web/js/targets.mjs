export function expressionTokenForMetric(name) {
  return `[${String(name || "").trim()}]`;
}

const RESERVED_FUNCTIONS = new Set(["log", "min", "max", "sum"]);

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

const UNIT_TABLE = (() => {
  const map = new Map();
  for (const base of BASE_UNITS) {
    for (const entry of SI_PREFIXES) {
      map.set(`${entry.prefix}${base}`, { family: base, exp: entry.exp });
    }
  }
  return map;
})();

const metadataUnitCache = new Map();

function parseUnit(unit) {
  return UNIT_TABLE.get(String(unit || "").trim()) || null;
}

function formatFactor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(12).replace(/\.?0+$/, "");
}

function wrapScaledMetric(metricName, factorText) {
  return `([${metricName}]*${factorText})`;
}

function collectExpressionReferences(expression) {
  const refs = [];
  const text = String(expression || "");

  const bracketRegex = /\[([^\]]+)\]/g;
  let m = bracketRegex.exec(text);
  while (m) {
    const name = String(m[1] || "").trim();
    if (name) refs.push(name);
    m = bracketRegex.exec(text);
  }

  const bare = text.replace(/\[[^\]]+\]/g, " ");
  const identRegex = /\b([A-Za-z_][A-Za-z0-9_:.\-]*)\b/g;
  let id = identRegex.exec(bare);
  while (id) {
    const token = id[1];
    const lower = token.toLowerCase();
    if (!RESERVED_FUNCTIONS.has(lower)) refs.push(token);
    id = identRegex.exec(bare);
  }

  return [...new Set(refs)];
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
      const localFactor = Number(localMetric.factor);
      if (Number.isFinite(localFactor) && Math.abs(localFactor - 1) > 1e-12) {
        refEntries.push({ name: refName, explicitFactor: localFactor });
        continue;
      }
      const unit = String(localMetric.unit || "").trim();
      const displayUnit = String(localMetric.displayUnit || "").trim();
      refEntries.push({
        name: refName,
        parsedUnit: parseUnit(unit),
        displayParsed: parseUnit(displayUnit),
      });
      continue;
    }

    const unit = await resolveMetricUnit(refName, fetchMetricUnit);
    refEntries.push({ name: refName, parsedUnit: parseUnit(unit), displayParsed: null });
  }

  const factorMap = new Map();

  for (const ref of refEntries) {
    if (Number.isFinite(ref.explicitFactor)) {
      factorMap.set(ref.name, ref.explicitFactor);
    }
  }

  const families = new Map();
  for (const ref of refEntries) {
    if (factorMap.has(ref.name)) continue;
    const family = ref.parsedUnit?.family;
    if (!family) continue;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(ref);
  }

  for (const refsInFamily of families.values()) {
    const targetExp = pickTargetExp(refsInFamily);
    if (!Number.isFinite(targetExp)) continue;
    for (const ref of refsInFamily) {
      factorMap.set(ref.name, computeFactorByUnit(ref, targetExp));
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
      const factorText = formatFactor(factorMap.get(name));
      out += factorText ? wrapScaledMetric(name, factorText) : text.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_:.\-]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      const factorText = RESERVED_FUNCTIONS.has(lower) ? null : formatFactor(factorMap.get(word));
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
