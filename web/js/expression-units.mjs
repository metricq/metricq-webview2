import { formatSIUnit, parseSIUnit, SI_PREFIXES } from "./si-units.mjs";

const RESERVED = new Set(["min", "max", "sum", "log"]);

function collectDependencies(expr) {
  const out = new Set();
  const text = String(expr || "");

  const bracketRegex = /\[([^\]]+)\]/g;
  let bracketMatch = bracketRegex.exec(text);
  while (bracketMatch) {
    const name = String(bracketMatch[1] || "").trim();
    if (name) out.add(name);
    bracketMatch = bracketRegex.exec(text);
  }

  const bare = text.replace(/\[[^\]]+\]/g, " ");
  const identRegex = /\b([A-Za-z_][A-Za-z0-9_:.\-]*)\b/g;
  let ident = identRegex.exec(bare);
  while (ident) {
    const word = ident[1];
    const lowered = word.toLowerCase();
    if (!RESERVED.has(lowered)) out.add(word);
    ident = identRegex.exec(bare);
  }

  return [...out];
}

function expressionSupportsUnitPropagation(expr) {
  // Pure scalar multipliers do not change units and are allowed.
  // Pure scalar multipliers/divisors on metric terms do not change units and are allowed.
  // Examples: 100*[a], [a]*0.5, [a]/10, ([a]*2)+([b]/3)
  const withoutScalarMult = String(expr || "")
    .replace(/(^|[+\-/*(,\s])([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*\*/gi, "$1")
    .replace(/\*\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?=$|[+\-/*),\s])/gi, "");
  const withoutScalarOps = withoutScalarMult
    .replace(/\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?=$|[+\-/*),\s])/gi, "");
  const text = withoutScalarOps.toLowerCase();
  return !text.includes("*") && !text.includes("/") && !/\blog\b/.test(text);
}

function chooseBestExp(parsed) {
  const avgExp = Math.round(parsed.reduce((sum, p) => sum + p.exp, 0) / parsed.length);
  let bestExp = SI_PREFIXES[0].exp;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of SI_PREFIXES) {
    const distance = Math.abs(item.exp - avgExp);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestExp = item.exp;
    }
  }
  return bestExp;
}

function applyDerivedUnit(metric, parsed) {
  const family = parsed[0].family;
  if (parsed.some((p) => p.family !== family)) {
    metric.unit = "";
    metric.displayUnit = "";
    return;
  }
  const bestExp = chooseBestExp(parsed);
  metric.unit = formatSIUnit(family, bestExp);
  metric.displayUnit = metric.unit;
}

function keepManualUnitAsIs(metric) {
  if (metric?.factorMode !== "manual") return false;
  const unit = String(metric?.unit || "").trim();
  const displayUnit = String(metric?.displayUnit || "").trim();
  return Boolean(unit && displayUnit);
}

export function deriveExpressionUnits(metrics) {
  const byName = new Map((metrics || []).map((metric) => [metric.name, metric]));

  for (const metric of metrics || []) {
    if (!metric.expr || keepManualUnitAsIs(metric)) continue;

    if (!expressionSupportsUnitPropagation(metric.expr)) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    const depNames = collectDependencies(metric.expr);
    const hasExternalDeps = depNames.some((name) => !byName.has(name));
    if (hasExternalDeps) continue;
    const deps = depNames.map((name) => byName.get(name)).filter(Boolean);

    if (deps.length === 0) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    const parsed = deps
      .map((dep) => parseSIUnit(dep.displayUnit || dep.unit || ""))
      .filter(Boolean);

    if (parsed.length !== deps.length) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    applyDerivedUnit(metric, parsed);
  }
}

export async function deriveExpressionUnitsResolved(metrics, fetchMetricUnit) {
  if (typeof fetchMetricUnit !== "function") return;
  const byName = new Map((metrics || []).map((metric) => [metric.name, metric]));
  const unitCache = new Map();
  const resolveUnit = async (name) => {
    const key = String(name || "").trim();
    if (!key) return "";
    if (unitCache.has(key)) return unitCache.get(key);
    let unit = "";
    try {
      unit = String((await fetchMetricUnit(key)) || "").trim();
    } catch (_) {
      unit = "";
    }
    unitCache.set(key, unit);
    return unit;
  };

  for (const metric of metrics || []) {
    if (!metric.expr || keepManualUnitAsIs(metric)) continue;
    if (!expressionSupportsUnitPropagation(metric.expr)) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }
    const depNames = collectDependencies(metric.expr);
    if (depNames.length === 0) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    const parsed = [];
    let failed = false;
    for (const depName of depNames) {
      const local = byName.get(depName);
      const unit = local
        ? String(local.displayUnit || local.unit || "").trim()
        : String(await resolveUnit(depName)).trim();
      const parsedUnit = parseSIUnit(unit);
      if (!parsedUnit) {
        failed = true;
        break;
      }
      parsed.push(parsedUnit);
    }
    if (failed || parsed.length !== depNames.length) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }
    applyDerivedUnit(metric, parsed);
  }
}
