import { LEGEND_MIN_VIEWPORT_PX } from "./collapsed-legend.js";
import { dom } from "./dom.js";
import { shownMetricFactor } from "./factor-format.mjs";
import {
  metricDisplayName,
  metricRenderShowsBands,
  metricRenderShowsCounts,
  metricShownUnit,
  state,
  yAxisStackingActive,
} from "./model.js";
import { formatFixed, formatNumber } from "./number-format.mjs";
import {
  buildXTicks,
  formatAbsoluteTime,
  formatAxisTime,
  pickTimeTickStep,
} from "./time-axis.mjs";
import { toLocalInput, updateRangeButtonLabel } from "./time-range-ui.mjs";
import { resolveYAxisDomain } from "./y-axis.mjs";

export const MIN_ZOOM_RANGE_MS = 1000;
export const MAX_ZOOM_RANGE_MS = 1000 * 3600 * 24 * 365 * 25;

const CANDLE_DOWN_ALPHA = 0.35;

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ""));
  if (!m) return { r: 38, g: 67, b: 233 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

let lastHoverClientX = null;
let lastHoverClientY = null;
let lastLayout = null;
let lastStackedByMetric = null;
let hoverPointEl = null;
let hoverCursorLineEl = null;
let hoverCandleEls = [];
let chartLoadingEl = null;
let chartErrorEl = null;
let hoverRafId = 0;
let colorSampleCtx = null;
let helpMinimizeTimerId = null;
let helpMinimizeRenderActive = false;
let hoverBoxContentKey = "";
let hoverBoxWidth = 220;
let hoverBoxHeight = 120;
const rgbaCache = new Map();

function cssColorWithAlpha(color, alpha) {
  const key = `${String(color || "")}|${Number(alpha)}`;
  if (rgbaCache.has(key)) return rgbaCache.get(key);
  if (!colorSampleCtx) {
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    colorSampleCtx = sampleCanvas.getContext("2d");
  }
  if (!colorSampleCtx) {
    const fallback = `rgba(0, 0, 0, ${alpha})`;
    rgbaCache.set(key, fallback);
    return fallback;
  }
  colorSampleCtx.clearRect(0, 0, 1, 1);
  colorSampleCtx.fillStyle = "#000000";
  colorSampleCtx.fillRect(0, 0, 1, 1);
  colorSampleCtx.fillStyle = String(color || "#000000");
  colorSampleCtx.fillRect(0, 0, 1, 1);
  const px = colorSampleCtx.getImageData(0, 0, 1, 1).data;
  const out = `rgba(${px[0]}, ${px[1]}, ${px[2]}, ${alpha})`;
  rgbaCache.set(key, out);
  return out;
}

function ensureHoverPointEl() {
  if (hoverPointEl) return hoverPointEl;
  hoverPointEl = document.createElement("div");
  hoverPointEl.className = "hover-point d-none";
  dom.chartWrap.appendChild(hoverPointEl);
  return hoverPointEl;
}

function positionHoverPoint(x, y, color) {
  const point = ensureHoverPointEl();
  point.classList.remove("d-none");
  point.style.left = `${x}px`;
  point.style.top = `${y}px`;
  point.style.borderColor = color || "#111111";
}

function hideHoverPoint() {
  if (hoverPointEl) hoverPointEl.classList.add("d-none");
}

function ensureHoverCursorLineEl() {
  if (hoverCursorLineEl) return hoverCursorLineEl;
  hoverCursorLineEl = document.createElement("div");
  hoverCursorLineEl.className = "hover-cursor-line d-none";
  dom.chartWrap.appendChild(hoverCursorLineEl);
  return hoverCursorLineEl;
}

function positionHoverCursorLine(x, top, height) {
  const line = ensureHoverCursorLineEl();
  line.classList.remove("d-none");
  line.style.left = `${x}px`;
  line.style.top = `${top}px`;
  line.style.height = `${Math.max(1, height)}px`;
}

function hideHoverCursorLine() {
  if (hoverCursorLineEl) hoverCursorLineEl.classList.add("d-none");
}

// A pool of highlight boxes, one per hovered candle. Candlestick mode is
// commonly used with several overlaid metrics, and each one can have its own
// candle under the cursor, so a single reused element isn't enough.
function ensureHoverCandleEl(index) {
  while (hoverCandleEls.length <= index) {
    const el = document.createElement("div");
    el.className = "hover-candle d-none";
    dom.chartWrap.appendChild(el);
    hoverCandleEls.push(el);
  }
  return hoverCandleEls[index];
}

function positionHoverCandle(index, x, top, width, height, color) {
  const box = ensureHoverCandleEl(index);
  box.classList.remove("d-none");
  box.style.left = `${x - width / 2}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.style.borderColor = color || "#111111";
}

function hideHoverCandle(fromIndex = 0) {
  for (let i = fromIndex; i < hoverCandleEls.length; i += 1) {
    hoverCandleEls[i].classList.add("d-none");
  }
}

function setHoverBoxHtml(html) {
  const next = String(html || "");
  if (next !== hoverBoxContentKey) {
    dom.hoverBox.innerHTML = next;
    hoverBoxContentKey = next;
    hoverBoxWidth = dom.hoverBox.offsetWidth || 220;
    hoverBoxHeight = dom.hoverBox.offsetHeight || 120;
  }
  dom.hoverBox.classList.remove("d-none");
}

function ensureChartLoadingEl() {
  if (chartLoadingEl) return chartLoadingEl;
  chartLoadingEl = document.createElement("div");
  chartLoadingEl.className = "chart-loading-state d-none";
  chartLoadingEl.innerHTML = `
    <div class="spinner-border text-secondary chart-loading-spinner" role="status" aria-hidden="true"></div>
  `;
  dom.chartWrap.appendChild(chartLoadingEl);
  return chartLoadingEl;
}

function setChartLoadingVisible(visible) {
  const el = ensureChartLoadingEl();
  el.classList.toggle("d-none", !visible);
}

function ensureChartErrorEl() {
  if (chartErrorEl) return chartErrorEl;
  chartErrorEl = document.createElement("div");
  chartErrorEl.className = "chart-error-state d-none";
  chartErrorEl.innerHTML = `
    <div class="chart-error-card">
      <div class="chart-error-title">Verbindung zum Backend fehlgeschlagen</div>
      <div class="chart-error-text" id="chartErrorText">Bitte Seite neu laden.</div>
      <button class="btn btn-sm btn-danger" id="btnChartErrorReload" type="button">Neu laden</button>
    </div>
  `;
  dom.chartWrap.appendChild(chartErrorEl);
  const btn = chartErrorEl.querySelector("#btnChartErrorReload");
  btn?.addEventListener("click", () => window.location.reload());
  return chartErrorEl;
}

function setChartErrorVisible(message, kind = "backend") {
  const el = ensureChartErrorEl();
  const titleEl = el.querySelector(".chart-error-title");
  const textEl = el.querySelector("#chartErrorText");
  const reloadBtn = el.querySelector("#btnChartErrorReload");
  const isMetricError = kind === "metric";
  el.classList.toggle("is-metric-error", isMetricError);
  if (titleEl) {
    titleEl.textContent = isMetricError
      ? "Einzelne Metriken konnten nicht geladen werden"
      : "Verbindung zum Backend fehlgeschlagen";
  }
  if (textEl) {
    textEl.textContent = String(message || "Bitte Seite neu laden.");
  }
  if (reloadBtn) reloadBtn.classList.toggle("d-none", isMetricError);
  el.classList.toggle("d-none", !message);
}

function updateCollapsedLegendFade(clientX, clientY) {
  if (state.renderMode === "ti") return;
  const legend = dom.collapsedLegend;
  if (!legend || legend.classList.contains("d-none")) return;
  const rect = legend.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const overLegend =
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom;
  legend.classList.toggle("is-faded", overLegend);
}

function getVisibleSeries() {
  const arr = [];
  for (const metric of state.metrics) {
    if (!metric.draw) continue;
    const series = state.series.get(metric.name);
    if (!series || series.error) continue;
    arr.push({ metric, series });
  }
  return arr;
}

function filterSeriesForVisibleRange(seriesList, tiMode) {
  const from = state.from;
  const to = state.to;
  const filtered = [];
  for (const item of seriesList) {
    const { metric, series } = item;
    if (series.mode === "values") {
      const points = series.points || [];
      const kept = [];
      for (let i = 0; i < points.length; i += 1) {
        const t = seriesSampleTime(points, i, series, tiMode);
        if (t < from || t > to) continue;
        kept.push(points[i]);
      }
      filtered.push({ metric, series: { ...series, points: kept } });
      continue;
    }

    const aggregatePoints = series.aggregatePoints || [];
    const kept = [];
    for (let i = 0; i < aggregatePoints.length; i += 1) {
      const t = seriesSampleTime(aggregatePoints, i, series, tiMode);
      if (t < from || t > to) continue;
      kept.push(aggregatePoints[i]);
    }
    filtered.push({ metric, series: { ...series, aggregatePoints: kept } });
  }
  return filtered;
}

function seriesSampleTime(points, index, series, tiMode) {
  if (tiMode) return points?.[index]?.t;
  if (yAxisStackingActive()) return points?.[index]?.t;
  const isAggregateSeries = series?.mode === "aggregates";
  const isComputedValuesSeries =
    series?.mode === "values" &&
    String(series?.stats?.type || "") === "computed";
  if (isAggregateSeries || isComputedValuesSeries)
    return aggregateDisplayTime(points, index, series);
  return points?.[index]?.t;
}

function buildSemanticSamples(metric, series, tiMode) {
  const samples = [];
  if (series.mode === "values") {
    const points = series.points || [];
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const t = seriesSampleTime(points, i, series, tiMode);
      if (!Number.isFinite(t)) continue;
      const value = pointRenderValue(metric, series, point, "avg", {
        points,
        index: i,
      });
      if (!Number.isFinite(value)) continue;
      samples.push({ t, avg: value, min: value, max: value });
    }
    return samples;
  }

  const points = series.aggregatePoints || [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (Number(point.count) === 0) continue;
    const t = seriesSampleTime(points, i, series, tiMode);
    if (!Number.isFinite(t)) continue;
    const avg = pointRenderValue(metric, series, point, "avg");
    const min = pointRenderValue(metric, series, point, "min");
    const max = pointRenderValue(metric, series, point, "max");
    if (
      !Number.isFinite(avg) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max)
    ) {
      continue;
    }
    samples.push({
      t,
      avg,
      min,
      max,
    });
  }
  return samples;
}

function valueSeriesFrequency(points, index) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const curr = points[index];
  if (!curr) return null;
  const candidateDeltas = [];
  if (index > 0) candidateDeltas.push(Number(curr.t) - Number(points[index - 1]?.t));
  if (index + 1 < points.length) candidateDeltas.push(Number(points[index + 1]?.t) - Number(curr.t));
  for (const deltaMs of candidateDeltas) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) continue;
    return 1000 / deltaMs;
  }
  return null;
}

function pointRenderValue(metric, series, point, kind = "avg", context = {}) {
  if (!point) return null;
  if (series?.mode === "values") {
    if (metricRenderShowsCounts()) {
      return valueSeriesFrequency(context.points, context.index);
    }
    const value = Number(point.v) * metric.factor;
    return Number.isFinite(value) ? value : null;
  }
  const count = Number(point.count);
  if (!Number.isFinite(count) || count <= 0) return null;
  if (metricRenderShowsCounts()) {
    const activeTimeMs = Number(point.activeTimeMs);
    if (!Number.isFinite(activeTimeMs) || activeTimeMs <= 0) return null;
    return count / (activeTimeMs / 1000);
  }
  const raw =
    kind === "min"
      ? Number(point.min)
      : kind === "max"
        ? Number(point.max)
        : Number(point.avg);
  const value = raw * metric.factor;
  return Number.isFinite(value) ? value : null;
}

function formatHoverInterval(activeTimeMs) {
  const ms = Number(activeTimeMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const units = [
    { size: 24 * 60 * 60 * 1000, label: "d" },
    { size: 60 * 60 * 1000, label: "h" },
    { size: 60 * 1000, label: "min" },
    { size: 1000, label: "s" },
    { size: 1, label: "ms" },
  ];
  for (const unit of units) {
    if (ms < unit.size && unit.label !== "ms") continue;
    const raw = ms / unit.size;
    const rounded =
      raw >= 10 || Math.abs(raw - Math.round(raw)) < 1e-9
        ? Math.round(raw)
        : Math.round(raw * 10) / 10;
    return `${rounded} ${unit.label}`;
  }
  return `${Math.round(ms)} ms`;
}

function frequencyIntervalText(rateHz) {
  const rate = Number(rateHz);
  if (!Number.isFinite(rate) || rate <= 0) return "";
  return formatHoverInterval(1000 / rate);
}

function sampleLastValue(samples, t) {
  if (!Array.isArray(samples) || samples.length === 0 || !Number.isFinite(t))
    return null;
  if (samples.length === 1) {
    return t === samples[0].t ? samples[0] : null;
  }

  let lo = 1;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo;
  if (idx <= 0 || idx >= samples.length) return null;
  const prev = samples[idx - 1];
  const curr = samples[idx];
  if (t < prev.t || t > curr.t) return null;
  return curr;
}

function collectTimelineTimes(sampleSets) {
  const uniq = new Set();
  for (const samples of sampleSets) {
    for (const sample of samples || []) {
      if (Number.isFinite(sample?.t)) uniq.add(sample.t);
    }
  }
  return Array.from(uniq).sort((a, b) => a - b);
}

function createTypedStackedEntry(capacity, stacksInYAxis, samples = []) {
  return {
    times: new Float64Array(Math.max(0, capacity)),
    avgValues: new Float64Array(Math.max(0, capacity)),
    baseValues: new Float64Array(Math.max(0, capacity)),
    minValues: new Float64Array(Math.max(0, capacity)),
    maxValues: new Float64Array(Math.max(0, capacity)),
    valid: new Uint8Array(Math.max(0, capacity)),
    length: 0,
    stacksInYAxis,
    samples,
  };
}

function lookupTypedTimeIndex(times, length, t) {
  if (!times || !Number.isFinite(t) || length <= 0) return -1;
  let lo = 0;
  let hi = length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = times[mid];
    if (value < t) lo = mid + 1;
    else if (value > t) hi = mid - 1;
    else return mid;
  }
  return -1;
}

function stackedEntryValueAt(entry, type, t) {
  if (!entry || !Number.isFinite(t)) return null;
  const idx = lookupTypedTimeIndex(entry.times, Number(entry.length) || 0, t);
  if (idx < 0 || entry.valid[idx] !== 1) return null;
  const values = stackedValuesArray(entry, type);
  const value = values[idx];
  return Number.isFinite(value) ? value : null;
}

function stackedValuesArray(entry, type) {
  if (type === "min") return entry.minValues;
  if (type === "max") return entry.maxValues;
  if (type === "base") return entry.baseValues;
  return entry.avgValues;
}

function createSequentialStackedLookup(entry, type = "avg") {
  if (!entry) return null;
  const times = entry.times;
  const valid = entry.valid;
  const values = stackedValuesArray(entry, type);
  const length = Number(entry.length) || 0;
  let idx = 0;
  let lastT = Number.NEGATIVE_INFINITY;
  return (t) => {
    if (!Number.isFinite(t) || length <= 0) return null;
    // Keep fast forward-only lookup for render loops, but recover on out-of-order calls.
    if (t < lastT) idx = 0;
    lastT = t;
    while (idx < length && times[idx] < t) idx += 1;
    if (idx >= length || times[idx] !== t || valid[idx] !== 1) return null;
    const value = values[idx];
    return Number.isFinite(value) ? value : null;
  };
}

function fallbackStackedLookup(stackedSeries, tx) {
  return yAxisStackingActive() && stackedSeries?.stacksInYAxis
    ? stackedEntryValueAt(stackedSeries, "avg", tx)
    : null;
}

function resolveSeriesValueForRender(stackedAvgAt, stackedSeries, tx, raw) {
  if (stackedAvgAt) {
    const stacked = stackedAvgAt(tx);
    return Number.isFinite(stacked) ? stacked : raw;
  }
  const stacked = fallbackStackedLookup(stackedSeries, tx);
  return Number.isFinite(stacked) ? stacked : raw;
}

function buildStackedSeries(seriesList, tiMode, clipToVisible = false) {
  const byMetric = new Map();
  const sampleByMetric = new Map();
  for (const item of seriesList) {
    sampleByMetric.set(
      item.metric.name,
      buildSemanticSamples(item.metric, item.series, tiMode),
    );
  }

  const stackedItems = seriesList
    .filter((item) => item.metric.stackMode !== "normal")
    .slice()
    .reverse();
  const nonStackedItems = seriesList.filter(
    (item) => item.metric.stackMode === "normal",
  );
  const aligned = state.stackedAligned;
  const alignedTimes = Array.isArray(aligned?.times) ? aligned.times : [];
  const alignedMetrics = Array.isArray(aligned?.metrics) ? aligned.metrics : [];
  const alignedValues = Array.isArray(aligned?.values) ? aligned.values : [];
  const alignedByMetric = new Map();
  for (let i = 0; i < alignedMetrics.length; i += 1) {
    const name = String(alignedMetrics[i] || "");
    const row = alignedValues[i];
    if (!name || !Array.isArray(row)) continue;
    alignedByMetric.set(name, row);
  }
  const canUseAligned =
    stackedItems.length > 0 &&
    stackedItems.every((item) => alignedByMetric.has(item.metric.name));
  if (canUseAligned) {
    const from = state.from;
    const to = state.to;
    let alignedLen = alignedTimes.length;
    if (clipToVisible) {
      alignedLen = 0;
      for (let i = 0; i < alignedTimes.length; i += 1) {
        const t = alignedTimes[i];
        if (t >= from && t <= to) alignedLen += 1;
      }
    }
    const stackedConfigs = stackedItems.map((item) => ({
      metric: item.metric,
      row: alignedByMetric.get(item.metric.name) || [],
      entry: createTypedStackedEntry(alignedLen, true),
    }));
    let write = 0;
    for (let i = 0; i < alignedTimes.length; i += 1) {
      const t = alignedTimes[i];
      if (clipToVisible && (t < from || t > to)) continue;
      let hasGapAtT = false;
      for (const cfg of stackedConfigs) {
        const raw = cfg.row[i];
        if (raw == null || !Number.isFinite(Number(raw))) {
          hasGapAtT = true;
          break;
        }
      }
      if (hasGapAtT) {
        for (const cfg of stackedConfigs) {
          const { entry } = cfg;
          entry.times[write] = t;
          entry.avgValues[write] = Number.NaN;
          entry.baseValues[write] = Number.NaN;
          entry.minValues[write] = Number.NaN;
          entry.maxValues[write] = Number.NaN;
          entry.valid[write] = 0;
        }
        write += 1;
        continue;
      }
      let base = 0;
      for (const cfg of stackedConfigs) {
        const raw = Number(cfg.row[i]);
        const scaled = raw * cfg.metric.factor;
        const upper = base + scaled;
        const { entry } = cfg;
        entry.times[write] = t;
        entry.avgValues[write] = upper;
        entry.baseValues[write] = base;
        entry.minValues[write] = upper;
        entry.maxValues[write] = upper;
        entry.valid[write] = 1;
        base = upper;
      }
      write += 1;
    }
    for (const cfg of stackedConfigs) {
      cfg.entry.length = write;
      byMetric.set(cfg.metric.name, cfg.entry);
    }
  } else {
    const stackedConfigs = stackedItems.map((item) => ({
      metric: item.metric,
      samples: sampleByMetric.get(item.metric.name) || [],
      entry: null,
    }));
    const stackedTimes = collectTimelineTimes(
      stackedConfigs.map((cfg) => cfg.samples),
    );
    for (const cfg of stackedConfigs)
      cfg.entry = createTypedStackedEntry(
        stackedTimes.length,
        true,
        cfg.samples,
      );
    for (let i = 0; i < stackedTimes.length; i += 1) {
      const t = stackedTimes[i];
      const valuesAtT = new Float64Array(stackedConfigs.length);
      let hasMissingAtT = false;
      for (let j = 0; j < stackedConfigs.length; j += 1) {
        const current = sampleLastValue(stackedConfigs[j].samples, t);
        const avg = current?.avg;
        if (Number.isFinite(avg)) {
          valuesAtT[j] = Number(avg);
        } else {
          hasMissingAtT = true;
          break;
        }
      }

      if (hasMissingAtT) {
        for (const cfg of stackedConfigs) {
          const { entry } = cfg;
          entry.times[i] = t;
          entry.avgValues[i] = Number.NaN;
          entry.baseValues[i] = Number.NaN;
          entry.minValues[i] = Number.NaN;
          entry.maxValues[i] = Number.NaN;
          entry.valid[i] = 0;
        }
        continue;
      }

      let base = 0;
      for (let j = 0; j < stackedConfigs.length; j += 1) {
        const cfg = stackedConfigs[j];
        const avg = valuesAtT[j];
        const upper = base + avg;
        const { entry } = cfg;
        entry.times[i] = t;
        entry.avgValues[i] = upper;
        entry.baseValues[i] = base;
        entry.minValues[i] = upper;
        entry.maxValues[i] = upper;
        entry.valid[i] = 1;
        base = upper;
      }
    }
    for (const cfg of stackedConfigs) {
      cfg.entry.length = stackedTimes.length;
      byMetric.set(cfg.metric.name, cfg.entry);
    }
  }

  for (const item of nonStackedItems) {
    const { metric } = item;
    const samples = sampleByMetric.get(metric.name) || [];
    const times = collectTimelineTimes([samples]);
    const entry = createTypedStackedEntry(times.length, false, samples);
    for (const t of times) {
      const current = sampleLastValue(samples, t);
      if (!current) continue;
      const write = entry.length;
      entry.times[write] = t;
      entry.avgValues[write] = current.avg;
      entry.baseValues[write] = 0;
      entry.minValues[write] = current.min;
      entry.maxValues[write] = current.max;
      entry.valid[write] = 1;
      entry.length = write + 1;
    }
    byMetric.set(metric.name, entry);
  }

  return byMetric;
}

function stackedValueAt(metricName, type, t) {
  if (!yAxisStackingActive() || !lastStackedByMetric || !Number.isFinite(t))
    return null;
  const entry = lastStackedByMetric.get(metricName);
  return stackedEntryValueAt(entry, type, t);
}

function getDomain(seriesList) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of seriesList) {
    if (item.series.mode === "values") {
      for (const p of item.series.points || []) {
        const y = p.v * item.metric.factor;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    } else {
      for (const p of item.series.aggregatePoints || []) {
        if (Number(p.count) === 0) continue;
        minY = Math.min(minY, p.min * item.metric.factor);
        maxY = Math.max(maxY, p.max * item.metric.factor);
      }
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY))
    return { minY: 0, maxY: 1 };
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const pad = (maxY - minY) * 0.05;
  return { minY: minY - pad, maxY: maxY + pad };
}

function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  if (f <= 1) return 1 * exp;
  if (f <= 2) return 2 * exp;
  if (f <= 2.5) return 2.5 * exp;
  if (f <= 5) return 5 * exp;
  return 10 * exp;
}

function buildYTicks(minY, maxY, plotH) {
  const range = maxY - minY;
  if (!Number.isFinite(range) || range <= 0) return [minY, maxY];

  const minTickSpacingPx = 58;
  const targetCount = Math.max(2, Math.floor(plotH / minTickSpacingPx));
  const step = niceStep(range / targetCount);
  const start = Math.ceil(minY / step) * step;
  const end = Math.floor(maxY / step) * step;

  const ticks = [];
  for (let v = start; v <= end + step * 0.5; v += step) {
    const rounded = Number(v.toPrecision(12));
    if (rounded >= minY - step * 0.2 && rounded <= maxY + step * 0.2)
      ticks.push(rounded);
    if (ticks.length > 24) break;
  }
  if (ticks.length === 0) return [minY, maxY];
  return ticks;
}

function formatYTickLabels(ticks) {
  if (!Array.isArray(ticks) || ticks.length === 0) return [];
  const maxDecimals = 8;
  for (let decimals = 0; decimals <= maxDecimals; decimals += 1) {
    const labels = ticks.map((value) => formatFixed(value, decimals));
    if (new Set(labels).size === labels.length) return labels;
  }
  return ticks.map((value) =>
    formatNumber(value, { maximumSignificantDigits: 10 }),
  );
}

function yAxisUnitsLabel(seriesList) {
  if (metricRenderShowsCounts()) return "Hz";
  const units = [];
  const seen = new Set();
  for (const item of seriesList || []) {
    const unit = metricShownUnit(item?.metric);
    if (!unit || seen.has(unit)) continue;
    seen.add(unit);
    units.push(unit);
  }
  if (units.length === 0) return "";
  return units.join(" | ");
}

function formatReferenceLabel(ts, rangeMs, tickStepMs) {
  const d = new Date(ts);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  const second = String(d.getSeconds()).padStart(2, "0");
  const millis = String(d.getMilliseconds()).padStart(3, "0");
  if (tickStepMs < 1000)
    return `${day}.${month}.${year} ${hour}:${minute}:${second}.${millis}`;
  if (tickStepMs < 60_000)
    return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
  if (tickStepMs < 24 * 60 * 60 * 1000)
    return `${day}.${month}.${year} ${hour}:${minute}`;
  return `${day}.${month}.${year}`;
}

function resizeCanvas() {
  const rect = dom.chartWrap.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  dom.canvas.width = Math.floor(rect.width * ratio);
  dom.canvas.height = Math.floor(rect.height * ratio);
  dom.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function splitValidRuns(points, isValid) {
  const runs = [];
  let run = [];
  for (const point of points || []) {
    if (isValid(point)) {
      run.push(point);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function drawLastSemanticStepLine(ctx, run, valueOf, sx, sy) {
  if (!Array.isArray(run) || run.length < 2) return;
  ctx.beginPath();
  for (let i = 1; i < run.length; i += 1) {
    const prev = run[i - 1];
    const curr = run[i];
    const x0 = sx(prev.t);
    const x1 = sx(curr.t);
    const y = sy(valueOf(curr));
    if (i === 1) ctx.moveTo(x0, y);
    else ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
    if (i < run.length - 1) {
      const nextY = sy(valueOf(run[i + 1]));
      ctx.lineTo(x1, nextY);
    }
  }
  ctx.stroke();
}

function drawLastSemanticBand(ctx, run, minOf, maxOf, sx, sy) {
  if (!Array.isArray(run) || run.length < 2) return;
  for (let i = 1; i < run.length; i += 1) {
    const prev = run[i - 1];
    const curr = run[i];
    const x0 = sx(prev.t);
    const x1 = sx(curr.t);
    const yMin = sy(minOf(curr));
    const yMax = sy(maxOf(curr));
    ctx.beginPath();
    ctx.moveTo(x0, yMin);
    ctx.lineTo(x1, yMin);
    ctx.lineTo(x1, yMax);
    ctx.lineTo(x0, yMax);
    ctx.closePath();
    ctx.fill();
  }
}

function drawStackedTimelineFill(ctx, entry, tiMode, sx, sy, color) {
  if (!entry || entry.length < 2) return;
  const topAlpha = 0.26;
  // Keep shared boundaries between stack layers almost untinted to avoid visible overlap.
  const boundaryAlpha = 0.0;
  const total = Number(entry.length) || 0;
  let start = -1;
  for (let i = 0; i <= total; i += 1) {
    const valid = i < total && entry.valid[i] === 1;
    if (valid) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;
    const end = i;
    if (end - start < 2) {
      start = -1;
      continue;
    }
    let yTop = Number.POSITIVE_INFINITY;
    let yBottom = Number.NEGATIVE_INFINITY;
    let positiveCount = 0;
    let negativeCount = 0;
    for (let j = start; j < end; j += 1) {
      const yLine = sy(entry.avgValues[j]);
      const yBase = sy(entry.baseValues[j]);
      if (yLine < yTop) yTop = yLine;
      if (yBase < yTop) yTop = yBase;
      if (yLine > yBottom) yBottom = yLine;
      if (yBase > yBottom) yBottom = yBase;
      const delta = entry.avgValues[j] - entry.baseValues[j];
      if (delta < 0) negativeCount += 1;
      else positiveCount += 1;
    }
    const runGrad =
      yBottom > yTop + 0.5
        ? ctx.createLinearGradient(0, yTop, 0, yBottom)
        : null;
    if (runGrad) {
      const negativeRun = negativeCount > positiveCount;
      if (negativeRun) {
        // Negative stack contribution: stronger at the lower edge, fading upward.
        runGrad.addColorStop(0, cssColorWithAlpha(color, boundaryAlpha));
        runGrad.addColorStop(1, cssColorWithAlpha(color, topAlpha));
      } else {
        runGrad.addColorStop(0, cssColorWithAlpha(color, topAlpha));
        runGrad.addColorStop(1, cssColorWithAlpha(color, boundaryAlpha));
      }
    }
    if (tiMode) {
      for (let j = start + 1; j < end; j += 1) {
        const x0 = sx(entry.times[j - 1]);
        const x1 = sx(entry.times[j]);
        const yLine = sy(entry.avgValues[j]);
        const yBase = sy(entry.baseValues[j]);
        ctx.fillStyle = runGrad || cssColorWithAlpha(color, topAlpha);
        ctx.beginPath();
        ctx.moveTo(x0, yLine);
        ctx.lineTo(x1, yLine);
        ctx.lineTo(x1, yBase);
        ctx.lineTo(x0, yBase);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = runGrad || cssColorWithAlpha(color, topAlpha);
      ctx.beginPath();
      for (let j = start; j < end; j += 1) {
        if (j === start) ctx.moveTo(sx(entry.times[j]), sy(entry.avgValues[j]));
        else ctx.lineTo(sx(entry.times[j]), sy(entry.avgValues[j]));
      }
      for (let j = end - 1; j >= start; j -= 1) {
        ctx.lineTo(sx(entry.times[j]), sy(entry.baseValues[j]));
      }
      ctx.closePath();
      ctx.fill();
    }
    start = -1;
  }
}

function drawStackedTimelineLine(ctx, entry, tiMode, sx, sy) {
  if (!entry || entry.length < 2) return;
  const total = Number(entry.length) || 0;
  let start = -1;
  for (let i = 0; i <= total; i += 1) {
    const valid = i < total && entry.valid[i] === 1;
    if (valid) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;
    const end = i;
    if (end - start < 2) {
      start = -1;
      continue;
    }
    if (tiMode) {
      ctx.beginPath();
      for (let j = start + 1; j < end; j += 1) {
        const x0 = sx(entry.times[j - 1]);
        const x1 = sx(entry.times[j]);
        const y = sy(entry.avgValues[j]);
        if (j === start + 1) ctx.moveTo(x0, y);
        else ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
        if (j < end - 1) {
          const nextY = sy(entry.avgValues[j + 1]);
          ctx.lineTo(x1, nextY);
        }
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      for (let j = start; j < end; j += 1) {
        if (j === start) ctx.moveTo(sx(entry.times[j]), sy(entry.avgValues[j]));
        else ctx.lineTo(sx(entry.times[j]), sy(entry.avgValues[j]));
      }
      ctx.stroke();
    }
    start = -1;
  }
}

function drawEmptyChartState(ctx, margin) {
  lastStackedByMetric = null;
  lastLayout = null;
}

function setChartEmptyStateVisible(visible) {
  if (!dom.chartEmptyState) return;
  if (!visible) {
    dom.chartEmptyState.classList.remove("is-minimizing");
    dom.chartEmptyState.classList.remove("is-ghosting");
  }
  dom.chartEmptyState.classList.toggle("d-none", !visible);
}

function setNavbarHelpToggleVisible(visible, withPop = false) {
  if (!dom.btnHelpOverlayToggle) return;
  dom.btnHelpOverlayToggle.classList.toggle("is-visible", !!visible);
  if (visible && withPop) {
    dom.btnHelpOverlayToggle.classList.remove("is-pop");
    void dom.btnHelpOverlayToggle.offsetWidth;
    dom.btnHelpOverlayToggle.classList.add("is-pop");
    window.setTimeout(
      () => dom.btnHelpOverlayToggle?.classList.remove("is-pop"),
      980,
    );
  }
}

function animateEmptyStateToNavbarHelpButton() {
  if (!dom.chartEmptyState || !dom.btnHelpOverlayToggle) return;
  const card = dom.chartEmptyState.querySelector(".chart-empty-card");
  if (!card) return;
  const from = card.getBoundingClientRect();
  const to = dom.btnHelpOverlayToggle.getBoundingClientRect();
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0)
    return;

  const ghost = document.createElement("div");
  ghost.className = "chart-empty-minimize-ghost";
  ghost.style.left = `${Math.round(from.left)}px`;
  ghost.style.top = `${Math.round(from.top)}px`;
  ghost.style.width = `${Math.round(from.width)}px`;
  ghost.style.height = `${Math.round(from.height)}px`;
  document.body.appendChild(ghost);

  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;
  const toCx = to.left + to.width / 2;
  const toCy = to.top + to.height / 2;
  const dx = Math.round(toCx - fromCx);
  const dy = Math.round(toCy - fromCy);
  const sxFactor = Math.max(0.1, to.width / from.width);
  const syFactor = Math.max(0.1, to.height / from.height);
  const anim = ghost.animate(
    [
      { transform: "translate(0px, 0px) scale(1, 1)", opacity: 0.95 },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${sxFactor}, ${syFactor})`,
        opacity: 0.1,
      },
    ],
    { duration: 1400, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
  );
  anim.addEventListener("finish", () => ghost.remove(), { once: true });
  anim.addEventListener("cancel", () => ghost.remove(), { once: true });
}

export function startHelpOverlayMinimize(durationMs = 1900) {
  const overlayVisible = Boolean(
    dom.chartEmptyState && !dom.chartEmptyState.classList.contains("d-none"),
  );
  if (!overlayVisible) return;
  state.helpOverlayForced = false;
  state.helpOverlayMinimizeDeferred = false;
  state.helpOverlayMinimizeActive = true;
  if (helpMinimizeTimerId != null) {
    window.clearTimeout(helpMinimizeTimerId);
  }
  helpMinimizeTimerId = window.setTimeout(
    () => {
      helpMinimizeTimerId = null;
      state.helpOverlayMinimizeActive = false;
      renderChart();
    },
    Math.max(250, Number(durationMs) || 1900),
  );
  renderChart();
}

function drawYAxisAndAxes(
  ctx,
  width,
  height,
  margin,
  plotH,
  sy,
  yTicks,
  seriesList,
) {
  const yTickLen = 4;
  ctx.strokeStyle = "#d9dee8";
  ctx.lineWidth = 1;
  for (const value of yTicks) {
    const y = sy(value);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, height - margin.bottom);
  ctx.lineTo(width - margin.right, height - margin.bottom);
  ctx.stroke();

  const yUnits = yAxisUnitsLabel(seriesList);
  if (yUnits) {
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = Math.max(8, margin.left - 36);
    const y = margin.top + plotH / 2;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yUnits, 0, 0);
    ctx.restore();
  }

  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "right";
  const yTickLabels = formatYTickLabels(yTicks);
  for (let i = 0; i < yTicks.length; i += 1) {
    const value = yTicks[i];
    const y = sy(value);
    // Small black tick marker for each rendered y-label.
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left - yTickLen, y);
    ctx.stroke();
    ctx.fillText(yTickLabels[i], margin.left - 6, y + 4);
  }
}

function drawXAxisGrid(ctx, width, height, margin, plotW, sx, xMin, xMax) {
  const rangeMs = xMax - xMin;
  const targetTicks = Math.max(4, Math.floor(plotW / 110));
  const tickStepMs = pickTimeTickStep(rangeMs, targetTicks);
  const xTicks = buildXTicks(xMin, xMax, tickStepMs);
  const maxVerticalGridLines = Math.max(4, Math.floor(plotW / 95));
  const gridStride = Math.max(
    1,
    Math.ceil(xTicks.length / maxVerticalGridLines),
  );
  const axisY = height - margin.bottom;
  const tickLen = 4;

  ctx.strokeStyle = "#e7ebf3";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  const canvasLeft = 0;
  const canvasRight = width;
  const labelPad = 8;
  for (let i = 0; i < xTicks.length; i += 1) {
    const tick = xTicks[i];
    const x = sx(tick);
    if (i % gridStride !== 0) continue;

    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, axisY);
    ctx.stroke();

    const label =
      i === 0
        ? formatReferenceLabel(tick, rangeMs, tickStepMs)
        : formatAxisTime(tick, rangeMs, tickStepMs);

    // Small black tick marker for each rendered x-label.
    ctx.save();
    ctx.strokeStyle = "#000000";
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + tickLen);
    ctx.stroke();
    ctx.restore();

    const textWidth = ctx.measureText(label).width;
    const minX = canvasLeft + textWidth / 2 + labelPad;
    const maxX = canvasRight - textWidth / 2 - labelPad;
    const labelX = Math.max(minX, Math.min(x, maxX));
    ctx.fillText(label, labelX, height - 9);
  }
}

export function renderChart() {
  resizeCanvas();
  const width = dom.chartWrap.clientWidth;
  const height = dom.chartWrap.clientHeight;
  const ctx = dom.ctx;

  ctx.clearRect(0, 0, width, height);

  const margin = { top: 12, right: 18, bottom: 34, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  if (dom.collapsedLegend) {
    dom.collapsedLegend.style.left = "auto";
    dom.collapsedLegend.style.top = `${margin.top + 4}px`;
    dom.collapsedLegend.style.right = `${margin.right + 4}px`;
    dom.collapsedLegend.style.maxWidth = `${Math.max(180, Math.min(360, Math.floor(plotW * 0.34)))}px`;
    if (state.renderMode === "ti") dom.collapsedLegend.classList.add("d-none");
  }

  const seriesList = getVisibleSeries();
  const noMetricsSelected = state.metrics.length === 0;
  const allMetricsHidden =
    !noMetricsSelected && state.metrics.every((metric) => !metric.draw);
  const hasLoadError = String(state.dataLoadError || "").trim().length > 0;
  const showBlockingError = hasLoadError && seriesList.length === 0;
  dom.canvas.style.cursor = "default";
  if (noMetricsSelected) {
    state.dataLoadError = "";
    state.dataLoadErrorKind = "";
    state.helpOverlayForced = false;
    state.helpOverlayMinimizeDeferred = false;
    state.helpOverlayMinimizeActive = false;
    if (helpMinimizeTimerId != null) {
      window.clearTimeout(helpMinimizeTimerId);
      helpMinimizeTimerId = null;
    }
  }
  const minimizingNow =
    !noMetricsSelected &&
    !state.helpOverlayForced &&
    !state.helpOverlayMinimizeDeferred &&
    !!state.helpOverlayMinimizeActive;
  const showHelpOverlay =
    noMetricsSelected ||
    !!state.helpOverlayForced ||
    !!state.helpOverlayMinimizeDeferred ||
    minimizingNow;
  const wasHelpVisible =
    dom.chartEmptyState && !dom.chartEmptyState.classList.contains("d-none");
  if (showHelpOverlay) {
    setChartEmptyStateVisible(true);
    if (minimizingNow) {
      if (!helpMinimizeRenderActive && wasHelpVisible) {
        animateEmptyStateToNavbarHelpButton();
        setNavbarHelpToggleVisible(true, true);
        dom.chartEmptyState?.classList.add("is-ghosting");
      } else {
        setNavbarHelpToggleVisible(true);
      }
      dom.chartEmptyState?.classList.add("is-minimizing");
      helpMinimizeRenderActive = true;
    } else {
      dom.chartEmptyState?.classList.remove("is-minimizing");
      dom.chartEmptyState?.classList.remove("is-ghosting");
      setNavbarHelpToggleVisible(false);
      helpMinimizeRenderActive = false;
    }
  } else {
    setNavbarHelpToggleVisible(true);
    setChartEmptyStateVisible(false);
    helpMinimizeRenderActive = false;
    if (helpMinimizeTimerId != null) {
      window.clearTimeout(helpMinimizeTimerId);
      helpMinimizeTimerId = null;
    }
    state.helpOverlayMinimizeActive = false;
  }
  setChartErrorVisible(
    showBlockingError ? state.dataLoadError : "",
    state.dataLoadErrorKind || "backend",
  );
  if (showHelpOverlay) setChartLoadingVisible(false);
  if (noMetricsSelected) {
    lastStackedByMetric = null;
    lastLayout = null;
    hideHover();
    return;
  }
  if (seriesList.length === 0) {
    setChartLoadingVisible(!allMetricsHidden && !showBlockingError);
    if (!showHelpOverlay) setChartEmptyStateVisible(false);
    drawEmptyChartState(ctx, margin);
    return;
  }
  setChartLoadingVisible(false);
  dom.canvas.style.cursor = "crosshair";

  const tiMode = state.renderMode === "ti";
  lastStackedByMetric = yAxisStackingActive()
    ? buildStackedSeries(seriesList, tiMode, false)
    : null;
  const domainSeries = filterSeriesForVisibleRange(seriesList, tiMode);
  const domainStacked = yAxisStackingActive()
    ? buildStackedSeries(domainSeries, tiMode, true)
    : null;
  const domain = resolveYAxisDomain(domainSeries, domainStacked);
  state.yAxisCurrentMin = domain.minY;
  state.yAxisCurrentMax = domain.maxY;
  const xMin = state.from;
  const xMax = state.to;
  const sx = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y) =>
    margin.top + (1 - (y - domain.minY) / (domain.maxY - domain.minY)) * plotH;
  lastLayout = {
    margin,
    plotW,
    plotH,
    sx,
    sy,
    minY: domain.minY,
    maxY: domain.maxY,
  };

  const yTicks = buildYTicks(domain.minY, domain.maxY, plotH);
  drawXAxisGrid(ctx, width, height, margin, plotW, sx, xMin, xMax);
  drawYAxisAndAxes(ctx, width, height, margin, plotH, sy, yTicks, seriesList);

  // Clip all series drawing to the actual plot region between axes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  for (const item of seriesList) {
    const { metric, series } = item;
    const stackedSeries = lastStackedByMetric?.get(metric.name);
    const stackedAvgAt =
      yAxisStackingActive() && stackedSeries?.stacksInYAxis
        ? createSequentialStackedLookup(stackedSeries, "avg")
        : null;
    ctx.strokeStyle = metric.color;
    ctx.fillStyle = metric.color;
    ctx.lineWidth = 1.5;

    if (yAxisStackingActive() && stackedSeries?.stacksInYAxis && metric.drawAvg) {
      if (stackedSeries.length >= 2) {
        drawStackedTimelineFill(
          ctx,
          stackedSeries,
          tiMode,
          sx,
          sy,
          metric.color,
        );
        drawStackedTimelineLine(ctx, stackedSeries, tiMode, sx, sy);
        continue;
      }
      if (stackedSeries.length === 1 && stackedSeries.valid[0] === 1) {
        const yValue = stackedSeries.avgValues[0];
        if (!Number.isFinite(yValue)) continue;
        ctx.beginPath();
        ctx.arc(sx(stackedSeries.times[0]), sy(yValue), 1.8, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
    }

    if (series.mode === "values") {
      const points = series.points || [];
      if (!metric.drawAvg || points.length === 0) continue;
      const isComputedValues = String(series?.stats?.type || "") === "computed";
      const isRawValues = String(series?.stats?.type || "") === "raw";

      if (tiMode) {
        if (isRawValues) {
          const radius = points.length > 2500 ? 1.2 : 1.8;
          for (let i = 0; i < points.length; i += 1) {
            const p = points[i];
            const tx = p.t;
            const rawValue = pointRenderValue(metric, series, p, "avg", {
              points,
              index: i,
            });
            if (!Number.isFinite(rawValue)) continue;
            const x = sx(tx);
            const y = sy(
              resolveSeriesValueForRender(
                stackedAvgAt,
                stackedSeries,
                tx,
                rawValue,
              ),
            );
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (points.length >= 2) {
          drawLastSemanticStepLine(
            ctx,
            points,
            (p) => {
              const idx = points.indexOf(p);
              const tx = p.t;
              const rawValue = pointRenderValue(metric, series, p, "avg", {
                points,
                index: idx,
              });
              return resolveSeriesValueForRender(
                stackedAvgAt,
                stackedSeries,
                tx,
                rawValue,
              );
            },
            sx,
            sy,
          );
        } else {
          const p = points[0];
          const rawValue = pointRenderValue(metric, series, p, "avg", {
            points,
            index: 0,
          });
          if (!Number.isFinite(rawValue)) continue;
          const x = sx(p.t);
          const y = sy(
            resolveSeriesValueForRender(
              stackedAvgAt,
              stackedSeries,
              p.t,
              rawValue,
            ),
          );
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }

      if (isComputedValues) {
        ctx.beginPath();
        for (let i = 0; i < points.length; i += 1) {
          const p = points[i];
          const tx = aggregateDisplayTime(points, i, series);
          const rawValue = pointRenderValue(metric, series, p, "avg", {
            points,
            index: i,
          });
          if (!Number.isFinite(rawValue)) continue;
          const x = sx(tx);
          const y = sy(
            resolveSeriesValueForRender(
              stackedAvgAt,
              stackedSeries,
              tx,
              rawValue,
            ),
          );
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        continue;
      }

      const radius = points.length > 2500 ? 1.2 : 1.8;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const tx = p.t;
        const rawValue = pointRenderValue(metric, series, p, "avg", {
          points,
          index: i,
        });
        if (!Number.isFinite(rawValue)) continue;
        const x = sx(tx);
        const y = sy(
          resolveSeriesValueForRender(
            stackedAvgAt,
            stackedSeries,
            tx,
            rawValue,
          ),
        );
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }

    if (series.mode === "candlestick") {
      const candles = series.aggregatePoints || [];
      if (!metric.drawAvg || candles.length === 0) continue;
      const widthMs = Number(series.candleWidthMs) || 0;
      const fullWidthPx = widthMs > 0 ? sx(xMin + widthMs) - sx(xMin) : 4;
      const halfWidthPx = Math.max(1, (fullWidthPx * 0.7) / 2);
      const { r, g, b } = hexToRgb(metric.color);
      const upColor = `rgba(${r}, ${g}, ${b}, 1)`;
      const downColor = `rgba(${r}, ${g}, ${b}, ${CANDLE_DOWN_ALPHA})`;
      for (const p of candles) {
        if (Number(p.count) === 0) continue;
        const open = Number(p.open);
        const close = Number(p.close);
        if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
        const x = sx(p.t);
        const color = close >= open ? upColor : downColor;
        const yHigh = sy(p.max * metric.factor);
        const yLow = sy(p.min * metric.factor);
        const yOpen = sy(open * metric.factor);
        const yClose = sy(close * metric.factor);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
        ctx.fillRect(x - halfWidthPx, bodyTop, halfWidthPx * 2, bodyHeight);
      }
      continue;
    }

    const points = series.aggregatePoints || [];
    if (points.length === 0) continue;

    const runs = splitValidRuns(points, (p) => Number(p.count) > 0);

    const showBand =
      metricRenderShowsBands() &&
      (!yAxisStackingActive() || !stackedSeries?.stacksInYAxis);
    if (showBand) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      for (const segment of runs) {
        if (tiMode) {
          drawLastSemanticBand(
            ctx,
            segment,
            (p) => pointRenderValue(metric, series, p, "min"),
            (p) => pointRenderValue(metric, series, p, "max"),
            sx,
            sy,
          );
        } else {
          if (segment.length < 2) continue;
          ctx.beginPath();
          for (let i = 0; i < segment.length; i += 1) {
            const p = segment[i];
            const tx = aggregateDisplayTime(segment, i, series);
            const minValue = pointRenderValue(metric, series, p, "min");
            if (!Number.isFinite(minValue)) continue;
            if (i === 0) ctx.moveTo(sx(tx), sy(minValue));
            else ctx.lineTo(sx(tx), sy(minValue));
          }
          for (let i = segment.length - 1; i >= 0; i -= 1) {
            const p = segment[i];
            const tx = aggregateDisplayTime(segment, i, series);
            const maxValue = pointRenderValue(metric, series, p, "max");
            if (!Number.isFinite(maxValue)) continue;
            ctx.lineTo(sx(tx), sy(maxValue));
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }

    if (metric.drawAvg) {
      for (const segment of runs) {
        if (tiMode) {
          drawLastSemanticStepLine(
            ctx,
            segment,
            (p) => {
              const tx = p.t;
              return resolveSeriesValueForRender(
                stackedAvgAt,
                stackedSeries,
                tx,
                pointRenderValue(metric, series, p, "avg"),
              );
            },
            sx,
            sy,
          );
        } else {
          if (segment.length === 0) continue;
          ctx.beginPath();
          for (let i = 0; i < segment.length; i += 1) {
            const p = segment[i];
            const tx = aggregateDisplayTime(segment, i, series);
            const avg = resolveSeriesValueForRender(
              stackedAvgAt,
              stackedSeries,
              tx,
              pointRenderValue(metric, series, p, "avg"),
            );
            if (i === 0) ctx.moveTo(sx(tx), sy(avg));
            else ctx.lineTo(sx(tx), sy(avg));
          }
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
}

export function timestampAtCanvasX(clientX) {
  const rect = dom.canvas.getBoundingClientRect();
  const rawX = clientX - rect.left;
  if (!lastLayout) {
    const x = Math.max(0, Math.min(rawX, rect.width));
    return Math.round(state.from + (x / rect.width) * (state.to - state.from));
  }

  const left = lastLayout.margin.left;
  const right = lastLayout.margin.left + lastLayout.plotW;
  const clamped = Math.max(left, Math.min(rawX, right));
  const rel = (clamped - left) / Math.max(1, lastLayout.plotW);
  return Math.round(state.from + rel * (state.to - state.from));
}

export function getPlotXBoundsInCanvas() {
  if (!lastLayout) return null;
  return {
    left: lastLayout.margin.left,
    right: lastLayout.margin.left + lastLayout.plotW,
  };
}

export function isChartInteractive() {
  return Boolean(lastLayout);
}

function seriesValueAtTime(metric, series, t) {
  const points =
    series.mode === "values"
      ? series.points || []
      : series.aggregatePoints || [];
  if (points.length === 0) return null;

  let best = null;
  let bestIndex = -1;
  let bestT = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (series.mode !== "values" && Number(p.count) === 0) continue;
    const sampleT = aggregateDisplayTime(points, i, series);
    const d = Math.abs(sampleT - t);
    if (d < bestDiff) {
      best = p;
      bestIndex = i;
      bestT = sampleT;
      bestDiff = d;
    }
  }
  if (!best || (series.mode !== "values" && Number(best.count) === 0))
    return null;
  const stacked = stackedValueAt(metric.name, "avg", bestT);
  const rawValue = pointRenderValue(metric, series, best, "avg", {
    points,
    index: bestIndex,
  });
  if (!Number.isFinite(rawValue)) return null;
  const plotValue = Number.isFinite(stacked) ? stacked : rawValue;

  return {
    t: bestT,
    value: rawValue,
    plotValue,
    index: bestIndex,
    activeTimeMs:
      series.mode === "aggregates" ? Number(best.activeTimeMs) || null : null,
  };
}

function pointValue(series, point, factor, points, index) {
  if (series.mode !== "values" && Number(point?.count) === 0) return null;
  return pointRenderValue({ factor }, series, point, "avg", {
    points,
    index,
  });
}

const HOVER_X_WEIGHT = 1.4;
const HOVER_Y_WEIGHT = 1.0;

function weightedHoverDist2(dx, dy) {
  const wx = dx * HOVER_X_WEIGHT;
  const wy = dy * HOVER_Y_WEIGHT;
  return wx * wx + wy * wy;
}

function nearestPointByProximity(metric, series, t, cursorX, cursorY, sx, sy) {
  const points =
    series.mode === "values"
      ? series.points || []
      : series.aggregatePoints || [];
  if (points.length === 0) return null;

  // For small series, exact scan is cheap and gives best spatial match.
  if (points.length <= 1200) {
    let best = null;
    let bestIndex = -1;
    let bestDist2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const sampleT = aggregateDisplayTime(points, i, series);
      const x = sx(sampleT);
      const stacked = stackedValueAt(metric.name, "avg", sampleT);
      const value = Number.isFinite(stacked)
        ? stacked
        : pointValue(series, p, metric.factor, points, i);
      if (!Number.isFinite(value)) continue;
      const y = sy(value);
      const dx = x - cursorX;
      const dy = y - cursorY;
      const d2 = weightedHoverDist2(dx, dy);
      if (d2 < bestDist2) {
        best = p;
        bestIndex = i;
        bestDist2 = d2;
      }
    }
    return best ? { point: best, index: bestIndex } : null;
  }

  // For large series, binary-search in time then scan a local window in both directions.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }

  let best = null;
  let bestIndex = -1;
  let bestDist2 = Number.POSITIVE_INFINITY;
  const radius = 28;
  const from = Math.max(0, lo - radius);
  const to = Math.min(points.length - 1, lo + radius);
  for (let i = from; i <= to; i += 1) {
    const p = points[i];
    const sampleT = aggregateDisplayTime(points, i, series);
    const x = sx(sampleT);
    const stacked = stackedValueAt(metric.name, "avg", sampleT);
    const value = Number.isFinite(stacked)
      ? stacked
      : pointValue(series, p, metric.factor, points, i);
    if (!Number.isFinite(value)) continue;
    const y = sy(value);
    const dx = x - cursorX;
    const dy = y - cursorY;
    const d2 = weightedHoverDist2(dx, dy);
    if (d2 < bestDist2) {
      best = p;
      bestIndex = i;
      bestDist2 = d2;
    }
  }
  return best ? { point: best, index: bestIndex } : null;
}

function selectNearestHoverCandidate(candidates) {
  let selected = null;
  for (const candidate of candidates) {
    if (!selected || candidate.dist2 < selected.dist2) selected = candidate;
  }
  return selected;
}

function selectStackedHoverCandidate(candidates, cursorValue, maxAbsDomain) {
  const range = Math.max(1e-9, Math.abs(lastLayout.maxY - lastLayout.minY));
  const valueTolerance = (range * 4) / Math.max(1, lastLayout.plotH);
  const zeroToleranceBase = valueTolerance * 0.5;
  const scored = [];

  for (const candidate of candidates) {
    const top = Number(
      stackedValueAt(candidate.metric.name, "avg", candidate.sampled.t),
    );
    const base = Number(
      stackedValueAt(candidate.metric.name, "base", candidate.sampled.t),
    );
    const raw = Number(candidate.sampled.value);
    const snapScale = Math.max(0, Math.min(1, Math.abs(raw) / maxAbsDomain));
    const zeroTolerance = zeroToleranceBase * (0.35 + 0.65 * snapScale);
    if (
      !Number.isFinite(top) ||
      !Number.isFinite(base) ||
      !Number.isFinite(raw)
    ) {
      scored.push({ candidate, bucket: 3, delta: Number.POSITIVE_INFINITY });
      continue;
    }

    const lo = Math.min(base, top);
    const hi = Math.max(base, top);
    const nearBoundary = Math.min(
      Math.abs(cursorValue - lo),
      Math.abs(cursorValue - hi),
    );
    const isNearZero = Math.abs(raw) <= zeroTolerance;
    if (isNearZero) {
      if (nearBoundary <= zeroTolerance)
        scored.push({ candidate, bucket: 1, delta: nearBoundary });
      else scored.push({ candidate, bucket: 3, delta: nearBoundary });
      continue;
    }

    const inside =
      raw >= 0
        ? cursorValue >= base && cursorValue < top
        : cursorValue <= base && cursorValue > top;
    if (inside) {
      scored.push({ candidate, bucket: 0, delta: 0 });
      continue;
    }
    const outsideDelta =
      cursorValue < lo
        ? lo - cursorValue
        : cursorValue > hi
          ? cursorValue - hi
          : 0;
    scored.push({ candidate, bucket: 2, delta: outsideDelta });
  }

  scored.sort((a, b) => {
    const aNorm =
      a.candidate.dist2 /
      Math.max(1e-9, a.candidate.snapPx * a.candidate.snapPx);
    const bNorm =
      b.candidate.dist2 /
      Math.max(1e-9, b.candidate.snapPx * b.candidate.snapPx);
    // Prioritize the visually nearest point first.
    if (Math.abs(aNorm - bNorm) > 1e-9) return aNorm - bNorm;
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (Math.abs(a.delta - b.delta) > 1e-12) return a.delta - b.delta;
    return 0;
  });
  return scored[0]?.candidate || null;
}

function sampleTIAtTime(metric, series, t) {
  if (series.mode === "values") {
    const points = series.points || [];
    if (points.length < 2) return null;
    let lo = 1;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (points[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    if (idx <= 0 || idx >= points.length) return null;
    const prev = points[idx - 1];
    const curr = points[idx];
    if (t < prev.t || t > curr.t) return null;
    const rawValue = pointRenderValue(metric, series, curr, "avg", {
      points,
      index: idx,
    });
    if (!Number.isFinite(rawValue)) return null;
    const stacked = stackedValueAt(metric.name, "avg", curr.t);
    const plotAvg = Number.isFinite(stacked) ? stacked : rawValue;
    return { min: rawValue, avg: rawValue, max: rawValue, plotAvg };
  }

  const points = series.aggregatePoints || [];
  if (points.length < 2) return null;
  let lo = 1;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo;
  if (idx <= 0 || idx >= points.length) return null;
  const prev = points[idx - 1];
  const curr = points[idx];
  if (t < prev.t || t > curr.t || Number(curr.count) === 0) return null;
  const rawMin = pointRenderValue(metric, series, curr, "min");
  const rawAvg = pointRenderValue(metric, series, curr, "avg");
  const rawMax = pointRenderValue(metric, series, curr, "max");
  if (
    !Number.isFinite(rawMin) ||
    !Number.isFinite(rawAvg) ||
    !Number.isFinite(rawMax)
  ) {
    return null;
  }
  const stackedAvg = stackedValueAt(metric.name, "avg", curr.t);
  const open = Number(curr.open);
  const close = Number(curr.close);
  return {
    min: rawMin,
    avg: rawAvg,
    max: rawMax,
    open: Number.isFinite(open) ? open * metric.factor : null,
    close: Number.isFinite(close) ? close * metric.factor : null,
    plotAvg: Number.isFinite(stackedAvg) ? stackedAvg : rawAvg,
    activeTimeMs: Number(curr.activeTimeMs) || null,
  };
}

function aggregateDisplayTime(points, index, series = null) {
  const p = points?.[index];
  if (!p) return NaN;
  const isAggregateSeries = series?.mode === "aggregates";
  const isComputedValuesSeries =
    series?.mode === "values" &&
    String(series?.stats?.type || "") === "computed";
  if (
    state.renderMode !== "ti" &&
    index > 0 &&
    (isAggregateSeries || isComputedValuesSeries)
  ) {
    const prev = points[index - 1];
    return Math.round((prev.t + p.t) / 2);
  }
  return p.t;
}

// Finds the point nearest to t purely by time, ignoring y position entirely.
// Candlesticks span a vertical range (the wick), so snapping by 2D distance
// to a single value (as line/aggregate hover does) makes no sense for them.
function nearestPointIndexByTime(points, t) {
  if (!points || points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - t) < Math.abs(points[lo].t - t)) {
    return lo - 1;
  }
  return lo;
}

function candlestickHalfWidthPx(series) {
  const widthMs = Number(series.candleWidthMs) || 0;
  const fullWidthPx =
    widthMs > 0
      ? lastLayout.sx(state.from + widthMs) - lastLayout.sx(state.from)
      : 4;
  return Math.max(1, (fullWidthPx * 0.7) / 2);
}

function renderCandlestickHoverAt(clientX, clientY, t, margin, cursorX, cursorY) {
  const plotRight = margin.left + lastLayout.plotW;

  // Collect every metric's candle nearest the cursor time, then only keep
  // candles that are themselves within snapping distance by 2D proximity (x
  // distance to the candle's center, y distance to its high/low range — 0 if
  // the cursor is vertically inside the wick). A candle far above/below the
  // cursor no longer gets highlighted just because another metric's candle
  // at the same moment happens to be close.
  const candidates = [];
  const lineRows = [];

  for (const metric of state.metrics) {
    if (!metric.draw) continue;
    const series = state.series.get(metric.name);
    if (!series || series.error) continue;

    if (series.mode === "candlestick") {
      const points = series.aggregatePoints || [];
      const idx = nearestPointIndexByTime(points, t);
      if (idx < 0) continue;
      const p = points[idx];
      if (Number(p.count) === 0) continue;
      const xPx = lastLayout.sx(p.t);
      if (xPx < margin.left || xPx > plotRight) continue;
      const open = Number(p.open);
      const close = Number(p.close);
      if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
      const high = p.max * metric.factor;
      const low = p.min * metric.factor;
      const yHigh = lastLayout.sy(high);
      const yLow = lastLayout.sy(low);
      const rangeTop = Math.min(yHigh, yLow);
      const rangeBottom = Math.max(yHigh, yLow);
      const dx = xPx - cursorX;
      const dy =
        cursorY < rangeTop
          ? rangeTop - cursorY
          : cursorY > rangeBottom
            ? cursorY - rangeBottom
            : 0;
      candidates.push({
        metric,
        point: p,
        xPx,
        halfWidthPx: candlestickHalfWidthPx(series),
        dist2: weightedHoverDist2(dx, dy),
        open: open * metric.factor,
        high,
        low,
        close: close * metric.factor,
      });
    } else {
      const sampled = seriesValueAtTime(metric, series, t);
      if (!sampled) continue;
      lineRows.push({ metric, sampled });
    }
  }

  // Each candle only qualifies on its own proximity to the cursor — a candle
  // far above/below the cursor no longer rides along just because another
  // metric's candle at the same moment in time happens to be the closest.
  const hits = candidates.filter((c) => {
    const snapPx = c.halfWidthPx + 6;
    return c.dist2 <= snapPx * snapPx;
  });

  if (hits.length === 0 && lineRows.length === 0) {
    dom.hoverBox.classList.add("d-none");
    hideHoverPoint();
    hideHoverCandle();
    hideHoverCursorLine();
    return;
  }

  hideHoverPoint();
  hits.forEach((hit, i) => {
    const yHigh = lastLayout.sy(hit.high);
    const yLow = lastLayout.sy(hit.low);
    positionHoverCandle(
      i,
      hit.xPx,
      Math.min(yHigh, yLow),
      hit.halfWidthPx * 2,
      Math.max(2, Math.abs(yLow - yHigh)),
      hit.metric.color,
    );
  });
  hideHoverCandle(hits.length);

  const refT =
    hits.length > 0
      ? hits.reduce((a, b) => (b.dist2 < a.dist2 ? b : a)).point.t
      : t;
  positionHoverCursorLine(lastLayout.sx(refT), margin.top, lastLayout.plotH);

  const candleHtml = hits
    .map((row) => {
      const shownUnit = metricShownUnit(row.metric);
      const factor = shownMetricFactor(row.metric);
      const factorText = factor ? ` x${factor}` : "";
      const unitSuffix = shownUnit ? ` ${shownUnit}` : "";
      return `<div><span style=\"display:inline-block;width:10px;height:10px;background:${row.metric.color};margin-right:6px\"></span>${metricDisplayName(row.metric)}${factorText}: O <strong>${formatFixed(row.open, 3)}</strong>${unitSuffix} | H <strong>${formatFixed(row.high, 3)}</strong>${unitSuffix} | L <strong>${formatFixed(row.low, 3)}</strong>${unitSuffix} | C <strong>${formatFixed(row.close, 3)}</strong>${unitSuffix}</div>`;
    })
    .join("");
  const lineHtml = lineRows
    .map((row) => {
      const shownUnit = metricShownUnit(row.metric);
      const factor = shownMetricFactor(row.metric);
      const factorText = factor ? ` x${factor}` : "";
      const unitSuffix = shownUnit ? ` ${shownUnit}` : "";
      return `<div><span style=\"display:inline-block;width:10px;height:10px;background:${row.metric.color};margin-right:6px\"></span>${metricDisplayName(row.metric)}${factorText}: <strong>${formatFixed(row.sampled.value, 3)}</strong>${unitSuffix}</div>`;
    })
    .join("");
  setHoverBoxHtml(
    `<div class=\"fw-semibold mb-1\">${formatAbsoluteTime(refT)}</div>${candleHtml}${lineHtml}`,
  );

  const rect = dom.chartWrap.getBoundingClientRect();
  const cursorXWrap = clientX - rect.left;
  const preferredRight = cursorXWrap + 12;
  const overflowRight = preferredRight + hoverBoxWidth > rect.width - 8;
  const left = overflowRight
    ? Math.max(8, cursorXWrap - hoverBoxWidth - 12)
    : preferredRight;
  dom.hoverBox.style.left = `${left}px`;
  const preferredTop = clientY - rect.top - 16;
  const maxTop = rect.height - hoverBoxHeight - 8;
  const top = Math.max(8, Math.min(preferredTop, maxTop));
  dom.hoverBox.style.top = `${top}px`;
}

function renderHoverAt(clientX, clientY) {
  if (!lastLayout) return;
  updateCollapsedLegendFade(clientX, clientY);
  const t = timestampAtCanvasX(clientX);
  const margin = lastLayout.margin;
  const canvasRect = dom.canvas.getBoundingClientRect();
  const cursorX = clientX - canvasRect.left;
  const cursorY = clientY - canvasRect.top;
  if (state.renderMode === "candlestick") {
    renderCandlestickHoverAt(clientX, clientY, t, margin, cursorX, cursorY);
    return;
  }
  const cursorValue = (() => {
    if (!Number.isFinite(lastLayout.minY) || !Number.isFinite(lastLayout.maxY))
      return null;
    const rel = (cursorY - margin.top) / Math.max(1, lastLayout.plotH);
    return lastLayout.maxY - rel * (lastLayout.maxY - lastLayout.minY);
  })();
  if (state.renderMode === "ti") {
    const rows = [];
    let nearestRowIndex = -1;
    let nearestDist2 = Number.POSITIVE_INFINITY;
    const hoverX = lastLayout.sx(t);
    for (const metric of state.metrics) {
      if (!metric.draw) continue;
      const series = state.series.get(metric.name);
      if (!series || series.error) continue;
      const sampled = sampleTIAtTime(metric, series, t);
      if (!sampled) continue;
      const shownUnit = metricShownUnit(metric);
      const factor = metricRenderShowsCounts() ? "" : shownMetricFactor(metric);
      const factorText = factor ? ` x${factor}` : "";
      const unitText = shownUnit ? ` ${shownUnit}` : "";
      const yPx = lastLayout.sy(
        Number.isFinite(sampled.plotAvg) ? sampled.plotAvg : sampled.avg,
      );
      const dx = hoverX - cursorX;
      const dy = yPx - cursorY;
      const dist2 = weightedHoverDist2(dx, dy);
      const rowIndex = rows.length;
      rows.push({
        metric,
        sampled,
        factorText,
        unitText,
        intervalText: frequencyIntervalText(sampled.avg),
      });
      if (dist2 < nearestDist2) {
        nearestDist2 = dist2;
        nearestRowIndex = rowIndex;
      }
    }
    if (rows.length === 0) {
      dom.hoverBox.classList.add("d-none");
      hideHoverPoint();
      hideHoverCursorLine();
      return;
    }
    const rowsHtml = rows
      .map((row, idx) => {
        const activeClass = idx === nearestRowIndex ? " hover-row-active" : "";
        const hasOhlc =
          row.sampled.open != null && row.sampled.close != null;
        const valuesHtml = metricRenderShowsCounts()
          ? `freq <strong>${formatFixed(row.sampled.avg, 3)}</strong>${row.unitText}${row.intervalText ? ` | interval <strong>${row.intervalText}</strong>` : ""}`
          : yAxisStackingActive()
            ? `avg <strong>${formatFixed(row.sampled.avg, 3)}</strong>${row.unitText}`
            : hasOhlc
              ? `O <strong>${formatFixed(row.sampled.open, 3)}</strong>${row.unitText} | H <strong>${formatFixed(row.sampled.max, 3)}</strong>${row.unitText} | L <strong>${formatFixed(row.sampled.min, 3)}</strong>${row.unitText} | C <strong>${formatFixed(row.sampled.close, 3)}</strong>${row.unitText}`
              : `min <strong>${formatFixed(row.sampled.min, 3)}</strong>${row.unitText} | avg <strong>${formatFixed(row.sampled.avg, 3)}</strong>${row.unitText} | max <strong>${formatFixed(row.sampled.max, 3)}</strong>${row.unitText}`;
        return `<div class=\"${activeClass}\"><span style=\"display:inline-block;width:10px;height:10px;background:${row.metric.color};margin-right:6px\"></span>${metricDisplayName(row.metric)}${row.factorText}: ${valuesHtml}</div>`;
      })
      .join("");
    setHoverBoxHtml(
      `<div class=\"fw-semibold mb-1\">${formatAbsoluteTime(t)}</div>${rowsHtml}`,
    );
    hideHoverPoint();
    positionHoverCursorLine(lastLayout.sx(t), margin.top, lastLayout.plotH);

    const rect = dom.chartWrap.getBoundingClientRect();
    const cursorXWrap = clientX - rect.left;
    const preferredRight = cursorXWrap + 12;
    const overflowRight = preferredRight + hoverBoxWidth > rect.width - 8;
    const left = overflowRight
      ? Math.max(8, cursorXWrap - hoverBoxWidth - 12)
      : preferredRight;
    const preferredTop = clientY - rect.top - 16;
    const maxTop = rect.height - hoverBoxHeight - 8;
    const top = Math.max(8, Math.min(preferredTop, maxTop));
    dom.hoverBox.style.left = `${left}px`;
    dom.hoverBox.style.top = `${top}px`;
    return;
  }
  if (
    dom.collapsedLegend &&
    state.sidebarCollapsed &&
    window.innerWidth >= LEGEND_MIN_VIEWPORT_PX
  )
    dom.collapsedLegend.classList.remove("d-none");
  hideHoverCursorLine();
  const candidates = [];
  const plotRight = margin.left + lastLayout.plotW;
  const plotBottom = margin.top + lastLayout.plotH;
  const maxAbsDomain = Math.max(
    1e-9,
    Math.abs(Number(lastLayout?.minY) || 0),
    Math.abs(Number(lastLayout?.maxY) || 0),
  );

  for (const metric of state.metrics) {
    if (!metric.draw) continue;
    const series = state.series.get(metric.name);
    if (!series || series.error) continue;
    const sampled = seriesValueAtTime(metric, series, t);
    if (!sampled) continue;
    const nearestRaw = nearestPointByProximity(
      metric,
      series,
      t,
      cursorX,
      cursorY,
      lastLayout.sx,
      lastLayout.sy,
    );
    if (nearestRaw) {
      const nearestPoint = nearestRaw.point;
      const nearestIndex = nearestRaw.index;
      if (series.mode !== "values" && Number(nearestPoint.count) === 0)
        continue;
      const samplePoints =
        series.mode === "values"
          ? series.points || []
          : series.aggregatePoints || [];
      const sampleT = aggregateDisplayTime(samplePoints, nearestIndex, series);
      const rawValue = pointRenderValue(metric, series, nearestPoint, "avg", {
        points: samplePoints,
        index: nearestIndex,
      });
      if (!Number.isFinite(rawValue)) continue;
      const stacked = stackedValueAt(metric.name, "avg", sampleT);
      const plotValue = Number.isFinite(stacked) ? stacked : rawValue;
      const yPx = lastLayout.sy(plotValue);
      const xPx = lastLayout.sx(sampleT);
      const open = Number(nearestPoint.open);
      const close = Number(nearestPoint.close);
      const ohlc =
        series.mode === "candlestick" &&
        Number.isFinite(open) &&
        Number.isFinite(close)
          ? {
              open: open * metric.factor,
              high: nearestPoint.max * metric.factor,
              low: nearestPoint.min * metric.factor,
              close: close * metric.factor,
            }
          : null;
      if (
        xPx >= margin.left &&
        xPx <= plotRight &&
        yPx >= margin.top &&
        yPx <= plotBottom
      ) {
        const dx = xPx - cursorX;
        const dy = yPx - cursorY;
        candidates.push({
          metric,
          sampled: {
            t: sampleT,
            value: rawValue,
            ohlc,
            activeTimeMs:
              series.mode === "aggregates"
                ? Number(nearestPoint.activeTimeMs) || null
                : null,
          },
          xPx,
          yPx,
          snapPx:
            12 +
            Math.max(0, Math.min(1, Math.abs(rawValue) / maxAbsDomain)) * 18,
          dist2: weightedHoverDist2(dx, dy),
        });
      }
    }
  }

  const selected =
    !yAxisStackingActive() || !Number.isFinite(cursorValue)
      ? selectNearestHoverCandidate(candidates)
      : selectStackedHoverCandidate(candidates, cursorValue, maxAbsDomain);
  const hoverSnapDistancePx = Number.isFinite(selected?.snapPx)
    ? selected.snapPx
    : 22;
  const hoverSnapDistanceSq = hoverSnapDistancePx * hoverSnapDistancePx;

  if (!selected || selected.dist2 > hoverSnapDistanceSq) {
    dom.hoverBox.classList.add("d-none");
    hideHoverPoint();
    hideHoverCursorLine();
    return;
  }

  const selectedPixelX = Math.round(selected.xPx);
  const selectedPixelY = Math.round(selected.yPx);
  const samePixel = candidates.filter(
    (candidate) =>
      Math.round(candidate.xPx) === selectedPixelX &&
      Math.round(candidate.yPx) === selectedPixelY,
  );
  const rows = samePixel.length > 1 ? samePixel : [selected];
  const rowHtml = rows
    .map((row) => {
      const shownUnit = metricShownUnit(row.metric);
      const factor = metricRenderShowsCounts() ? "" : shownMetricFactor(row.metric);
      const factorText = factor ? ` x${factor}` : "";
      const unitSuffix = shownUnit ? ` ${shownUnit}` : "";
      const intervalText = frequencyIntervalText(row.sampled.value);
      const valueHtml = metricRenderShowsCounts()
        ? `freq <strong>${formatFixed(row.sampled.value, 3)}</strong>${unitSuffix}${intervalText ? ` | interval <strong>${intervalText}</strong>` : ""}`
        : row.sampled.ohlc
          ? `O <strong>${formatFixed(row.sampled.ohlc.open, 3)}</strong>${unitSuffix} | H <strong>${formatFixed(row.sampled.ohlc.high, 3)}</strong>${unitSuffix} | L <strong>${formatFixed(row.sampled.ohlc.low, 3)}</strong>${unitSuffix} | C <strong>${formatFixed(row.sampled.ohlc.close, 3)}</strong>${unitSuffix}`
          : `<strong>${formatFixed(row.sampled.value, 3)}</strong>${unitSuffix}`;
      return `<div><span style=\"display:inline-block;width:10px;height:10px;background:${row.metric.color};margin-right:6px\"></span>${metricDisplayName(row.metric)}${factorText}: ${valueHtml}</div>`;
    })
    .join("");
  setHoverBoxHtml(
    `<div class=\"fw-semibold mb-1\">${formatAbsoluteTime(selected.sampled.t)}</div>${rowHtml}`,
  );

  positionHoverPoint(selected.xPx, selected.yPx, selected.metric.color);

  const rect = dom.chartWrap.getBoundingClientRect();
  const cursorXWrap = clientX - rect.left;
  const preferredRight = cursorXWrap + 12;
  const overflowRight = preferredRight + hoverBoxWidth > rect.width - 8;
  const left = overflowRight
    ? Math.max(8, cursorXWrap - hoverBoxWidth - 12)
    : preferredRight;
  dom.hoverBox.style.left = `${left}px`;
  const preferredTop = clientY - rect.top - 16;
  const maxTop = rect.height - hoverBoxHeight - 8;
  const top = Math.max(8, Math.min(preferredTop, maxTop));
  dom.hoverBox.style.top = `${top}px`;
}

export function showHover(event) {
  if (state.interactionMode === "zoom-select" || state.isPanning) return;
  lastHoverClientX = event.clientX;
  lastHoverClientY = event.clientY;
  if (hoverRafId) return;
  hoverRafId = window.requestAnimationFrame(() => {
    hoverRafId = 0;
    if (state.interactionMode === "zoom-select" || state.isPanning) return;
    if (lastHoverClientX == null || lastHoverClientY == null) return;
    renderHoverAt(lastHoverClientX, lastHoverClientY);
  });
}

export function refreshHover() {
  if (lastHoverClientX == null || lastHoverClientY == null) return;
  if (dom.hoverBox.classList.contains("d-none")) return;
  renderHoverAt(lastHoverClientX, lastHoverClientY);
}

export function hideHover() {
  if (hoverRafId) {
    window.cancelAnimationFrame(hoverRafId);
    hoverRafId = 0;
  }
  lastHoverClientX = null;
  lastHoverClientY = null;
  hoverBoxContentKey = "";
  dom.hoverBox.classList.add("d-none");
  if (dom.collapsedLegend) dom.collapsedLegend.classList.remove("is-faded");
  hideHoverPoint();
  hideHoverCandle();
  hideHoverCursorLine();
}

export function panByPixels(deltaX) {
  const width = dom.canvas.getBoundingClientRect().width;
  const range = state.panRangeEnd - state.panRangeStart;
  const dt = (deltaX / width) * range;
  state.from = Math.round(state.panRangeStart - dt);
  state.to = Math.round(state.panRangeEnd - dt);
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
  updateRangeButtonLabel();
  renderChart();
  refreshHover();
}

export function zoomAt(centerMs, factor, onZoomCommit) {
  const old = state.to - state.from;
  const next = old * factor;
  if (next < MIN_ZOOM_RANGE_MS || next > MAX_ZOOM_RANGE_MS) return;

  const rel = (centerMs - state.from) / old;
  state.from = Math.round(centerMs - next * rel);
  state.to = Math.round(centerMs + next * (1 - rel));
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
  updateRangeButtonLabel();
  renderChart();
  refreshHover();
  onZoomCommit();
}
