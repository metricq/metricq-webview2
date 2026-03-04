import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { metricByName, metricDisplayName, state } from "./model.js";
import { formatFixed, formatInteger } from "./number-format.mjs";
import { buildQueryTargetsResolved } from "./targets.mjs";
import { parseRangeFromInputs } from "./utils.js";

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

async function buildAnalyzeTargets() {
  const visibleMetrics = state.metrics.filter((metric) => metric.draw);
  const now = Date.now();
  const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
  return buildQueryTargetsResolved(visibleMetrics, async (metricName) => {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metricName)}`);
    return body?.metadata?.unit || "";
  }, async (metricName) => {
    const body = await apiFetch("/api/query/range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metrics: [metricName],
        from: now - tenYearsMs,
        to: now,
      }),
    });
    return { minimum: body?.minimum, maximum: body?.maximum };
  });
}

function scaleAnalyzeValue(value, factor) {
  const num = Number(value);
  if (!Number.isFinite(num)) return num;
  return num * factor;
}

function scaledAnalyzeStats(entry, factor) {
  const minimum = scaleAnalyzeValue(entry.minimum, factor);
  const maximum = scaleAnalyzeValue(entry.maximum, factor);
  return {
    minimum: Math.min(minimum, maximum),
    mean: scaleAnalyzeValue(entry.mean, factor),
    maximum: Math.max(minimum, maximum),
    sum: scaleAnalyzeValue(entry.sum, factor),
    count: entry.count,
  };
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
  const visibleMetrics = state.metrics.filter((metric) => metric.draw);
  if (visibleMetrics.length === 0) {
    dom.analyzeTableBody.innerHTML = "";
    return;
  }

  await ensureDescriptions();
  parseRangeFromInputs();
  const body = await apiFetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: await buildAnalyzeTargets(),
      from: state.from,
      to: state.to,
    }),
  });
  const byMetric = new Map((body.entries || []).map((entry) => [entry.metric, entry]));

  dom.analyzeTableBody.innerHTML = "";
  for (const metricRow of visibleMetrics) {
    const entry = byMetric.get(metricRow.name);
    if (!entry) continue;
    const metric = metricByName(entry.metric);
    const tr = document.createElement("tr");
    tr.appendChild(createColorCell(metric?.color));
    tr.appendChild(createCell(metric ? metricDisplayName(metric) : entry.metric));
    tr.appendChild(createCell(metric?.description || ""));
    tr.appendChild(createCell(metric?.displayUnit || metric?.unit || ""));

    if (entry.error) {
      const err = createCell(entry.error, "text-danger");
      err.colSpan = 4;
      tr.appendChild(err);
    } else {
      const factor = Number(metric?.factor);
      const scaled = scaledAnalyzeStats(entry, Number.isFinite(factor) ? factor : 1);
      tr.appendChild(createCell(formatFixed(scaled.minimum, 3), "text-end"));
      tr.appendChild(createCell(formatFixed(scaled.mean, 3), "text-end"));
      tr.appendChild(createCell(formatFixed(scaled.maximum, 3), "text-end"));
      tr.appendChild(createCell(formatInteger(scaled.count), "text-end"));
    }
    dom.analyzeTableBody.appendChild(tr);
  }
}
