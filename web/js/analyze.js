import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { state } from "./model.js";
import { buildComputedExpression } from "./targets.mjs";
import { parseRangeFromInputs } from "./utils.js";

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

function formatFactor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(12).replace(/\.?0+$/, "");
}

function buildAnalyzeTargets() {
  return state.metrics
    .map((metric) => {
      const name = String(metric?.name || "").trim();
      if (!name) return null;
      const factorText = formatFactor(metric.factor);

      if (metric.expr) {
        let expr = buildComputedExpression(metric.expr, state.metrics);
        if (factorText) expr = `(${expr})*${factorText}`;
        return { name, expr };
      }

      if (!factorText) return { name, metric: name };
      return { name, expr: `([${name}]*${factorText})` };
    })
    .filter(Boolean);
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
  const body = await apiFetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: buildAnalyzeTargets(),
      from: state.from,
      to: state.to,
    }),
  });
  const byMetric = new Map((body.entries || []).map((entry) => [entry.metric, entry]));

  dom.analyzeTableBody.innerHTML = "";
  for (const metricRow of state.metrics) {
    const entry = byMetric.get(metricRow.name);
    if (!entry) continue;
    const metric = metricByName(entry.metric);
    const tr = document.createElement("tr");
    tr.appendChild(createColorCell(metric?.color));
    tr.appendChild(createCell(entry.metric));
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
