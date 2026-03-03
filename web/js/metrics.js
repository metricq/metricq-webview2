import { apiFetch } from "./api.js";
import { applyAutoScaling } from "./auto-factor.mjs";
import { renderCollapsedLegend } from "./collapsed-legend.js";
import { dom } from "./dom.js";
import { collectExpressionReferences } from "./expression-refs.mjs";
import { formatFactor, shownMetricFactor } from "./factor-format.mjs";
import { colors, metricByName, metricDisplayName, state } from "./model.js";
import { sanitizeFactor } from "./factors.mjs";
import { formatSIUnit, parseSIUnit, SI_PREFIXES } from "./si-units.mjs";
import { normalizeSIUnit } from "./units.mjs";

let factorMetricName = "";
let draggingMetricName = "";
const externalScaleCache = new Map();
const metricHintMetadataCache = new Map();
let metricHintHoverEl = null;
let hoveredHintMetricName = "";

function ensureMetricHintHoverElement() {
  if (metricHintHoverEl) return metricHintHoverEl;
  metricHintHoverEl = document.createElement("div");
  metricHintHoverEl.className = "expression-token-hover d-none";
  document.body.appendChild(metricHintHoverEl);
  return metricHintHoverEl;
}

function renderMetricHintHoverHtml(metricName, details) {
  const unitPart = details?.unit ? ` [${details.unit}]` : "";
  const desc = details?.description || "-";
  return `
    <div class="expression-token-hover-name">${metricName}${unitPart}</div>
    <div class="expression-token-hover-desc">${desc}</div>
  `;
}

function showMetricHintHover(clientX, clientY, html) {
  const el = ensureMetricHintHoverElement();
  el.innerHTML = html;
  positionMetricHintHover(el, clientX, clientY);
  el.classList.remove("d-none");
}

function moveMetricHintHover(clientX, clientY) {
  if (!metricHintHoverEl || metricHintHoverEl.classList.contains("d-none")) return;
  positionMetricHintHover(metricHintHoverEl, clientX, clientY);
}

function hideMetricHintHover() {
  if (!metricHintHoverEl) return;
  metricHintHoverEl.classList.add("d-none");
}

function positionMetricHintHover(el, clientX, clientY) {
  const pad = 8;
  const offsetX = 12;
  const offsetY = 14;
  const width = el.offsetWidth || 220;
  const height = el.offsetHeight || 120;
  const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;

  const preferRight = clientX + offsetX;
  const rightOverflow = preferRight + width > viewportW - pad;
  const left = rightOverflow
    ? Math.max(pad, clientX - width - offsetX)
    : Math.max(pad, Math.min(preferRight, viewportW - width - pad));

  const preferTop = clientY + offsetY;
  const top = Math.max(pad, Math.min(preferTop, viewportH - height - pad));

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function metricDetailsFromState(metricName) {
  const metric = metricByName(metricName);
  if (!metric) return null;
  return {
    unit: String(metric.displayUnit || metric.unit || "").trim(),
    description: String(metric.description || "").trim(),
  };
}

async function fetchMetricHintDetails(metricName) {
  const cached = metricHintMetadataCache.get(metricName);
  if (cached) return cached;
  const local = metricDetailsFromState(metricName);
  if (local && (local.unit || local.description)) {
    metricHintMetadataCache.set(metricName, local);
    return local;
  }
  try {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metricName)}`);
    const details = {
      unit: normalizeSIUnit(body?.metadata?.unit),
      description: String(body?.metadata?.description || "").trim(),
    };
    metricHintMetadataCache.set(metricName, details);
    return details;
  } catch (_) {
    const empty = { unit: "", description: "" };
    metricHintMetadataCache.set(metricName, empty);
    return empty;
  }
}

function bindMetricHintHover(element, metricName) {
  const show = async (event) => {
    const x = event.clientX || 0;
    const y = event.clientY || 0;
    hoveredHintMetricName = metricName;
    showMetricHintHover(x, y, renderMetricHintHoverHtml(metricName, null));
    const details = await fetchMetricHintDetails(metricName);
    if (hoveredHintMetricName !== metricName) return;
    showMetricHintHover(x, y, renderMetricHintHoverHtml(metricName, details));
  };
  element.addEventListener("mouseenter", show);
  element.addEventListener("mousemove", (event) => moveMetricHintHover(event.clientX, event.clientY));
  element.addEventListener("mouseleave", () => {
    if (hoveredHintMetricName === metricName) hoveredHintMetricName = "";
    hideMetricHintHover();
  });
}

function chooseDisplayExpFromRepresentative(repBase) {
  if (!Number.isFinite(repBase) || repBase <= 0) return null;
  const baseLog = Math.log10(repBase);
  let bestExp = SI_PREFIXES[0].exp;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of SI_PREFIXES) {
    const transformedLog = baseLog - entry.exp;
    let score = 0;
    if (transformedLog < -0.2) score += (-0.2 - transformedLog) * 3.0;
    else if (transformedLog < 0) score += -transformedLog;
    if (transformedLog > 3) score += (transformedLog - 3) * 1.8;
    score += Math.abs(transformedLog - 1.2) * 0.1;
    if (score < bestScore || (score === bestScore && entry.exp > bestExp)) {
      bestScore = score;
      bestExp = entry.exp;
    }
  }
  return bestExp;
}

async function resolveExternalReferenceScale(metricName) {
  const key = String(metricName || "").trim();
  if (!key) return null;
  if (externalScaleCache.has(key)) return externalScaleCache.get(key);

  let unit = "";
  try {
    const metadata = await apiFetch(`/api/metadata?metric=${encodeURIComponent(key)}`);
    unit = normalizeSIUnit(metadata?.metadata?.unit || "");
  } catch (_) {
    unit = "";
  }
  const parsedUnit = parseSIUnit(unit);
  if (!parsedUnit) {
    externalScaleCache.set(key, null);
    return null;
  }

  let displayUnit = unit;
  let normalization = 1;
  try {
    const now = Date.now();
    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
    const body = await apiFetch("/api/query/range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metrics: [key],
        from: now - tenYearsMs,
        to: now,
      }),
    });
    const minimum = Number(body?.minimum);
    const maximum = Number(body?.maximum);
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
      const rep = Math.max(Math.abs(minimum), Math.abs(maximum));
      if (rep > 0) {
        const repBase = rep * (10 ** parsedUnit.exp);
        const displayExp = chooseDisplayExpFromRepresentative(repBase);
        if (Number.isFinite(displayExp)) {
          normalization = 10 ** (parsedUnit.exp - displayExp);
          displayUnit = formatSIUnit(parsedUnit.family, displayExp);
        }
      }
    }
  } catch (_) {}

  const out = { unit, displayUnit, normalization };
  externalScaleCache.set(key, out);
  return out;
}

async function resolveReferenceNormalizationInfo(metricName) {
  const refName = String(metricName || "").trim();
  if (!refName) return null;
  const local = metricByName(refName);
  if (local) {
    const refUnit = String(local.unit || "").trim();
    const refDisplayUnit = String(local.displayUnit || "").trim();
    const refManual = local.factorMode === "manual"
      ? sanitizeFactor(local.manualFactor, 1)
      : 1;
    const refEffective = sanitizeFactor(local.factor, 1);
    const refNormalization = sanitizeFactor(refEffective / refManual, 1);
    return {
      name: refName,
      unit: refUnit,
      displayUnit: refDisplayUnit,
      normalization: refNormalization,
    };
  }
  const external = await resolveExternalReferenceScale(refName);
  if (!external) return null;
  return {
    name: refName,
    unit: String(external.unit || ""),
    displayUnit: String(external.displayUnit || ""),
    normalization: sanitizeFactor(external.normalization, 1),
  };
}
function createSeededRng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6D2B79F5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed32() {
  if (globalThis.crypto?.getRandomValues) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

function shuffled(values, rand) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function recolorForIndex(index, seed) {
  // Distinct colors, but seed-randomized per recolor click.
  const rand = createSeededRng(seed);
  const hueOffset = rand() * 360;
  const saturationPalette = shuffled([56, 62, 68], rand);
  const lightnessPalette = shuffled([36, 44, 52, 60, 68], rand);
  const hue = (hueOffset + index * 137.508) % 360;
  const saturation = saturationPalette[index % saturationPalette.length];
  const lightness = lightnessPalette[index % lightnessPalette.length];
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`;
}

const classicPalette = [
  "#ff0000",
  "#008000",
  "#0000ff",
  "#ffa500",
  "#800080",
  "#8b4513",
  "#808000",
  "#800000",
  "#00ff00",
  "#ffff00",
  "#cc0000",
  "#006600",
  "#0000cc",
  "#cc8400",
  "#660066",
  "#6f370f",
  "#666600",
  "#660000",
  "#00cc00",
];

export function addMetric(name, hooks) {
  if (!name || metricByName(name)) return;
  state.metrics.push({
    name,
    expr: "",
    color: colors[state.metrics.length % colors.length],
    draw: true,
    drawAvg: true,
    stackMode: "stack",
    factor: 1,
    manualFactor: 1,
    factorMode: "auto",
    unit: "",
    displayUnit: "",
    alias: "",
    description: "",
  });
  renderMetricList(hooks);
  hooks.loadData();
  hooks.onStateChanged?.();
  fetchMetadata(name, hooks);
}

export function addExpressionMetric(name, expr, hooks) {
  const metricName = String(name || "").trim();
  const metricExpr = String(expr || "").trim();
  if (!metricName || !metricExpr || metricByName(metricName)) return false;
  state.metrics.push({
    name: metricName,
    expr: metricExpr,
    color: colors[state.metrics.length % colors.length],
    draw: true,
    drawAvg: true,
    stackMode: "stack",
    factor: 1,
    manualFactor: 1,
    factorMode: "auto",
    unit: "",
    displayUnit: "",
    alias: "",
    description: metricExpr,
  });
  renderMetricList(hooks);
  hooks.loadData();
  hooks.onStateChanged?.();
  return true;
}

export function updateExpressionMetric(originalName, name, expr, hooks) {
  const original = String(originalName || "").trim();
  const metricName = String(name || "").trim();
  const metricExpr = String(expr || "").trim();
  if (!original || !metricName || !metricExpr) return false;

  const metric = metricByName(original);
  if (!metric || !metric.expr) return false;
  if (metricName !== original && metricByName(metricName)) return false;

  state.series.delete(original);
  metric.name = metricName;
  metric.expr = metricExpr;
  metric.description = metricExpr;
  renderMetricList(hooks);
  hooks.loadData();
  hooks.onStateChanged?.();
  return true;
}

export function removeMetric(name, hooks) {
  state.metrics = state.metrics.filter((m) => m.name !== name);
  state.series.delete(name);
  applyAutoScaling(state.metrics, state.series);
  renderMetricList(hooks);
  hooks.renderChart();
  hooks.onStateChanged?.();
}

export function recolorMetrics(hooks) {
  const seed = randomSeed32();
  state.metrics.forEach((m, i) => {
    m.color = recolorForIndex(i, seed);
  });
  renderMetricList(hooks);
  hooks.renderChart();
  hooks.onStateChanged?.();
}

export function recolorMetricsClassic(hooks) {
  state.metrics.forEach((m, i) => {
    m.color = classicPalette[i % classicPalette.length];
  });
  renderMetricList(hooks);
  hooks.renderChart();
  hooks.onStateChanged?.();
}

export function setAllVisible(draw, hooks) {
  for (const m of state.metrics) m.draw = draw;
  renderMetricList(hooks);
  hooks.renderChart();
  hooks.onStateChanged?.();
}

export function clearMetrics(hooks) {
  state.metrics = [];
  state.series.clear();
  factorMetricName = "";
  applyAutoScaling(state.metrics, state.series);
  renderMetricList(hooks);
  hooks.renderChart();
}

export async function fetchMetadata(name, hooks) {
  try {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(name)}`);
    const metric = metricByName(name);
    if (!metric) return;
    const beforeFactors = new Map(state.metrics.map((m) => [m.name, Number(m.factor) || 1]));
    metric.unit = normalizeSIUnit(body?.metadata?.unit);
    metric.description = String(body.metadata.description || "");
    applyAutoScaling(state.metrics, state.series);
    const hasExpressionMetrics = state.metrics.some((m) => String(m.expr || "").trim() !== "");
    const factorsChanged = state.metrics.some((m) => {
      const before = beforeFactors.get(m.name);
      const after = Number(m.factor) || 1;
      return !Number.isFinite(before) || Math.abs(after - before) > 1e-12;
    });
    renderMetricList(hooks);
    hooks.renderChart();
    hooks.onStateChanged?.();
    if (hasExpressionMetrics && factorsChanged) {
      hooks.loadData();
    }
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
    bindMetricHintHover(chip, name);
    chip.addEventListener("click", () => addMetric(name, hooks));
    dom.metricHints.appendChild(chip);
  }
}

export function renderMetricList(hooks) {
  const clearDropMarkers = () => {
    for (const child of dom.metricList.children) {
      child.classList.remove("metric-drop-target");
      child.removeAttribute("data-drop-position");
      child.classList.remove("metric-dragging");
    }
  };
  const reorderMetrics = (sourceName, targetName, placeAfter) => {
    if (!sourceName || !targetName || sourceName === targetName) return false;
    const from = state.metrics.findIndex((m) => m.name === sourceName);
    const to = state.metrics.findIndex((m) => m.name === targetName);
    if (from < 0 || to < 0) return false;
    const [moved] = state.metrics.splice(from, 1);
    let insertAt = placeAfter ? (to + 1) : to;
    if (from < insertAt) insertAt -= 1;
    state.metrics.splice(insertAt, 0, moved);
    return true;
  };

  dom.metricList.innerHTML = "";
  for (const metric of state.metrics) {
    const li = document.createElement("li");
    li.className = "list-group-item py-1 px-1 metric-draggable-row";
    li.draggable = true;
    li.dataset.metricName = metric.name;

    const row = document.createElement("div");
    row.className = "metric-list-item" + (metric.draw ? "" : " metric-muted");
    row.dataset.metricName = metric.name;

    li.addEventListener("dragstart", (event) => {
      draggingMetricName = metric.name;
      li.classList.add("metric-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", metric.name);
    });
    li.addEventListener("dragover", (event) => {
      if (!draggingMetricName || draggingMetricName === metric.name) return;
      event.preventDefault();
      clearDropMarkers();
      const rect = li.getBoundingClientRect();
      const placeAfter = event.clientY >= rect.top + rect.height / 2;
      li.classList.add("metric-drop-target");
      li.dataset.dropPosition = placeAfter ? "after" : "before";
      event.dataTransfer.dropEffect = "move";
    });
    li.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceName = event.dataTransfer.getData("text/plain") || draggingMetricName;
      const placeAfter = li.dataset.dropPosition === "after";
      const changed = reorderMetrics(sourceName, metric.name, placeAfter);
      clearDropMarkers();
      if (!changed) return;
      renderMetricList(hooks);
      hooks.renderChart();
      hooks.onStateChanged?.();
    });
    li.addEventListener("dragend", () => {
      draggingMetricName = "";
      clearDropMarkers();
    });

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
    const applyColorChange = () => {
      metric.color = colorInput.value;
      swatch.style.background = metric.color;
      renderCollapsedLegend();
      hooks.renderChart();
      hooks.onStateChanged?.();
    };
    colorInput.addEventListener("input", applyColorChange);
    colorInput.addEventListener("change", applyColorChange);

    swatchButton.addEventListener("click", () => {
      colorInput.click();
    });
    swatchButton.appendChild(swatch);

    const center = document.createElement("div");
    center.className = "metric-name";
    const shownUnit = metric.displayUnit || metric.unit;
    const shownFactor = shownMetricFactor(metric);
    const factorSuffix = shownFactor ? ` x${shownFactor}` : "";
    const mainText = document.createElement("div");
    mainText.className = "metric-name-main";
    const formulaPrefix = metric.expr ? "ƒ " : "";
    mainText.textContent = formulaPrefix + metricDisplayName(metric) + (shownUnit ? ` [${shownUnit}]` : "") + factorSuffix;
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
    const editButton = metric.expr
      ? `<button class="btn btn-outline-secondary" data-action="edit" title="Ausdruck bearbeiten"><i class="bi bi-pencil"></i></button>`
      : "";
    const stackButton = state.yAxisStacked
      ? (() => {
        const stacksInYAxis = metric.stackMode !== "normal";
        const stackButtonClass = stacksInYAxis ? "btn-outline-secondary" : "btn-warning";
        const stackButtonIcon = stacksInYAxis ? "bi-layers-fill" : "bi-layers-half";
        const stackTitle = stacksInYAxis
          ? "Im Stack-Modus: gestapelt zeichnen"
          : "Im Stack-Modus: normal (nicht gestapelt) zeichnen";
        return `<button class="btn ${stackButtonClass}" data-action="stack-mode" title="${stackTitle}"><i class="bi ${stackButtonIcon}"></i></button>`;
      })()
      : "";
    controls.innerHTML = `
      <button class="btn ${toggleButtonClass}" data-action="toggle" title="Ein/Aus"><i class="bi ${toggleIcon}"></i></button>
      ${stackButton}
      ${editButton}
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
        hooks.onStateChanged?.();
      } else if (action === "stack-mode") {
        metric.stackMode = metric.stackMode === "normal" ? "stack" : "normal";
        renderMetricList(hooks);
        hooks.loadData();
        hooks.onStateChanged?.();
      } else if (action === "edit" && metric.expr) {
        document.dispatchEvent(new CustomEvent("metricq:edit-expression", { detail: { name: metric.name } }));
      } else if (action === "delete") {
        removeMetric(metric.name, hooks);
      } else if (action === "factor") {
        void openFactorModal(metric.name);
      }
    });

    row.append(swatchButton, colorInput, center, controls);
    li.appendChild(row);
    dom.metricList.appendChild(li);
  }

  dom.metricList.ondragover = (event) => {
    if (!draggingMetricName) return;
    const rowTarget = event.target.closest("li.metric-draggable-row");
    if (rowTarget) return;
    const items = Array.from(dom.metricList.querySelectorAll("li.metric-draggable-row"));
    if (items.length === 0) return;
    event.preventDefault();
    clearDropMarkers();

    const first = items[0];
    const last = items[items.length - 1];
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();

    if (event.clientY <= firstRect.top) {
      first.classList.add("metric-drop-target");
      first.dataset.dropPosition = "before";
    } else if (event.clientY >= lastRect.bottom) {
      last.classList.add("metric-drop-target");
      last.dataset.dropPosition = "after";
    } else {
      const listRect = dom.metricList.getBoundingClientRect();
      const chooseFirst = (event.clientY - listRect.top) < (listRect.bottom - event.clientY);
      const anchor = chooseFirst ? first : last;
      anchor.classList.add("metric-drop-target");
      anchor.dataset.dropPosition = chooseFirst ? "before" : "after";
    }
    event.dataTransfer.dropEffect = "move";
  };

  dom.metricList.ondrop = (event) => {
    if (!draggingMetricName) return;
    const rowTarget = event.target.closest("li.metric-draggable-row");
    if (rowTarget) return;
    const markerTarget = dom.metricList.querySelector("li.metric-drop-target");
    if (!markerTarget) return;
    event.preventDefault();
    const sourceName = event.dataTransfer.getData("text/plain") || draggingMetricName;
    const targetName = markerTarget.dataset.metricName;
    const placeAfter = markerTarget.dataset.dropPosition === "after";
    const changed = reorderMetrics(sourceName, targetName, placeAfter);
    clearDropMarkers();
    if (!changed) return;
    renderMetricList(hooks);
    hooks.renderChart();
    hooks.onStateChanged?.();
  };

  dom.metricList.ondragleave = (event) => {
    if (!draggingMetricName) return;
    const related = event.relatedTarget;
    if (related && dom.metricList.contains(related)) return;
    clearDropMarkers();
  };

  renderCollapsedLegend();
}

async function openFactorModal(metricName) {
  const metric = metricByName(metricName);
  if (!metric) return;
  factorMetricName = metricName;
  dom.factorMetricName.textContent = metricName;
  dom.factorInput.value = String(metric.factorMode === "manual" ? (metric.manualFactor ?? 1) : 1);
  if (dom.factorAliasInput) {
    dom.factorAliasInput.value = String(metric.alias || "");
    dom.factorAliasInput.disabled = Boolean(metric.expr);
  }

  const unit = String(metric.unit || "").trim();
  const displayUnit = String(metric.displayUnit || "").trim();
  const manual = metric.factorMode === "manual" ? sanitizeFactor(metric.manualFactor, 1) : 1;
  const effective = sanitizeFactor(metric.factor, 1);
  const normalization = sanitizeFactor(effective / manual, 1);
  const shownNorm = formatFactor(normalization) || "1";

  const normInfo = dom.factorNormalizationInfo;
  const normFactor = dom.factorNormalizationFactor;
  const normUnits = dom.factorNormalizationUnits;
  if (normInfo && normFactor && normUnits) {
    if (unit && displayUnit && unit !== displayUnit) {
      normFactor.textContent = `x${shownNorm}`;
      normUnits.textContent = `[${unit}] -> [${displayUnit}]`;
      normInfo.classList.remove("d-none");
    } else {
      normInfo.classList.add("d-none");
    }
  }

  const exprNormInfo = dom.factorExpressionNormalizationInfo;
  const exprNormList = dom.factorExpressionNormalizationList;
  if (exprNormInfo && exprNormList) {
    exprNormList.innerHTML = "";
    const expr = String(metric.expr || "").trim();
    if (!expr) {
      exprNormInfo.classList.add("d-none");
    } else {
      const refs = collectExpressionReferences(expr);
      for (const refName of refs) {
        const row = document.createElement("div");
        row.className = "mb-1";
        const refInfo = await resolveReferenceNormalizationInfo(refName);
        if (!refInfo) {
          row.textContent = `[${refName}]: keine Skalierung verfügbar`;
          exprNormList.appendChild(row);
          continue;
        }
        const shownNorm = formatFactor(refInfo.normalization) || "1";
        const unitPart = refInfo.unit && refInfo.displayUnit && refInfo.unit !== refInfo.displayUnit
          ? ` [${refInfo.unit}] -> [${refInfo.displayUnit}]`
          : refInfo.unit
            ? ` [${refInfo.unit}]`
            : "";
        row.textContent = `[${refName}]: Norm x${shownNorm}${unitPart}`;
        exprNormList.appendChild(row);
      }
      exprNormInfo.classList.toggle("d-none", refs.length === 0);
    }
  }

  if (globalThis.bootstrap?.Modal) {
    globalThis.bootstrap.Modal.getOrCreateInstance(dom.factorModal).show();
  }
}

export function applyFactorFromModal(hooks) {
  if (!factorMetricName) return;
  const metric = metricByName(factorMetricName);
  if (!metric) return;
  const rawFactor = String(dom.factorInput.value ?? "").trim();
  metric.manualFactor = rawFactor === ""
    ? 1
    : sanitizeFactor(rawFactor, metric.manualFactor || 1);
  metric.factorMode = "manual";
  if (!metric.expr && dom.factorAliasInput) {
    metric.alias = String(dom.factorAliasInput.value || "").trim();
  }
  applyAutoScaling(state.metrics, state.series);
  renderMetricList(hooks);
  hooks.renderChart();
  hooks.onStateChanged?.();
  if (globalThis.bootstrap?.Modal) {
    globalThis.bootstrap.Modal.getOrCreateInstance(dom.factorModal).hide();
  }
}
