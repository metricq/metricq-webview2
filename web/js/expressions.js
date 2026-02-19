import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { state } from "./model.js";
import { addExpressionMetric, searchMetricHints, updateExpressionMetric } from "./metrics.js";
import { expressionTokenForMetric } from "./targets.mjs";
import { expandExpressionAliases } from "./expression-alias.mjs";
import { normalizeSIUnit } from "./units.mjs";

let editingMetricName = "";
let expressionSearchTimer = null;
let tokenSequence = 1;
let hoverInfoEl = null;
let hoveredMetricName = "";
let dropMarkerEl = null;

const metricMetadataCache = new Map();

function ensureHoverInfoElement() {
  if (hoverInfoEl) return hoverInfoEl;
  hoverInfoEl = document.createElement("div");
  hoverInfoEl.className = "expression-token-hover d-none";
  document.body.appendChild(hoverInfoEl);
  return hoverInfoEl;
}

function ensureDropMarker() {
  if (dropMarkerEl) return dropMarkerEl;
  dropMarkerEl = document.createElement("span");
  dropMarkerEl.className = "expression-drop-marker";
  dropMarkerEl.contentEditable = "false";
  return dropMarkerEl;
}

function clearDropMarker() {
  if (!dropMarkerEl) return;
  dropMarkerEl.remove();
}

function editorStartRange() {
  const range = document.createRange();
  range.selectNodeContents(dom.expressionInput);
  range.collapse(true);
  return range;
}

function editorEndRange() {
  const range = document.createRange();
  range.selectNodeContents(dom.expressionInput);
  range.collapse(false);
  return range;
}

function closestTokenElement(node) {
  let current = node;
  while (current && current !== dom.expressionInput) {
    if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains("expression-token")) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function normalizedDropRange(x, y) {
  const editorRect = dom.expressionInput.getBoundingClientRect();
  if (x >= editorRect.right - 2 || y >= editorRect.bottom - 2) return editorEndRange();
  if (x <= editorRect.left + 2 && y <= editorRect.top + 20) return editorStartRange();

  const raw = rangeFromPoint(x, y);
  if (!raw || !dom.expressionInput.contains(raw.startContainer)) {
    if (x > editorRect.right) return editorEndRange();
    if (x < editorRect.left) return editorStartRange();
    return null;
  }
  const token = closestTokenElement(raw.startContainer);
  if (!token) return raw;
  const rect = token.getBoundingClientRect();
  const before = x < rect.left + rect.width / 2;
  const range = document.createRange();
  if (before) range.setStartBefore(token);
  else range.setStartAfter(token);
  range.collapse(true);
  return range;
}

function createTokenDragImage(label) {
  const text = String(label || "").trim() || "Metrik";
  const cappedText = text.length > 36 ? `${text.slice(0, 33)}...` : text;
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  const isFirefox = /firefox/i.test(navigator.userAgent || "");
  const preview = document.createElement("span");
  preview.className = "expression-token expression-drag-preview";
  preview.textContent = cappedText;
  preview.style.position = "fixed";
  preview.style.left = "-10000px";
  preview.style.top = "-10000px";
  preview.style.margin = "0";
  preview.style.transform = "none";
  preview.style.zoom = "1";
  if (isFirefox && dpr > 1) {
    preview.style.fontSize = `${12 * dpr}px`;
    preview.style.padding = `${0.02 * dpr}rem ${0.28 * dpr}rem`;
    preview.style.borderWidth = `${dpr}px`;
    preview.style.transform = `scale(${1 / dpr})`;
    preview.style.transformOrigin = "top left";
  }
  return preview;
}

function setTokenDragImage(event, label) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;
  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
  const isFirefox = /firefox/i.test(navigator.userAgent || "");
  const hotspotScale = (isFirefox && dpr > 1) ? (1 / dpr) : 1;
  const image = createTokenDragImage(label);
  document.body.appendChild(image);
  dataTransfer.setDragImage(image, Math.round(10 * hotspotScale), Math.round(10 * hotspotScale));
  window.setTimeout(() => image.remove(), 0);
}

function setDropMarkerAtPoint(x, y) {
  const range = normalizedDropRange(x, y);
  if (!range || !dom.expressionInput.contains(range.startContainer)) {
    clearDropMarker();
    return;
  }
  const marker = ensureDropMarker();
  clearDropMarker();
  range.deleteContents();
  range.insertNode(marker);
}

function showHoverInfo(x, y, html) {
  const el = ensureHoverInfoElement();
  el.innerHTML = html;
  el.style.left = `${Math.round(x + 12)}px`;
  el.style.top = `${Math.round(y + 14)}px`;
  el.classList.remove("d-none");
}

function moveHoverInfo(x, y) {
  if (!hoverInfoEl || hoverInfoEl.classList.contains("d-none")) return;
  hoverInfoEl.style.left = `${Math.round(x + 12)}px`;
  hoverInfoEl.style.top = `${Math.round(y + 14)}px`;
}

function hideHoverInfo() {
  if (!hoverInfoEl) return;
  hoverInfoEl.classList.add("d-none");
}

function parseBracketMetric(text) {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(String(text || ""));
  if (!match) return "";
  return String(match[1] || "").trim();
}

function parseExpressionParts(expression) {
  const parts = [];
  const text = String(expression || "");
  let cursor = 0;
  const regex = /\[([^\]]+)\]/g;
  let match = regex.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, start) });
    }
    const metricName = String(match[1] || "").trim();
    if (metricName) {
      parts.push({ type: "metric", value: metricName });
    } else {
      parts.push({ type: "text", value: match[0] });
    }
    cursor = end;
    match = regex.exec(text);
  }
  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }
  return parts;
}

function serializeExpressionEditor() {
  let out = "";
  for (const node of dom.expressionInput.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || "";
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
      const metricName = String(node.dataset.metricName || "").trim();
      if (metricName) out += `[${metricName}]`;
      continue;
    }
    out += node.textContent || "";
  }
  return out;
}

function placeCaretAfterNode(node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretAtEnd(container) {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function rangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function getSelectionRangeInEditor() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!dom.expressionInput.contains(range.startContainer)) return null;
  return range;
}

function insertNodeAtRange(node, range) {
  if (!range || !dom.expressionInput.contains(range.startContainer)) {
    dom.expressionInput.appendChild(node);
    placeCaretAfterNode(node);
    return;
  }
  range.deleteContents();
  range.insertNode(node);
  placeCaretAfterNode(node);
}

function metricDetailsFromState(metricName) {
  const metric = state.metrics.find((item) => item.name === metricName);
  if (!metric) return null;
  const unit = String(metric.displayUnit || metric.unit || "").trim();
  const description = String(metric.description || "").trim();
  return { unit, description };
}

async function fetchMetricDetails(metricName) {
  const cached = metricMetadataCache.get(metricName);
  if (cached) return cached;
  try {
    const body = await apiFetch(`/api/metadata?metric=${encodeURIComponent(metricName)}`);
    const details = {
      unit: normalizeSIUnit(body?.metadata?.unit),
      description: String(body?.metadata?.description || "").trim(),
    };
    metricMetadataCache.set(metricName, details);
    return details;
  } catch (_) {
    const empty = { unit: "", description: "" };
    metricMetadataCache.set(metricName, empty);
    return empty;
  }
}

function renderMetricHoverHtml(metricName, details) {
  const unitPart = details?.unit ? ` [${details.unit}]` : "";
  const desc = details?.description || "-";
  return `
    <div class="expression-token-hover-name">${metricName}${unitPart}</div>
    <div class="expression-token-hover-desc">${desc}</div>
  `;
}

function bindMetadataHover(element, metricName) {
  const show = async (event) => {
    const x = event.clientX || 0;
    const y = event.clientY || 0;
    hoveredMetricName = metricName;
    showHoverInfo(x, y, renderMetricHoverHtml(metricName, null));
    const details = metricDetailsFromState(metricName) || await fetchMetricDetails(metricName);
    if (hoveredMetricName !== metricName) return;
    showHoverInfo(x, y, renderMetricHoverHtml(metricName, details));
  };
  element.addEventListener("mouseenter", show);
  element.addEventListener("mousemove", (event) => moveHoverInfo(event.clientX, event.clientY));
  element.addEventListener("mouseleave", () => {
    if (hoveredMetricName === metricName) hoveredMetricName = "";
    hideHoverInfo();
  });
}

function makeMetricTokenNode(metricName) {
  const token = document.createElement("span");
  token.className = "expression-token";
  token.dataset.metricName = metricName;
  token.dataset.tokenId = `tok-${tokenSequence++}`;
  token.draggable = true;
  token.contentEditable = "false";
  token.textContent = metricName;
  bindMetadataHover(token, metricName);
  token.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData("application/x-metricq-token", expressionTokenForMetric(metricName));
    event.dataTransfer?.setData("application/x-metricq-metric", metricName);
    event.dataTransfer?.setData("application/x-metricq-token-id", String(token.dataset.tokenId || ""));
    event.dataTransfer.effectAllowed = "move";
    setTokenDragImage(event, metricName);
  });
  return token;
}

function renderExpressionEditor(expression) {
  const parts = parseExpressionParts(expression);
  dom.expressionInput.innerHTML = "";
  for (const part of parts) {
    if (part.type === "metric") {
      dom.expressionInput.appendChild(makeMetricTokenNode(part.value));
    } else {
      dom.expressionInput.appendChild(document.createTextNode(part.value));
    }
  }
}

function insertMetricTokenAtCursor(metricName) {
  const range = getSelectionRangeInEditor();
  const token = makeMetricTokenNode(metricName);
  insertNodeAtRange(token, range);
}

function removeAdjacentToken(key) {
  const range = getSelectionRangeInEditor();
  if (!range || !range.collapsed) return false;
  const container = range.startContainer;
  const offset = range.startOffset;
  let target = null;

  if (container.nodeType === Node.TEXT_NODE) {
    if (key === "Backspace" && offset === 0) target = container.previousSibling;
    if (key === "Delete" && offset === (container.textContent || "").length) target = container.nextSibling;
  } else if (container.nodeType === Node.ELEMENT_NODE) {
    const children = container.childNodes;
    if (key === "Backspace" && offset > 0) target = children[offset - 1] || null;
    if (key === "Delete") target = children[offset] || null;
  }

  if (!target || target.nodeType !== Node.ELEMENT_NODE || !target.classList.contains("expression-token")) {
    return false;
  }
  target.remove();
  return true;
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

function createMetricChip(name) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "expression-token expression-chip";
  chip.textContent = name;
  chip.draggable = true;
  bindMetadataHover(chip, name);
  chip.addEventListener("click", () => {
    insertMetricTokenAtCursor(name);
  });
  chip.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData("application/x-metricq-token", expressionTokenForMetric(name));
    event.dataTransfer?.setData("application/x-metricq-metric", name);
    event.dataTransfer.effectAllowed = "copy";
    setTokenDragImage(event, name);
  });
  return chip;
}

function renderMetricPalette() {
  dom.expressionMetricPalette.innerHTML = "";
  const baseMetrics = state.metrics.filter((metric) => !metric.expr);
  for (const metric of baseMetrics) {
    dom.expressionMetricPalette.appendChild(createMetricChip(metric.name));
  }
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

function expressionFromEditor() {
  return serializeExpressionEditor().trim();
}

function saveExpressionMetric(hooks) {
  clearValidation();
  const name = dom.expressionMetricName.value.trim();
  const expr = expandExpressionAliases(expressionFromEditor(), state.metrics);
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

function handleExpressionEditorDrop(event) {
  event.preventDefault();
  dom.expressionInput.classList.remove("expression-drop-target");

  const droppedMetric = event.dataTransfer?.getData("application/x-metricq-metric")
    || parseBracketMetric(event.dataTransfer?.getData("application/x-metricq-token"))
    || parseBracketMetric(event.dataTransfer?.getData("text/plain"));
  if (!droppedMetric) return;

  const sourceTokenId = String(event.dataTransfer?.getData("application/x-metricq-token-id") || "");
  if (sourceTokenId) {
    const existing = dom.expressionInput.querySelector(`.expression-token[data-token-id="${CSS.escape(sourceTokenId)}"]`);
    existing?.remove();
  }

  const token = makeMetricTokenNode(droppedMetric);
  if (dropMarkerEl?.parentNode) {
    dropMarkerEl.parentNode.insertBefore(token, dropMarkerEl);
    clearDropMarker();
    placeCaretAfterNode(token);
    return;
  }
  const range = normalizedDropRange(event.clientX, event.clientY);
  insertNodeAtRange(token, range);
  clearDropMarker();
}

function maybeConvertTypedBracketExpression(event) {
  if (event.key !== "]") return;
  const expr = expressionFromEditor();
  renderExpressionEditor(expr);
  placeCaretAtEnd(dom.expressionInput);
}

export function wireExpressionModal(hooks) {
  function openAddModal() {
    editingMetricName = "";
    clearValidation();
    dom.expressionMetricModalTitle.textContent = "Berechnete Metrik hinzufügen";
    dom.expressionMetricName.value = buildNextExpressionName();
    renderExpressionEditor("");
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
    renderExpressionEditor(metric.expr || "");
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
    setDropMarkerAtPoint(event.clientX, event.clientY);
  });

  dom.expressionInput.addEventListener("dragleave", () => {
    dom.expressionInput.classList.remove("expression-drop-target");
    clearDropMarker();
  });

  dom.expressionInput.addEventListener("drop", handleExpressionEditorDrop);
  dom.expressionInput.addEventListener("dragend", clearDropMarker);

  dom.expressionInput.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (!removeAdjacentToken(event.key)) return;
    event.preventDefault();
  });

  dom.expressionInput.addEventListener("keyup", maybeConvertTypedBracketExpression);

  dom.btnSaveExpressionMetric.addEventListener("click", () => saveExpressionMetric(hooks));

  dom.expressionMetricModal.addEventListener("hidden.bs.modal", () => {
    editingMetricName = "";
    dom.expressionMetricSearch.value = "";
    renderMetricSearchHints([]);
    hideHoverInfo();
    clearDropMarker();
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
