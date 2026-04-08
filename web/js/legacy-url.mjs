function encodeJsUrlString(value) {
  return !/[^\w-.]/.test(value)
    ? value
    : value.replace(/[^\w-.]/g, (ch) => {
        if (ch === "$") return "!";
        const code = ch.charCodeAt(0);
        return code < 0x100
          ? `*${(`00${code.toString(16)}`).slice(-2)}`
          : `**${(`0000${code.toString(16)}`).slice(-4)}`;
      });
}

export function stringifyJsUrl(value) {
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? `~${value}` : "~null";
    case "boolean":
      return `~${value}`;
    case "string":
      return `~'${encodeJsUrlString(value)}`;
    case "object":
      if (!value) return "~null";
      if (Array.isArray(value)) {
        const items = value.map((entry) => stringifyJsUrl(entry) || "~null").join("");
        return `~(${items || "~"})`;
      }
      return `~(${Object.keys(value)
        .map((key) => {
          const encoded = stringifyJsUrl(value[key]);
          return encoded ? `${encodeJsUrlString(key)}${encoded}` : "";
        })
        .filter(Boolean)
        .join("~")})`;
    default:
      return "";
  }
}

export function collectLegacyCompatibleMetrics(metrics) {
  return (Array.isArray(metrics) ? metrics : [])
    .filter((metric) => metric && metric.draw !== false)
    .filter((metric) => !String(metric.expr || "").trim())
    .map((metric) => String(metric.name || "").trim())
    .filter(Boolean);
}

export function buildLegacyChartsUrl(baseUrl, view, currentUrl = "http://localhost/") {
  const trimmedBaseUrl = String(baseUrl || "").trim();
  if (!trimmedBaseUrl) return null;

  const counters = collectLegacyCompatibleMetrics(view?.metrics);
  if (counters.length === 0) return null;

  const start = Number(view?.from);
  const stop = Number(view?.to);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || start >= stop) {
    return null;
  }

  const payload = {
    cntr: counters,
    start: Math.round(start),
    stop: Math.round(stop),
    type: "default",
  };

  const url = new URL(trimmedBaseUrl, currentUrl);
  url.hash = `${stringifyJsUrl(payload)}-`;
  return url.toString();
}
