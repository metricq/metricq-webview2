import { dom } from "./dom.js";
import { state } from "./model.js";
import { toLocalInput, updateRangeButtonLabel } from "./utils.js";
import { buildXTicks, formatAbsoluteTime, formatAxisTime, pickTimeTickStep } from "./time-axis.mjs";
import { resolveYAxisDomain } from "./y-axis.mjs";

export const MIN_ZOOM_RANGE_MS = 1000;
export const MAX_ZOOM_RANGE_MS = 1000 * 3600 * 24 * 365 * 25;

let lastHoverClientX = null;
let lastHoverClientY = null;
let lastLayout = null;
let hoverPointEl = null;

function formatFactor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(6).replace(/\.?0+$/, "");
}

function shownMetricFactor(metric) {
  if (metric.factorMode === "manual") return formatFactor(metric.manualFactor);
  return null;
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

function updateCollapsedLegendFade(clientX, clientY) {
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

  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return { minY: 0, maxY: 1 };
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
    if (rounded >= minY - step * 0.2 && rounded <= maxY + step * 0.2) ticks.push(rounded);
    if (ticks.length > 24) break;
  }
  if (ticks.length === 0) return [minY, maxY];
  return ticks;
}

function formatYTickLabels(ticks) {
  if (!Array.isArray(ticks) || ticks.length === 0) return [];
  const maxDecimals = 8;
  for (let decimals = 0; decimals <= maxDecimals; decimals += 1) {
    const labels = ticks.map((value) => value.toFixed(decimals));
    if (new Set(labels).size === labels.length) return labels;
  }
  return ticks.map((value) => value.toPrecision(10));
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
  if (rangeMs < 2 * 24 * 60 * 60 * 1000) {
    if (tickStepMs < 1000) {
      return `${day}.${month}.${year} ${hour}:${minute}:${second}.${millis}`;
    }
    if (tickStepMs < 60_000) {
      return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
    }
    return `${day}.${month}.${year} ${hour}:${minute}`;
  }
  if (rangeMs >= 365 * 24 * 60 * 60 * 1000) {
    return `${month}.${year}`;
  }
  if (rangeMs >= 30 * 24 * 60 * 60 * 1000) {
    return `${day}.${month}.${year}`;
  }
  if (rangeMs >= 2 * 24 * 60 * 60 * 1000) {
    return `${day}.${month}.${year}`;
  }
  return `${day}.${month} ${hour}:${minute}`;
}

function resizeCanvas() {
  const rect = dom.chartWrap.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  dom.canvas.width = Math.floor(rect.width * ratio);
  dom.canvas.height = Math.floor(rect.height * ratio);
  dom.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
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
  }

  const seriesList = getVisibleSeries();
  if (seriesList.length === 0) {
    ctx.fillStyle = "#000000";
    ctx.font = "14px sans-serif";
    ctx.fillText("Keine sichtbaren Daten", margin.left + 8, margin.top + 24);
    return;
  }

  const domain = resolveYAxisDomain(seriesList);
  state.yAxisCurrentMin = domain.minY;
  state.yAxisCurrentMax = domain.maxY;
  const xMin = state.from;
  const xMax = state.to;
  const sx = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y) => margin.top + (1 - (y - domain.minY) / (domain.maxY - domain.minY)) * plotH;
  lastLayout = { margin, plotW, plotH, sx, sy };

  const yTicks = buildYTicks(domain.minY, domain.maxY, plotH);

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

  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "right";
  const yTickLabels = formatYTickLabels(yTicks);
  for (let i = 0; i < yTicks.length; i += 1) {
    const value = yTicks[i];
    const y = sy(value);
    ctx.fillText(yTickLabels[i], margin.left - 6, y + 4);
  }

  const rangeMs = xMax - xMin;
  const targetTicks = Math.max(4, Math.floor(plotW / 110));
  const tickStepMs = pickTimeTickStep(rangeMs, targetTicks);
  const xTicks = buildXTicks(xMin, xMax, tickStepMs);
  const maxVerticalGridLines = Math.max(4, Math.floor(plotW / 95));
  const gridStride = Math.max(1, Math.ceil(xTicks.length / maxVerticalGridLines));

  ctx.strokeStyle = "#e7ebf3";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  for (let i = 0; i < xTicks.length; i += 1) {
    const tick = xTicks[i];
    const x = sx(tick);
    if (i % gridStride !== 0) continue;

    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, height - margin.bottom);
    ctx.stroke();

    const label = i === 0
      ? formatReferenceLabel(tick, rangeMs, tickStepMs)
      : formatAxisTime(tick, rangeMs, tickStepMs);
    ctx.fillText(label, x, height - 9);
  }

  // Clip all series drawing to the actual plot region between axes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  for (const item of seriesList) {
    const { metric, series } = item;
    ctx.strokeStyle = metric.color;
    ctx.fillStyle = metric.color;
    ctx.lineWidth = 1.5;

    if (series.mode === "values") {
      const points = series.points || [];
      if (!metric.drawAvg || points.length === 0) continue;
      const isComputedValues = String(series?.stats?.type || "") === "computed";

      if (isComputedValues) {
        ctx.beginPath();
        for (let i = 0; i < points.length; i += 1) {
          const p = points[i];
          const x = sx(p.t);
          const y = sy(p.v * metric.factor);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        continue;
      }

      const radius = points.length > 2500 ? 1.2 : 1.8;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const x = sx(p.t);
        const y = sy(p.v * metric.factor);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }

    const points = series.aggregatePoints || [];
    if (points.length === 0) continue;

    const runs = [];
    let run = [];
    for (const p of points) {
      if (Number(p.count) > 0) {
        run.push(p);
      } else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);

    ctx.save();
    ctx.globalAlpha = 0.2;
    for (const segment of runs) {
      if (segment.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < segment.length; i += 1) {
        const p = segment[i];
        if (i === 0) ctx.moveTo(sx(p.t), sy(p.min * metric.factor));
        else ctx.lineTo(sx(p.t), sy(p.min * metric.factor));
      }
      for (let i = segment.length - 1; i >= 0; i -= 1) {
        const p = segment[i];
        ctx.lineTo(sx(p.t), sy(p.max * metric.factor));
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (metric.drawAvg) {
      for (const segment of runs) {
        if (segment.length === 0) continue;
        ctx.beginPath();
        for (let i = 0; i < segment.length; i += 1) {
          const p = segment[i];
          if (i === 0) ctx.moveTo(sx(p.t), sy(p.avg * metric.factor));
          else ctx.lineTo(sx(p.t), sy(p.avg * metric.factor));
        }
        ctx.stroke();
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

function seriesValueAtTime(metric, series, t) {
  const points = series.mode === "values" ? (series.points || []) : (series.aggregatePoints || []);
  if (points.length === 0) return null;

  let best = points[0];
  let bestDiff = Math.abs(points[0].t - t);
  for (const p of points) {
    if (series.mode !== "values" && Number(p.count) === 0) continue;
    const d = Math.abs(p.t - t);
    if (d < bestDiff) {
      best = p;
      bestDiff = d;
    }
  }
  if (series.mode !== "values" && Number(best.count) === 0) return null;

  return {
    t: best.t,
    value: series.mode === "values" ? best.v * metric.factor : best.avg * metric.factor,
  };
}

function pointValue(series, point, factor) {
  if (series.mode !== "values" && Number(point?.count) === 0) return null;
  return (series.mode === "values" ? point.v : point.avg) * factor;
}

function nearestPointByProximity(metric, series, t, cursorX, cursorY, sx, sy) {
  const points = series.mode === "values" ? (series.points || []) : (series.aggregatePoints || []);
  if (points.length === 0) return null;

  // For small series, exact scan is cheap and gives best spatial match.
  if (points.length <= 1200) {
    let best = null;
    let bestDist2 = Number.POSITIVE_INFINITY;
    for (const p of points) {
      const x = sx(p.t);
      const value = pointValue(series, p, metric.factor);
      if (!Number.isFinite(value)) continue;
      const y = sy(value);
      const dx = x - cursorX;
      const dy = y - cursorY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        best = p;
        bestDist2 = d2;
      }
    }
    return best;
  }

  // For large series, binary-search in time then scan a local window in both directions.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }

  let best = points[lo];
  let bestDist2 = Number.POSITIVE_INFINITY;
  const radius = 28;
  const from = Math.max(0, lo - radius);
  const to = Math.min(points.length - 1, lo + radius);
  for (let i = from; i <= to; i += 1) {
    const p = points[i];
    const x = sx(p.t);
    const value = pointValue(series, p, metric.factor);
    if (!Number.isFinite(value)) continue;
    const y = sy(value);
    const dx = x - cursorX;
    const dy = y - cursorY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      best = p;
      bestDist2 = d2;
    }
  }
  return best;
}

function renderHoverAt(clientX, clientY) {
  if (!lastLayout) return;
  updateCollapsedLegendFade(clientX, clientY);
  const t = timestampAtCanvasX(clientX);
  const candidates = [];
  const canvasRect = dom.canvas.getBoundingClientRect();
  const cursorX = clientX - canvasRect.left;
  const cursorY = clientY - canvasRect.top;
  const margin = lastLayout.margin;
  const plotRight = margin.left + lastLayout.plotW;
  const plotBottom = margin.top + lastLayout.plotH;

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
      if (series.mode !== "values" && Number(nearestRaw.count) === 0) continue;
      const nearestValue = series.mode === "values"
        ? nearestRaw.v * metric.factor
        : nearestRaw.avg * metric.factor;
      const yPx = lastLayout.sy(nearestValue);
      const xPx = lastLayout.sx(nearestRaw.t);
      if (xPx >= margin.left && xPx <= plotRight && yPx >= margin.top && yPx <= plotBottom) {
        const dx = xPx - cursorX;
        const dy = yPx - cursorY;
        candidates.push({
          metric,
          sampled: { t: nearestRaw.t, value: nearestValue },
          xPx,
          yPx,
          dist2: dx * dx + dy * dy,
        });
      }
    }
  }

  let selected = null;
  for (const candidate of candidates) {
    if (!selected || candidate.dist2 < selected.dist2) selected = candidate;
  }
  const hoverSnapDistancePx = 22;
  const hoverSnapDistanceSq = hoverSnapDistancePx * hoverSnapDistancePx;

  if (!selected || selected.dist2 > hoverSnapDistanceSq) {
    dom.hoverBox.classList.add("d-none");
    hideHoverPoint();
    return;
  }

  const shownUnit = selected.metric.displayUnit || selected.metric.unit;
  const factor = shownMetricFactor(selected.metric);
  const factorText = factor ? ` x${factor}` : "";
  const rowHtml = `<div><span style=\"display:inline-block;width:10px;height:10px;background:${selected.metric.color};margin-right:6px\"></span>${selected.metric.name}${factorText}: <strong>${selected.sampled.value.toFixed(3)}</strong>${shownUnit ? ` ${shownUnit}` : ""}</div>`;
  dom.hoverBox.innerHTML = `<div class=\"fw-semibold mb-1\">${formatAbsoluteTime(selected.sampled.t)}</div>${rowHtml}`;
  dom.hoverBox.classList.remove("d-none");

  positionHoverPoint(selected.xPx, selected.yPx, selected.metric.color);

  const rect = dom.chartWrap.getBoundingClientRect();
  const hoverWidth = dom.hoverBox.offsetWidth || 220;
  const cursorXWrap = clientX - rect.left;
  const preferredRight = cursorXWrap + 12;
  const overflowRight = preferredRight + hoverWidth > rect.width - 8;
  const left = overflowRight
    ? Math.max(8, cursorXWrap - hoverWidth - 12)
    : preferredRight;
  dom.hoverBox.style.left = `${left}px`;
  dom.hoverBox.style.top = `${Math.max(10, clientY - rect.top - 16)}px`;
}

export function showHover(event) {
  if (state.interactionMode === "zoom-select" || state.isPanning) return;
  lastHoverClientX = event.clientX;
  lastHoverClientY = event.clientY;
  renderHoverAt(event.clientX, event.clientY);
}

export function refreshHover() {
  if (lastHoverClientX == null || lastHoverClientY == null) return;
  if (dom.hoverBox.classList.contains("d-none")) return;
  renderHoverAt(lastHoverClientX, lastHoverClientY);
}

export function hideHover() {
  lastHoverClientX = null;
  lastHoverClientY = null;
  dom.hoverBox.classList.add("d-none");
  if (dom.collapsedLegend) dom.collapsedLegend.classList.remove("is-faded");
  hideHoverPoint();
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
