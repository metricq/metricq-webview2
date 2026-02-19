function buildAliasMap(metrics) {
  const baseMetrics = (metrics || []).filter((metric) => !metric.expr);
  const aliases = new Map();
  const start = "a".charCodeAt(0);
  for (let i = 0; i < baseMetrics.length && i < 26; i += 1) {
    aliases.set(String.fromCharCode(start + i), baseMetrics[i].name);
  }
  return aliases;
}

function isAlphaNumUnderscore(char) {
  return /[A-Za-z0-9_]/.test(char);
}

function shouldKeepIdentifier(word) {
  const lowered = word.toLowerCase();
  return lowered === "log" || lowered === "min" || lowered === "max" || lowered === "sum";
}

export function expandExpressionAliases(expression, metrics) {
  const text = String(expression || "");
  if (!text) return "";

  const aliases = buildAliasMap(metrics);
  if (aliases.size === 0) return text;

  let out = "";
  for (let i = 0; i < text.length;) {
    const ch = text[i];

    if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end === -1) {
        out += text.slice(i);
        break;
      }
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && isAlphaNumUnderscore(text[j])) j += 1;
      const word = text.slice(i, j);
      const lowered = word.toLowerCase();
      if (word.length === 1 && aliases.has(lowered) && !shouldKeepIdentifier(word)) {
        out += `[${aliases.get(lowered)}]`;
      } else {
        out += word;
      }
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}
