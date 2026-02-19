import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { state } from "./model.js";
import { parseRangeFromInputs } from "./utils.js";
import { buildQueryTargets } from "./targets.mjs";

function metricByName(name) {
  return state.metrics.find((m) => m.name === name) || null;
}

function createCell(text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function createColorCell(color) {
  const td = document.createElement("td");
  const swatch = document.createElement("span");
  swatch.style.display = "inline-block";
  swatch.style.width = "12px";
  swatch.style.height = "12px";
  swatch.style.borderRadius = "2px";
  swatch.style.background = color || "#9aa3b2";
  td.appendChild(swatch);
  return td;
}

async function ensureDescriptions() {
  const missing = state.metrics.filter((m) => !String(m.description || "").trim());
  await Promise.all(
    missing.map(async (metric) => {
      try {
        const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metric.name)}`);
        metric.description = String(body?.metadata?.description || "");
      } catch (_) {}
    }),
  );
}

export async function runAnalyze() {
  if (state.metrics.length === 0) {
    dom.analyzeTableBody.innerHTML = "";
    return;
  }

  await ensureDescriptions();
  parseRangeFromInputs();
  const baseTargets = buildQueryTargets(state.metrics).filter((target) => !target.expr);
  let baseEntries = [];
  if (baseTargets.length > 0) {
    const body = await apiFetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metrics: baseTargets.map((target) => target.name),
        from: state.from,
        to: state.to,
      }),
    });
    baseEntries = body.entries || [];
  }

  const byMetric = new Map(baseEntries.map((entry) => [entry.metric, entry]));
  for (const metric of state.metrics) {
    if (!metric.expr) continue;
    byMetric.set(metric.name, analyzeExpressionMetric(metric));
  }

  dom.analyzeTableBody.innerHTML = "";
  for (const metricRow of state.metrics) {
    const entry = byMetric.get(metricRow.name);
    if (!entry) continue;
    const metric = metricByName(entry.metric);
    const tr = document.createElement("tr");
    tr.appendChild(createColorCell(metric?.color));
    tr.appendChild(createCell(entry.metric));
    tr.appendChild(createCell(metric?.description || ""));

    if (entry.error) {
      const err = createCell(entry.error, "text-danger");
      err.colSpan = 4;
      tr.appendChild(err);
    } else {
      tr.appendChild(createCell(entry.minimum.toFixed(3), "text-end"));
      tr.appendChild(createCell(entry.mean.toFixed(3), "text-end"));
      tr.appendChild(createCell(entry.maximum.toFixed(3), "text-end"));
      tr.appendChild(createCell(String(entry.count), "text-end"));
    }
    dom.analyzeTableBody.appendChild(tr);
  }
}

function analyzeExpressionMetric(metric) {
  const series = state.series.get(metric.name);
  if (!series || series.error) {
    return { metric: metric.name, error: series?.error || "keine Daten" };
  }

  const factor = Number(metric.factor) || 1;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;

  if (series.mode === "values") {
    for (const point of series.points || []) {
      const value = point.v * factor;
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
      count += 1;
    }
  } else {
    for (const point of series.aggregatePoints || []) {
      const pointCount = Math.max(1, Number(point.count) || 1);
      const avgValue = point.avg * factor;
      const minValue = point.min * factor;
      const maxValue = point.max * factor;
      if (Number.isFinite(minValue) && minValue < min) min = minValue;
      if (Number.isFinite(maxValue) && maxValue > max) max = maxValue;
      if (Number.isFinite(avgValue)) {
        sum += avgValue * pointCount;
        count += pointCount;
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 0) {
    return { metric: metric.name, error: "keine Daten" };
  }
  return {
    metric: metric.name,
    minimum: min,
    maximum: max,
    mean: sum / count,
    count,
  };
}
