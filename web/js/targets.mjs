export function expressionTokenForMetric(name) {
  return `[${String(name || "").trim()}]`;
}

const RESERVED_FUNCTIONS = new Set(["log", "min", "max", "sum"]);

function formatFactor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(12).replace(/\.?0+$/, "");
}

function buildFactorMap(metrics) {
  const map = new Map();
  for (const metric of metrics || []) {
    const name = String(metric?.name || "").trim();
    if (!name) continue;
    const factorText = formatFactor(metric?.factor);
    if (!factorText) continue;
    map.set(name, factorText);
  }
  return map;
}

function wrapScaledMetric(metricName, factorText) {
  return `([${metricName}]*${factorText})`;
}

export function buildComputedExpression(expression, metrics) {
  const text = String(expression || "");
  if (!text) return "";
  const factorMap = buildFactorMap(metrics);
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
      const factor = factorMap.get(name);
      out += factor ? wrapScaledMetric(name, factor) : text.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_:.\\-]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      const factor = RESERVED_FUNCTIONS.has(lower) ? null : factorMap.get(word);
      out += factor ? wrapScaledMetric(word, factor) : word;
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
