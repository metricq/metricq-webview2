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
  const text = String(expr || "").toLowerCase();
  return !text.includes("*") && !text.includes("/") && !/\blog\b/.test(text);
}

export function deriveExpressionUnits(metrics) {
  const byName = new Map((metrics || []).map((metric) => [metric.name, metric]));

  for (const metric of metrics || []) {
    if (!metric.expr || metric.factorMode === "manual") continue;

    if (!expressionSupportsUnitPropagation(metric.expr)) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    const deps = collectDependencies(metric.expr)
      .map((name) => byName.get(name))
      .filter(Boolean);

    if (deps.length === 0) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    const parsed = deps
      .map((dep) => parseSIUnit(dep.unit || dep.displayUnit || ""))
      .filter(Boolean);

    if (parsed.length !== deps.length) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

    const family = parsed[0].family;
    if (parsed.some((p) => p.family !== family)) {
      metric.unit = "";
      metric.displayUnit = "";
      continue;
    }

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

    metric.unit = formatSIUnit(family, bestExp);
    metric.displayUnit = metric.unit;
  }
}
