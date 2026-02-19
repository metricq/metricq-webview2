import { dom } from "./dom.js";
import { state } from "./model.js";
import { addExpressionMetric, searchMetricHints, updateExpressionMetric } from "./metrics.js";
import { expressionTokenForMetric } from "./targets.mjs";
import { expandExpressionAliases } from "./expression-alias.mjs";

let editingMetricName = "";
let expressionSearchTimer = null;

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = `${before}${text}${after}`;
  const nextPos = start + text.length;
  input.focus();
  input.setSelectionRange(nextPos, nextPos);
}

function metricTokenRangeForDelete(text, cursorPos, key) {
  const pos = Number(cursorPos);
  if (!Number.isFinite(pos)) return null;
  if (key !== "Backspace" && key !== "Delete") return null;

  const target = key === "Backspace" ? pos - 1 : pos;
  if (target < 0 || target >= text.length) return null;
  const ch = text[target];
  if (ch !== "[" && ch !== "]") return null;

  if (ch === "[") {
    const end = text.indexOf("]", target + 1);
    if (end < 0) return null;
    return { start: target, end: end + 1 };
  }

  const start = text.lastIndexOf("[", target - 1);
  if (start < 0) return null;
  return { start, end: target + 1 };
}

function applyTokenDelete(input, range) {
  const before = input.value.slice(0, range.start);
  const after = input.value.slice(range.end);
  input.value = `${before}${after}`;
  input.setSelectionRange(range.start, range.start);
}

function clearValidation() {
  dom.expressionMetricName.classList.remove("is-invalid");
  dom.expressionInput.classList.remove("is-invalid");
}

function markInvalid(target) {
  target.classList.add("is-invalid");
  target.focus();
}

function buildNextExpressionName() {
  const prefix = "expr.";
  let idx = 1;
  while (state.metrics.some((m) => m.name === `${prefix}${idx}`)) idx += 1;
  return `${prefix}${idx}`;
}

function renderMetricPalette() {
  dom.expressionMetricPalette.innerHTML = "";
  const baseMetrics = state.metrics.filter((metric) => !metric.expr);
  for (const metric of baseMetrics) {
    dom.expressionMetricPalette.appendChild(createMetricChip(metric.name));
  }
}

function createMetricChip(name) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "btn btn-sm btn-outline-secondary expression-chip";
  chip.textContent = name;
  chip.draggable = true;

  const token = expressionTokenForMetric(name);
  chip.addEventListener("click", () => {
    insertAtCursor(dom.expressionInput, token);
  });
  chip.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData("text/plain", token);
    event.dataTransfer?.setData("application/x-metricq-token", token);
    event.dataTransfer.effectAllowed = "copy";
  });
  return chip;
}

function renderMetricSearchHints(names) {
  dom.expressionMetricHints.innerHTML = "";
  for (const name of names) {
    dom.expressionMetricHints.appendChild(createMetricChip(name));
  }
}

async function updateMetricSearchHints() {
  const query = dom.expressionMetricSearch.value.trim();
  if (query.length < 2) {
    renderMetricSearchHints([]);
    return;
  }
  const names = await searchMetricHints(query);
  renderMetricSearchHints(names);
}

function saveExpressionMetric(hooks) {
  clearValidation();
  const name = dom.expressionMetricName.value.trim();
  const expr = expandExpressionAliases(dom.expressionInput.value.trim(), state.metrics);
  if (!name) {
    markInvalid(dom.expressionMetricName);
    return;
  }
  if (!expr) {
    markInvalid(dom.expressionInput);
    return;
  }
  const ok = editingMetricName
    ? updateExpressionMetric(editingMetricName, name, expr, hooks)
    : addExpressionMetric(name, expr, hooks);
  if (!ok) {
    markInvalid(dom.expressionMetricName);
    return;
  }
  editingMetricName = "";
  const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.expressionMetricModal);
  modal?.hide();
}

export function wireExpressionModal(hooks) {
  function openAddModal() {
    editingMetricName = "";
    clearValidation();
    dom.expressionMetricModalTitle.textContent = "Berechnete Metrik hinzufügen";
    dom.expressionMetricName.value = buildNextExpressionName();
    dom.expressionInput.value = "";
    dom.expressionMetricSearch.value = "";
    renderMetricSearchHints([]);
    renderMetricPalette();
    const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.expressionMetricModal);
    modal?.show();
  }

  function openEditModal(metricName) {
    const metric = state.metrics.find((item) => item.name === metricName && item.expr);
    if (!metric) return;
    editingMetricName = metric.name;
    clearValidation();
    dom.expressionMetricModalTitle.textContent = "Berechnete Metrik bearbeiten";
    dom.expressionMetricName.value = metric.name;
    dom.expressionInput.value = metric.expr || "";
    dom.expressionMetricSearch.value = "";
    renderMetricSearchHints([]);
    renderMetricPalette();
    const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.expressionMetricModal);
    modal?.show();
  }

  dom.btnAddExpressionMetric.addEventListener("click", () => {
    openAddModal();
  });

  dom.expressionMetricModal.addEventListener("shown.bs.modal", () => {
    renderMetricPalette();
    dom.expressionInput.focus();
  });

  dom.expressionInput.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dom.expressionInput.classList.add("expression-drop-target");
  });

  dom.expressionInput.addEventListener("dragleave", () => {
    dom.expressionInput.classList.remove("expression-drop-target");
  });

  dom.expressionInput.addEventListener("drop", (event) => {
    event.preventDefault();
    dom.expressionInput.classList.remove("expression-drop-target");
    const token = event.dataTransfer.getData("application/x-metricq-token")
      || event.dataTransfer.getData("text/plain");
    if (!token) return;
    insertAtCursor(dom.expressionInput, token);
  });

  dom.expressionInput.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (dom.expressionInput.selectionStart !== dom.expressionInput.selectionEnd) return;
    const range = metricTokenRangeForDelete(
      dom.expressionInput.value,
      dom.expressionInput.selectionStart,
      event.key,
    );
    if (!range) return;
    event.preventDefault();
    applyTokenDelete(dom.expressionInput, range);
  });

  dom.btnSaveExpressionMetric.addEventListener("click", () => saveExpressionMetric(hooks));

  dom.expressionMetricModal.addEventListener("hidden.bs.modal", () => {
    editingMetricName = "";
    dom.expressionMetricSearch.value = "";
    renderMetricSearchHints([]);
  });

  dom.expressionMetricSearch.addEventListener("input", () => {
    if (expressionSearchTimer != null) window.clearTimeout(expressionSearchTimer);
    expressionSearchTimer = window.setTimeout(updateMetricSearchHints, 180);
  });

  document.addEventListener("metricq:edit-expression", (event) => {
    const name = String(event?.detail?.name || "").trim();
    if (!name) return;
    openEditModal(name);
  });
}
