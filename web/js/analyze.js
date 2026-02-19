import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { state } from "./model.js";
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
      metrics: state.metrics.map((m) => m.name),
      from: state.from,
      to: state.to,
    }),
  });

  dom.analyzeTableBody.innerHTML = "";
  for (const entry of body.entries || []) {
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
