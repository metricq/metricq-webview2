import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { formatFactor } from "./factor-format.mjs";
import { metricByName, metricDisplayName, state } from "./model.js";
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
  const resolved = await buildQueryTargetsResolved(visibleMetrics, async (metricName) => {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metricName)}`);
    return body?.metadata?.unit || "";
  });

  return resolved.map((target) => {
    const metric = metricByName(target.name);
    const factorText = formatFactor(metric?.factor, 12);
    if (!factorText) return target;
    if (target.expr) return { name: target.name, expr: `(${target.expr})*${factorText}` };
    return { name: target.name, expr: `([${target.name}]*${factorText})` };
  });
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
      tr.appendChild(createCell(entry.minimum.toFixed(3), "text-end"));
      tr.appendChild(createCell(entry.mean.toFixed(3), "text-end"));
      tr.appendChild(createCell(entry.maximum.toFixed(3), "text-end"));
      tr.appendChild(createCell(String(entry.count), "text-end"));
    }
    dom.analyzeTableBody.appendChild(tr);
  }
}
