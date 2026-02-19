import { dom } from "./dom.js";
import { colors, state } from "./model.js";
import { toLocalInput, updateRangeButtonLabel } from "./utils.js";

const URL_STATE_PARAM = "state";
const URL_STATE_VERSION = 1;
const RELATIVE_UNITS = new Set(["m", "h", "d", "w", "M", "y"]);

let syncTimer = null;

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
    color,
    draw,
    drawAvg: true,
    factor: 1,
    factorMode: "auto",
    unit: "",
    displayUnit: "",
    description: expr || "",
  };

  const factor = Number(raw?.f);
  if (String(raw?.fm || "") === "manual" && Number.isFinite(factor)) {
    metric.factor = factor;
    metric.factorMode = "manual";
  }

  return metric;
}

function serializeMetricEntry(metric, index) {
  const entry = { n: metric.name };
  if (metric.expr) entry.e = metric.expr;

  const color = String(metric.color || "").toLowerCase();
  if (color) entry.c = metric.color;

  if (!metric.draw) entry.h = 1;

  if (metric.factorMode === "manual") {
    const factor = Number(metric.factor);
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
    f: Math.round(state.from),
    t: Math.round(state.to),
    m: state.metrics.map((metric, index) => serializeMetricEntry(metric, index)),
  };

  const y = serializeYAxis();
  if (y) payload.y = y;
  const rel = serializeRelative();
  if (rel) payload.r = rel;

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
    return false;
  }

  if (!applyRelativeConfig(payload?.r)) {
    const from = Number(payload?.f);
    const to = Number(payload?.t);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      return false;
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

  applyYAxisConfig(payload?.y);

  return true;
}
