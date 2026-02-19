import { dom } from "./dom.js";
import { state } from "./model.js";
import { addExpressionMetric } from "./metrics.js";
import { expressionTokenForMetric } from "./targets.mjs";

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
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "btn btn-sm btn-outline-secondary expression-chip";
    chip.textContent = metric.name;
    chip.draggable = true;

    const token = expressionTokenForMetric(metric.name);
    chip.addEventListener("click", () => {
      insertAtCursor(dom.expressionInput, token);
    });
    chip.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", token);
      event.dataTransfer?.setData("application/x-metricq-token", token);
      event.dataTransfer.effectAllowed = "copy";
    });
    dom.expressionMetricPalette.appendChild(chip);
  }
}

function saveExpressionMetric(hooks) {
  clearValidation();
  const name = dom.expressionMetricName.value.trim();
  const expr = dom.expressionInput.value.trim();
  if (!name) {
    markInvalid(dom.expressionMetricName);
    return;
  }
  if (!expr) {
    markInvalid(dom.expressionInput);
    return;
  }
  const created = addExpressionMetric(name, expr, hooks);
  if (!created) {
    markInvalid(dom.expressionMetricName);
    return;
  }
  const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.expressionMetricModal);
  modal?.hide();
}

export function wireExpressionModal(hooks) {
  dom.btnAddExpressionMetric.addEventListener("click", () => {
    clearValidation();
    dom.expressionMetricName.value = buildNextExpressionName();
    dom.expressionInput.value = "";
    renderMetricPalette();
    const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.expressionMetricModal);
    modal?.show();
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

  dom.btnSaveExpressionMetric.addEventListener("click", () => saveExpressionMetric(hooks));
}
