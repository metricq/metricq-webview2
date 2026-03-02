import { dom } from "./dom.js";
import { colors, state } from "./model.js";
import { applyTokenOffset, relativeRangeStart } from "./time-range.mjs";
import { toLocalInput, updateRangeButtonLabel } from "./utils.js";

const URL_STATE_PARAM = "state";
const URL_STATE_PARAM_COMPRESSED = "statez";
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

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toUrlSafeBase64(base64) {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromUrlSafeBase64(urlSafe) {
  const base64 = urlSafe.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  return `${base64}${"=".repeat(padLen)}`;
}

async function gzipBytes(plainBytes) {
  if (typeof CompressionStream !== "function") {
    throw new Error("CompressionStream nicht verfügbar");
  }
  const input = new Blob([plainBytes]).stream();
  const compressed = input.pipeThrough(new CompressionStream("gzip"));
  const ab = await new Response(compressed).arrayBuffer();
  return new Uint8Array(ab);
}

async function gunzipBytes(gzipBytesData) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream nicht verfügbar");
  }
  const input = new Blob([gzipBytesData]).stream();
  const decompressed = input.pipeThrough(new DecompressionStream("gzip"));
  const ab = await new Response(decompressed).arrayBuffer();
  return new Uint8Array(ab);
}

async function encodeCompressedStatePayload(payload) {
  const json = JSON.stringify(payload);
  const utf8 = new TextEncoder().encode(json);
  const gz = await gzipBytes(utf8);
  return bytesToBase64(gz);
}

function normalizeAnyBase64(input) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (raw.includes("-") || raw.includes("_")) return fromUrlSafeBase64(raw);
  return raw;
}

async function decodeCompressedStatePayload(encoded) {
  const gz = base64ToBytes(normalizeAnyBase64(encoded));
  const utf8 = await gunzipBytes(gz);
  const json = new TextDecoder().decode(utf8);
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
    stackMode: raw?.ns ? "normal" : "stack",
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

  if (metric.stackMode === "normal") entry.ns = 1;

  return entry;
}

function serializeYAxis() {
  const stacked = state.yAxisStacked ? 1 : undefined;
  if (state.yAxisMode === "local") return stacked ? { m: "local", s: stacked } : null;
  if (state.yAxisMode === "manual") {
    const min = Number(state.yAxisManualMin);
    const max = Number(state.yAxisManualMax);
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      return { m: "manual", min, max, ...(stacked ? { s: stacked } : {}) };
    }
    return { m: "manual", ...(stacked ? { s: stacked } : {}) };
  }
  if (state.yAxisMode === "global") {
    return { m: "global", ...(stacked ? { s: stacked } : {}) };
  }
  return null;
}

function applyYAxisConfig(y) {
  state.yAxisStacked = Number(y?.s) === 1;
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
    stackMode: "stack",
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

export async function syncUrlStateNow() {
  if (!Number.isFinite(state.from) || !Number.isFinite(state.to) || state.from >= state.to) {
    return;
  }

  const payload = buildPayload();
  const compressedEncoded = await encodeCompressedStatePayload(payload);

  const url = new URL(window.location.href);
  url.searchParams.set(URL_STATE_PARAM_COMPRESSED, compressedEncoded);
  url.searchParams.delete(URL_STATE_PARAM);
  history.replaceState(null, "", url);
}

export function scheduleUrlStateSync() {
  if (syncTimer != null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void syncUrlStateNow();
  }, 0);
}

export async function applyStateFromUrl() {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(URL_STATE_PARAM);
  const encodedCompressed = url.searchParams.get(URL_STATE_PARAM_COMPRESSED);
  if (!encoded && !encodedCompressed) return false;

  let payload;
  try {
    if (encodedCompressed) {
      payload = await decodeCompressedStatePayload(encodedCompressed);
    } else {
      payload = decodeStatePayload(encoded);
    }
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

  // Normalize legacy/plain links to compressed form in the address bar.
  if (encoded && !encodedCompressed) {
    try {
      await syncUrlStateNow();
    } catch (_) {
      // Keep loaded state even if recompression is unavailable.
    }
  }

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

function statusLine(field, status, detail = "") {
  return {
    field,
    status,
    detail: String(detail || ""),
  };
}

export async function inspectUrlStateDebug() {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(URL_STATE_PARAM);
  const encodedCompressed = url.searchParams.get(URL_STATE_PARAM_COMPRESSED);
  if (!encoded && !encodedCompressed) {
    return {
      hasStateParam: false,
      encodedLength: 0,
      decodeOk: false,
      payload: null,
      checks: [statusLine("state", "fehlt", "URL-Parameter `state` ist nicht vorhanden.")],
    };
  }

  const checks = [];
  if (encodedCompressed) {
    checks.push(statusLine("statez", "ok", `Komprimierter Parameter vorhanden (Länge: ${encodedCompressed.length})`));
  } else {
    checks.push(statusLine("state", "ok", `Parameter vorhanden (Länge: ${encoded.length})`));
  }

  let payload = null;
  try {
    if (encodedCompressed) {
      payload = await decodeCompressedStatePayload(encodedCompressed);
      checks.push(statusLine("decode", "ok", "statez erfolgreich entpackt (gzip) und dekodiert."));
    } else {
      payload = decodeStatePayload(encoded);
      checks.push(statusLine("decode", "ok", "Base64 + JSON erfolgreich dekodiert."));
    }
  } catch (err) {
    checks.push(statusLine("decode", "ungültig", err?.message || "Dekodierung fehlgeschlagen."));
    return {
      hasStateParam: true,
      encodedLength: encodedCompressed ? encodedCompressed.length : encoded.length,
      decodeOk: false,
      payload: null,
      checks,
    };
  }

  const version = Number(payload?.v);
  if (Number.isFinite(version)) {
    const status = version === URL_STATE_VERSION ? "ok" : "ungültig";
    checks.push(statusLine("v", status, `Version=${version}, erwartet=${URL_STATE_VERSION}`));
  } else {
    checks.push(statusLine("v", "fehlt", "Versionsfeld fehlt oder ist keine Zahl."));
  }

  const metricsRaw = Array.isArray(payload?.m) ? payload.m : null;
  if (!metricsRaw) {
    checks.push(statusLine("m", "fehlt", "Metrikliste fehlt oder ist kein Array."));
  } else {
    const sanitized = metricsRaw
      .map((entry, index) => sanitizeMetricEntry(entry, index))
      .filter(Boolean);
    const invalidCount = metricsRaw.length - sanitized.length;
    const status = sanitized.length > 0 ? "ok" : "ungültig";
    checks.push(
      statusLine(
        "m",
        status,
        `${metricsRaw.length} Einträge, ${sanitized.length} gültig, ${invalidCount} ungültig.`,
      ),
    );
  }

  const hasRelative = payload?.r != null;
  const hasAbsolute = payload?.f != null || payload?.t != null;
  if (hasRelative && hasAbsolute) {
    checks.push(statusLine("zeit", "ungültig", "Relative und absolute Zeitangaben gleichzeitig vorhanden."));
  } else if (!hasRelative && !hasAbsolute) {
    checks.push(statusLine("zeit", "fehlt", "Weder relative noch absolute Zeitangabe vorhanden."));
  } else if (hasRelative) {
    const amount = Math.max(1, Number.parseInt(String(payload?.r?.a ?? "1"), 10) || 1);
    const unit = String(payload?.r?.u || "h");
    const validUnit = RELATIVE_UNITS.has(unit);
    checks.push(
      statusLine(
        "r",
        validUnit ? "ok" : "ungültig",
        `a=${amount}, u=${unit}${validUnit ? "" : " (unbekannte Einheit)"}`,
      ),
    );
  } else {
    const from = Number(payload?.f);
    const to = Number(payload?.t);
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      checks.push(statusLine("f/t", "ok", `f=${from}, t=${to}, Δ=${to - from} ms`));
    } else {
      checks.push(statusLine("f/t", "ungültig", `f=${payload?.f}, t=${payload?.t}`));
    }
  }

  const renderMode = String(payload?.rm || "").trim().toLowerCase();
  if (!renderMode || renderMode === "standard" || renderMode === "ti") {
    checks.push(statusLine("rm", "ok", renderMode || "standard (implizit)"));
  } else {
    checks.push(statusLine("rm", "ungültig", renderMode));
  }

  const yMode = String(payload?.y?.m || "local");
  if (yMode === "local" || yMode === "global") {
    checks.push(statusLine("y.m", "ok", yMode));
  } else if (yMode === "manual") {
    const min = Number(payload?.y?.min);
    const max = Number(payload?.y?.max);
    const valid = Number.isFinite(min) && Number.isFinite(max) && min < max;
    checks.push(statusLine("y.m", valid ? "ok" : "ungültig", `manual (min=${payload?.y?.min}, max=${payload?.y?.max})`));
  } else {
    checks.push(statusLine("y.m", "ungültig", yMode));
  }
  if (payload?.y?.s != null) {
    checks.push(statusLine("y.s", Number(payload?.y?.s) === 1 ? "ok" : "ungültig", `s=${payload?.y?.s}`));
  } else {
    checks.push(statusLine("y.s", "fehlt", "Stacked-Flag nicht gesetzt (Default: aus)."));
  }

  return {
    hasStateParam: true,
    encodedLength: encodedCompressed ? encodedCompressed.length : encoded.length,
    decodeOk: true,
    payload,
    checks,
  };
}
