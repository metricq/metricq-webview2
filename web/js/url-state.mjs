import { dom } from "./dom.js";
import { colors, state } from "./model.js";
import { toLocalInput, updateRangeButtonLabel } from "./utils.js";

const URL_STATE_PARAM = "state";
const URL_STATE_VERSION = 1;
const RELATIVE_UNITS = new Set(["m", "h", "d", "w", "M", "y"]);

let syncTimer = null;

export class InvalidUrlStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidUrlStateError";
  }
}

function defaultColorAt(index) {
  return colors[index % colors.length].toLowerCase();
}

function encodeStatePayload(payload) {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeStatePayload(encoded) {
  const json = decodeURIComponent(escape(atob(encoded)));
  return JSON.parse(json);
}

function sanitizeMetricEntry(raw, index) {
  const name = String(raw?.n || "").trim();
  if (!name) return null;

  const expr = String(raw?.e || "").trim();
  const color = String(raw?.c || "").trim() || defaultColorAt(index);
  const draw = raw?.h ? false : true;

  const metric = {
    name,
    expr,
    alias: "",
    color,
    draw,
    drawAvg: true,
    factor: 1,
    manualFactor: 1,
    factorMode: "auto",
    unit: "",
    displayUnit: "",
    description: expr || "",
  };
  if (!expr) {
    metric.alias = String(raw?.a || "").trim();
  }

  const factor = Number(raw?.f);
  if (String(raw?.fm || "") === "manual" && Number.isFinite(factor)) {
    metric.manualFactor = factor;
    metric.factorMode = "manual";
  } else if (raw?.pf != null) {
    // Backward compatibility with older links using `pf`.
    const postFactor = Number(raw.pf);
    if (Number.isFinite(postFactor)) {
      metric.manualFactor = postFactor;
      metric.factorMode = "manual";
    }
  }

  return metric;
}

function serializeMetricEntry(metric, index) {
  const entry = { n: metric.name };
  if (metric.expr) entry.e = metric.expr;
  if (!metric.expr) {
    const alias = String(metric.alias || "").trim();
    if (alias) entry.a = alias;
  }

  const color = String(metric.color || "").toLowerCase();
  if (color) entry.c = metric.color;

  if (!metric.draw) entry.h = 1;

  if (metric.factorMode === "manual") {
    const factor = Number(metric.manualFactor);
    if (Number.isFinite(factor) && Math.abs(factor - 1) > 1e-12) {
      entry.fm = "manual";
      entry.f = Number(factor.toPrecision(12));
    }
  }

  return entry;
}

function serializeYAxis() {
  if (state.yAxisMode === "local") return null;
  if (state.yAxisMode === "manual") {
    const min = Number(state.yAxisManualMin);
    const max = Number(state.yAxisManualMax);
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      return { m: "manual", min, max };
    }
    return { m: "manual" };
  }
  if (state.yAxisMode === "global") {
    return { m: "global" };
  }
  return null;
}

function applyYAxisConfig(y) {
  if (!y || y.m === "local") {
    state.yAxisMode = "local";
    state.yAxisManualMin = null;
    state.yAxisManualMax = null;
    return;
  }

  if (y.m === "manual") {
    state.yAxisMode = "manual";
    const min = Number(y.min);
    const max = Number(y.max);
    state.yAxisManualMin = Number.isFinite(min) ? min : null;
    state.yAxisManualMax = Number.isFinite(max) ? max : null;
    return;
  }

  if (y.m === "global") {
    state.yAxisMode = "global";
    state.yAxisManualMin = null;
    state.yAxisManualMax = null;
  }
}

function buildPayload() {
  const payload = {
    v: URL_STATE_VERSION,
    m: state.metrics.map((metric, index) => serializeMetricEntry(metric, index)),
  };
  if (state.renderMode === "ti") payload.rm = "ti";

  if (state.timeMode === "relative") {
    const rel = serializeRelative();
    if (rel) payload.r = rel;
  } else {
    payload.f = Math.round(state.from);
    payload.t = Math.round(state.to);
  }

  const y = serializeYAxis();
  if (y) payload.y = y;

  return payload;
}

function serializeRelative() {
  if (state.timeMode !== "relative") return null;
  const amount = Math.max(1, Number.parseInt(dom.relativeAmount?.value || "0", 10) || 1);
  const unit = String(dom.relativeUnit?.value || "h");
  if (!RELATIVE_UNITS.has(unit)) return null;
  return { a: amount, u: unit };
}

function relativeRangeStart(now, amount, unit) {
  const from = new Date(now);
  if (unit === "M") {
    from.setMonth(from.getMonth() - amount);
    return from.getTime();
  }
  if (unit === "y") {
    from.setFullYear(from.getFullYear() - amount);
    return from.getTime();
  }
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
  const delta = (unitMs[unit] || unitMs.h) * amount;
  return now - delta;
}

function applyTokenOffset(date, offset) {
  const match = /^([+-])(\d+)([mhdwMy])$/.exec(String(offset || "").trim());
  if (!match) return date;
  const sign = match[1] === "-" ? -1 : 1;
  const value = sign * Number.parseInt(match[2], 10);
  const unit = match[3];
  const out = new Date(date);
  if (unit === "m") out.setMinutes(out.getMinutes() + value);
  else if (unit === "h") out.setHours(out.getHours() + value);
  else if (unit === "d") out.setDate(out.getDate() + value);
  else if (unit === "w") out.setDate(out.getDate() + value * 7);
  else if (unit === "M") out.setMonth(out.getMonth() + value);
  else if (unit === "y") out.setFullYear(out.getFullYear() + value);
  return out;
}

function parseLegacyTimeExpr(expr, nowMs) {
  const value = String(expr || "").trim();
  if (!value) return null;
  if (value === "now") return nowMs;

  const rel = /^now([+-]\d+[mhdwMy])$/.exec(value);
  if (rel) return applyTokenOffset(new Date(nowMs), rel[1]).getTime();

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    if (asNumber > 1e12) return Math.round(asNumber);
    if (asNumber > 1e9) return Math.round(asNumber * 1000);
  }

  const asDate = new Date(value).getTime();
  if (Number.isFinite(asDate)) return asDate;
  return null;
}

function splitLegacyHashParts(hash) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < hash.length; i += 1) {
    const ch = hash[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "*" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function parseLegacyMetricToken(token, index) {
  let raw = String(token || "").trim();
  if (!raw) return null;
  if (raw.startsWith("(") && raw.endsWith(")")) raw = raw.slice(1, -1).trim();
  if (!raw) return null;

  const [nameRaw, factorRaw] = raw.split("~", 2);
  const name = String(nameRaw || "").trim();
  if (!name) return null;
  const metric = {
    name,
    expr: "",
    alias: "",
    color: defaultColorAt(index),
    draw: true,
    drawAvg: true,
    factor: 1,
    manualFactor: 1,
    factorMode: "auto",
    unit: "",
    displayUnit: "",
    description: "",
  };
  const factor = Number(factorRaw);
  if (Number.isFinite(factor) && Math.abs(factor - 1) > 1e-12) {
    metric.factorMode = "manual";
    metric.manualFactor = factor;
  }
  return metric;
}

function applyRelativeConfig(r) {
  const amount = Math.max(1, Number.parseInt(String(r?.a ?? "1"), 10) || 1);
  const unit = String(r?.u || "h");
  if (!RELATIVE_UNITS.has(unit)) return false;

  const now = Date.now();
  const from = relativeRangeStart(now, amount, unit);
  const to = now;

  state.timeMode = "relative";
  state.from = from;
  state.to = to;
  if (dom.relativeAmount) dom.relativeAmount.value = String(amount);
  if (dom.relativeUnit) dom.relativeUnit.value = unit;
  dom.fromInput.value = toLocalInput(new Date(from));
  dom.toInput.value = toLocalInput(new Date(to));
  updateRangeButtonLabel();
  return true;
}

export function syncUrlStateNow() {
  if (!Number.isFinite(state.from) || !Number.isFinite(state.to) || state.from >= state.to) {
    return;
  }

  const payload = buildPayload();
  const encoded = encodeStatePayload(payload);

  const url = new URL(window.location.href);
  url.searchParams.set(URL_STATE_PARAM, encoded);
  history.replaceState(null, "", url);
}

export function scheduleUrlStateSync() {
  if (syncTimer != null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    syncUrlStateNow();
  }, 0);
}

export function applyStateFromUrl() {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(URL_STATE_PARAM);
  if (!encoded) return false;

  let payload;
  try {
    payload = decodeStatePayload(encoded);
  } catch (_) {
    throw new InvalidUrlStateError("Der Link-Status ist ungültig und konnte nicht geladen werden.");
  }

  const hasRelative = payload?.r != null;
  const hasAbsolute = payload?.f != null || payload?.t != null;
  if (hasRelative && hasAbsolute) {
    throw new InvalidUrlStateError("Der Link enthält widersprüchliche Zeitangaben und konnte nicht geladen werden.");
  }
  if (!hasRelative && !hasAbsolute) {
    throw new InvalidUrlStateError("Der Link enthält keine gültige Zeitangabe und konnte nicht geladen werden.");
  }

  if (hasRelative) {
    if (!applyRelativeConfig(payload?.r)) {
      throw new InvalidUrlStateError("Der Link enthält einen ungültigen relativen Zeitraum und konnte nicht geladen werden.");
    }
  } else {
    const from = Number(payload?.f);
    const to = Number(payload?.t);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new InvalidUrlStateError("Der Link enthält einen ungültigen Zeitraum und konnte nicht geladen werden.");
    }

    state.timeMode = "absolute";
    state.from = from;
    state.to = to;
    dom.fromInput.value = toLocalInput(new Date(from));
    dom.toInput.value = toLocalInput(new Date(to));
    updateRangeButtonLabel();
  }

  const metricEntries = Array.isArray(payload?.m) ? payload.m : [];
  state.metrics = metricEntries
    .map((entry, index) => sanitizeMetricEntry(entry, index))
    .filter(Boolean);

  const renderMode = String(payload?.rm || "").trim().toLowerCase();
  state.renderMode = renderMode === "ti" ? "ti" : "standard";

  applyYAxisConfig(payload?.y);

  return true;
}

export function applyLegacyWebviewHashFallback() {
  const url = new URL(window.location.href);
  if (url.searchParams.has(URL_STATE_PARAM)) return false;

  const hash = String(url.hash || "");
  if (!hash.startsWith("#.")) return false;

  const payload = hash.slice(2).trim();
  if (!payload) return false;
  const parts = splitLegacyHashParts(payload);
  if (parts.length < 3) return false;

  const now = Date.now();
  const from = parseLegacyTimeExpr(parts[0], now);
  const to = parseLegacyTimeExpr(parts[1], now);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return false;

  const rel = /^now-(\d+)([mhdwMy])$/.exec(String(parts[0] || "").trim());
  const isRelative = rel && String(parts[1] || "").trim() === "now";

  state.timeMode = isRelative ? "relative" : "absolute";
  state.from = from;
  state.to = to;
  dom.fromInput.value = toLocalInput(new Date(from));
  dom.toInput.value = toLocalInput(new Date(to));
  if (isRelative && dom.relativeAmount && dom.relativeUnit) {
    dom.relativeAmount.value = String(Number.parseInt(rel[1], 10));
    dom.relativeUnit.value = rel[2];
  }
  updateRangeButtonLabel();

  state.metrics = parts
    .slice(2)
    .map((item, index) => parseLegacyMetricToken(item, index))
    .filter(Boolean);
  state.renderMode = "standard";

  return state.metrics.length > 0;
}
