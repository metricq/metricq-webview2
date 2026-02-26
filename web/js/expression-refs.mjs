const RESERVED_FUNCTIONS = new Set(["log", "min", "max", "sum"]);

export function collectExpressionReferences(expression, reserved = RESERVED_FUNCTIONS) {
  const refs = [];
  const text = String(expression || "");

  const bracketRegex = /\[([^\]]+)\]/g;
  let match = bracketRegex.exec(text);
  while (match) {
    const name = String(match[1] || "").trim();
    if (name) refs.push(name);
    match = bracketRegex.exec(text);
  }

  const bare = text.replace(/\[[^\]]+\]/g, " ");
  const identRegex = /\b([A-Za-z_][A-Za-z0-9_:.\-]*)\b/g;
  let ident = identRegex.exec(bare);
  while (ident) {
    const token = ident[1];
    if (!reserved.has(token.toLowerCase())) refs.push(token);
    ident = identRegex.exec(bare);
  }

  return [...new Set(refs)];
}
