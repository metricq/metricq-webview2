import { apiFetch } from "./api.js";
import { applyAutoScaling } from "./auto-factor.mjs";
import { renderCollapsedLegend } from "./collapsed-legend.js";
import { dom } from "./dom.js";
import { colors, metricByName, state } from "./model.js";
import { sanitizeFactor } from "./factors.mjs";
import { normalizeSIUnit } from "./units.mjs";

let factorMetricName = "";

function formatFactor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - 1) < 1e-12) return null;
  return num.toPrecision(6).replace(/\.?0+$/, "");
}

export function addMetric(name, hooks) {
  if (!name || metricByName(name)) return;
  state.metrics.push({
    name,
    color: colors[state.metrics.length % colors.length],
    draw: true,
    drawAvg: true,
    factor: 1,
    factorMode: "auto",
    unit: "",
    displayUnit: "",
    description: "",
  });
  renderMetricList(hooks);
  hooks.loadData();
  fetchMetadata(name, hooks);
}

export function removeMetric(name, hooks) {
  state.metrics = state.metrics.filter((m) => m.name !== name);
  state.series.delete(name);
  renderMetricList(hooks);
  hooks.renderChart();
}

export function recolorMetrics(hooks) {
  state.metrics.forEach((m, i) => {
    m.color = colors[(i + Math.floor(Math.random() * colors.length)) % colors.length];
  });
  renderMetricList(hooks);
  hooks.renderChart();
}

export function setAllVisible(draw, hooks) {
  for (const m of state.metrics) m.draw = draw;
  renderMetricList(hooks);
  hooks.renderChart();
}

export function clearMetrics(hooks) {
  state.metrics = [];
  state.series.clear();
  factorMetricName = "";
  renderMetricList(hooks);
  hooks.renderChart();
}

export async function fetchMetadata(name, hooks) {
  try {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(name)}`);
    const metric = metricByName(name);
    if (!metric) return;
    metric.unit = normalizeSIUnit(body?.metadata?.unit);
    if (metric.factorMode !== "manual") metric.displayUnit = metric.unit;
    metric.description = String(body.metadata.description || "");
    applyAutoScaling(state.metrics, state.series);
    renderMetricList(hooks);
    hooks.renderChart();
  } catch (_) {}
}

export async function searchMetricHints(query) {
  if (query.length < 2) return [];
  try {
    const body = await apiFetch(`/api/metrics?query=${encodeURIComponent(query)}&limit=25`);
    return body.metrics || [];
  } catch (_) {
    return [];
  }
}

export function renderHints(hints, hooks) {
  dom.metricHints.innerHTML = "";
  for (const name of hints) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "metric-chip";
    chip.textContent = name;
    chip.addEventListener("click", () => addMetric(name, hooks));
    dom.metricHints.appendChild(chip);
  }
}

export function renderMetricList(hooks) {
  dom.metricList.innerHTML = "";
  for (const metric of state.metrics) {
    const li = document.createElement("li");
    li.className = "list-group-item py-1 px-1";

    const row = document.createElement("div");
    row.className = "metric-list-item" + (metric.draw ? "" : " metric-muted");
    row.dataset.metricName = metric.name;

    const swatchButton = document.createElement("button");
    swatchButton.type = "button";
    swatchButton.className = "metric-color-button";
    swatchButton.title = "Farbe wählen";

    const swatch = document.createElement("span");
    swatch.className = "metric-color";
    swatch.style.background = metric.color;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "metric-color-input";
    colorInput.value = metric.color;
    colorInput.setAttribute("aria-label", `Farbe fuer ${metric.name}`);
    colorInput.addEventListener("input", () => {
      metric.color = colorInput.value;
      swatch.style.background = metric.color;
      renderCollapsedLegend();
      hooks.renderChart();
    });

    swatchButton.addEventListener("click", () => {
      colorInput.click();
    });
    swatchButton.appendChild(swatch);

    const center = document.createElement("div");
    center.className = "metric-name";
    const shownUnit = metric.displayUnit || metric.unit;
    const shownFactor = metric.factorMode === "manual" ? formatFactor(metric.factor) : null;
    const factorSuffix = shownFactor ? ` x${shownFactor}` : "";
    const mainText = document.createElement("div");
    mainText.className = "metric-name-main";
    mainText.textContent = metric.name + (shownUnit ? ` [${shownUnit}]` : "") + factorSuffix;
    center.appendChild(mainText);
    const description = String(metric.description || "").trim();
    if (description) {
      const desc = document.createElement("div");
      desc.className = "metric-name-desc";
      desc.textContent = description;
      center.appendChild(desc);
    }
    center.title = metric.description || metric.name;

    const controls = document.createElement("div");
    controls.className = "btn-group btn-group-sm";
    const toggleButtonClass = metric.draw ? "btn-outline-secondary" : "btn-secondary";
    const toggleIcon = metric.draw ? "bi-eye" : "bi-eye-slash";
    controls.innerHTML = `
      <button class="btn ${toggleButtonClass}" data-action="toggle" title="Ein/Aus"><i class="bi ${toggleIcon}"></i></button>
      <button class="btn btn-outline-secondary" data-action="factor" title="Faktor"><i class="bi bi-123"></i></button>
      <button class="btn btn-outline-danger" data-action="delete" title="Entfernen"><i class="bi bi-x-lg"></i></button>
    `;

    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "toggle") {
        metric.draw = !metric.draw;
        renderMetricList(hooks);
        hooks.renderChart();
      } else if (action === "delete") {
        removeMetric(metric.name, hooks);
      } else if (action === "factor") {
        openFactorModal(metric.name);
      }
    });

    row.append(swatchButton, colorInput, center, controls);
    li.appendChild(row);
    dom.metricList.appendChild(li);
  }
  renderCollapsedLegend();
}

function openFactorModal(metricName) {
  const metric = metricByName(metricName);
  if (!metric) return;
  factorMetricName = metricName;
  dom.factorMetricName.textContent = metricName;
  dom.factorInput.value = String(metric.factor ?? 1);
  if (globalThis.bootstrap?.Modal) {
    globalThis.bootstrap.Modal.getOrCreateInstance(dom.factorModal).show();
  }
}

export function applyFactorFromModal(hooks) {
  if (!factorMetricName) return;
  const metric = metricByName(factorMetricName);
  if (!metric) return;
  metric.factor = sanitizeFactor(dom.factorInput.value, metric.factor || 1);
  metric.factorMode = "manual";
  metric.displayUnit = metric.unit || "";
  renderMetricList(hooks);
  hooks.renderChart();
  if (globalThis.bootstrap?.Modal) {
    globalThis.bootstrap.Modal.getOrCreateInstance(dom.factorModal).hide();
  }
}
