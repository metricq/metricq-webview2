import { apiFetch } from "./api.js";
import { startHelpOverlayMinimize } from "./chart.js";
import { dom } from "./dom.js";
import { state } from "./model.js";
import { addExpressionMetric, searchMetricHints, updateExpressionMetric } from "./metrics.js";
import { expressionTokenForMetric } from "./targets.mjs";
import { expandExpressionAliases } from "./expression-alias.mjs";
import { normalizeSIUnit } from "./units.mjs";

let editingMetricName = "";
let blockCloseOnInvalidExpression = false;
let expressionSearchTimer = null;
let tokenSequence = 1;
let hoverInfoEl = null;
let hoveredMetricName = "";
let dropMarkerEl = null;
let draggingTokenId = "";
let draggingMetricName = "";
let expressionErrorTokenEl = null;
let expressionErrorFragmentEl = null;

const metricMetadataCache = new Map();
const CARET_SENTINEL = "\u200b";
const DECIMAL_DOT_BETWEEN_DIGITS = /(\d)\.(\d)/g;
const DECIMAL_COMMA_BETWEEN_DIGITS = /(\d),(\d)/g;
const metricExistenceCache = new Map();

function localizeExpressionText(text) {
  return String(text || "").replace(DECIMAL_DOT_BETWEEN_DIGITS, "$1,$2");
}

function canonicalizeExpressionText(text) {
  return String(text || "").replace(DECIMAL_COMMA_BETWEEN_DIGITS, "$1.$2");
}

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

function clearDragState() {
  draggingTokenId = "";
  draggingMetricName = "";
}

function hideExpressionErrorMarker() {
  if (expressionErrorTokenEl) {
    expressionErrorTokenEl.classList.remove("expression-token-error");
    expressionErrorTokenEl = null;
  }
  if (expressionErrorFragmentEl) {
    const frag = expressionErrorFragmentEl;
    const parent = frag.parentNode;
    if (!parent) {
      expressionErrorFragmentEl = null;
      return;
    }
    while (frag.firstChild) {
      parent.insertBefore(frag.firstChild, frag);
    }
    frag.remove();
    expressionErrorFragmentEl = null;
  }
}

function findExpressionTokenNodeByNameAndOffset(tokenName, position) {
  const wanted = String(tokenName || "").trim();
  if (!wanted) return null;
  const targetOffset = Math.max(0, Number(position) || 0);
  let offset = 0;
  let firstFutureMatch = null;
  for (const node of Array.from(dom.expressionInput.childNodes || [])) {
    const len = caretOffsetMapper.lengthOfNode(node);
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
      const name = String(node.dataset.metricName || "").trim();
      const start = offset;
      const end = offset + len;
      if (name === wanted && targetOffset >= start && targetOffset < end) return node;
      if (name === wanted && targetOffset < start && !firstFutureMatch) firstFutureMatch = node;
    }
    offset += len;
  }
  return firstFutureMatch;
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
  const text = canonicalizeExpressionText(expression);
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
    out += serializeExpressionNode(node);
  }
  return localizeExpressionText(out);
}

function serializeExpressionNode(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").split(CARET_SENTINEL).join("");
  }
  if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
    const metricName = String(node.dataset.metricName || "").trim();
    return metricName ? `[${metricName}]` : "";
  }
  let out = "";
  for (const child of node.childNodes || []) {
    out += serializeExpressionNode(child);
  }
  return out;
}

function serializeSelectionInEditor() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  if (!dom.expressionInput.contains(range.commonAncestorContainer)) return "";
  const offsets = selectionOffsetsInEditor(range);
  if (!offsets || offsets.end <= offsets.start) return "";
  const full = serializeFullExpressionEditor();
  return full.slice(offsets.start, offsets.end);
}

function copyExpressionSelectionToClipboard(event) {
  const selectionText = serializeSelectionInEditor();
  if (!selectionText) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", selectionText);
}

function cutExpressionSelectionToClipboard(event) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!dom.expressionInput.contains(range.commonAncestorContainer)) return;
  const selectionText = serializeSelectionInEditor();
  if (!selectionText) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", selectionText);

  const boundaries = normalizedSelectionBoundaries(range);
  if (!boundaries) return;
  const deleteRange = document.createRange();
  deleteRange.setStart(boundaries.start.container, boundaries.start.offset);
  deleteRange.setEnd(boundaries.end.container, boundaries.end.offset);
  deleteRange.deleteContents();
  ensureEditorBoundaries();
  try {
    const caret = document.createRange();
    caret.setStart(boundaries.start.container, boundaries.start.offset);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  } catch (_) {
    placeCaretAtEnd(dom.expressionInput);
  }
  refreshExpressionValidationState();
}

function serializeFullExpressionEditor() {
  let out = "";
  for (const node of dom.expressionInput.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent || "").split(CARET_SENTINEL).join("");
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
      const metricName = String(node.dataset.metricName || "").trim();
      if (metricName) out += `[${metricName}]`;
      continue;
    }
    out += node.textContent || "";
  }
  return localizeExpressionText(out);
}

const caretOffsetMapper = {
  lengthOfNode(node) {
    if (!node) return 0;
    if (node.nodeType === Node.TEXT_NODE) {
      return String(node.textContent || "").split(CARET_SENTINEL).join("").length;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
      const metricName = String(node.dataset.metricName || "").trim();
      return metricName ? (metricName.length + 2) : 0;
    }
    let total = 0;
    for (const child of node.childNodes || []) total += this.lengthOfNode(child);
    return total;
  },
  lengthOfFragment(fragment) {
    let total = 0;
    for (const child of fragment.childNodes || []) total += this.lengthOfNode(child);
    return total;
  },
  selectionExpressionOffset() {
    const range = getSelectionRangeInEditor();
    if (!range) return null;
    const before = document.createRange();
    before.selectNodeContents(dom.expressionInput);
    before.setEnd(range.startContainer, range.startOffset);
    return this.lengthOfFragment(before.cloneContents());
  },
  textNodeOffsetFromExpressionOffset(text, expressionOffset) {
    const raw = String(text || "");
    let seen = 0;
    for (let i = 0; i < raw.length; i += 1) {
      if (raw[i] !== CARET_SENTINEL) {
        if (seen >= expressionOffset) return i;
        seen += 1;
      }
    }
    return raw.length;
  },
  domPositionFromExpressionOffset(expressionOffset) {
    const targetOffset = Math.max(0, Number(expressionOffset) || 0);
    let remaining = targetOffset;
    const children = Array.from(dom.expressionInput.childNodes || []);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLen = this.lengthOfNode(node);
        if (remaining <= textLen) {
          const domOffset = this.textNodeOffsetFromExpressionOffset(node.textContent, remaining);
          return { node, offset: domOffset };
        }
        remaining -= textLen;
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
        const tokenLen = this.lengthOfNode(node);
        // Exact token boundaries must map deterministically:
        // 0 => before this token, tokenLen => after this token (handled by consume+continue).
        if (remaining === 0) return { beforeNode: node };
        if (remaining < tokenLen) return { tokenNode: node };
        if (remaining === tokenLen) {
          remaining = 0;
          continue;
        }
        remaining -= tokenLen;
        continue;
      }
      const otherLen = this.lengthOfNode(node);
      if (remaining <= otherLen) break;
      remaining -= otherLen;
    }
    return { atEnd: true };
  },
  setCaretByExpressionOffset(expressionOffset) {
    const targetOffset = Math.max(0, Number(expressionOffset) || 0);
    let remaining = targetOffset;
    const children = Array.from(dom.expressionInput.childNodes || []);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLen = this.lengthOfNode(node);
        if (remaining <= textLen) {
          const domOffset = this.textNodeOffsetFromExpressionOffset(node.textContent, remaining);
          const range = document.createRange();
          range.setStart(node, domOffset);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
        remaining -= textLen;
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("expression-token")) {
        const tokenLen = this.lengthOfNode(node);
        if (remaining === 0) {
          placeCaretBeforeNode(node);
          return;
        }
        if (remaining <= tokenLen) {
          const beforeDist = remaining;
          const afterDist = tokenLen - remaining;
          if (beforeDist <= afterDist) placeCaretBeforeNode(node);
          else placeCaretAfterNode(node);
          return;
        }
        remaining -= tokenLen;
        continue;
      }
      const otherLen = this.lengthOfNode(node);
      if (remaining <= otherLen) break;
      remaining -= otherLen;
    }
    placeCaretAtEnd(dom.expressionInput);
  },
};

function placeExpressionErrorMarker(position, end, errorInfo = null) {
  hideExpressionErrorMarker();
  const unexpectedTokenName = String(errorInfo?.type || "") === "unexpected_token"
    ? String(errorInfo?.token || "").trim()
    : "";
  const startOffset = Math.max(0, Number(position) || 0);
  const endOffset = Math.max(startOffset + 1, Number(end) || startOffset + 1);
  if (unexpectedTokenName) {
    const tokenNode = findExpressionTokenNodeByNameAndOffset(unexpectedTokenName, position);
    if (tokenNode) {
      tokenNode.classList.add("expression-token-error");
      expressionErrorTokenEl = tokenNode;
      return;
    }
  }

  const start = caretOffsetMapper.domPositionFromExpressionOffset(startOffset);
  const finish = caretOffsetMapper.domPositionFromExpressionOffset(endOffset);
  if (start?.node && finish?.node && start.node === finish.node && start.offset < finish.offset) {
    try {
      const highlightRange = document.createRange();
      highlightRange.setStart(start.node, start.offset);
      highlightRange.setEnd(finish.node, finish.offset);
      const fragment = document.createElement("span");
      fragment.className = "expression-error-fragment";
      highlightRange.surroundContents(fragment);
      expressionErrorFragmentEl = fragment;
      return;
    } catch (_) {}
  }
  if (start?.beforeNode?.classList?.contains("expression-token")) {
    start.beforeNode.classList.add("expression-token-error");
    expressionErrorTokenEl = start.beforeNode;
    return;
  }
  if (start?.tokenNode?.classList?.contains("expression-token")) {
    start.tokenNode.classList.add("expression-token-error");
    expressionErrorTokenEl = start.tokenNode;
    return;
  }
  if (start?.afterNode?.classList?.contains("expression-token")) {
    start.afterNode.classList.add("expression-token-error");
    expressionErrorTokenEl = start.afterNode;
  }
}

function placeCaretAfterNode(node) {
  const next = node.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE) {
    const text = String(next.textContent || "");
    const onlySentinels = text.length > 0 && text.split(CARET_SENTINEL).join("").length === 0;
    const atEditorEnd = !next.nextSibling;
    const offset = (onlySentinels && atEditorEnd) ? text.length : 0;
    const range = document.createRange();
    range.setStart(next, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  const textNode = document.createTextNode(CARET_SENTINEL);
  node.parentNode.insertBefore(textNode, next || null);
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretBeforeNode(node) {
  const prev = node.previousSibling;
  if (prev && prev.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.setStart(prev, prev.textContent?.length || 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  const textNode = document.createTextNode(CARET_SENTINEL);
  node.parentNode.insertBefore(textNode, node);
  const range = document.createRange();
  range.setStart(textNode, textNode.textContent?.length || 0);
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

function normalizeBoundaryToToken(container, offset, snapToStart) {
  const token = closestTokenElement(container);
  if (!token) return { container, offset };
  const parent = token.parentNode;
  if (!parent) return { container, offset };
  const index = Array.prototype.indexOf.call(parent.childNodes, token);
  if (index < 0) return { container, offset };
  return snapToStart
    ? { container: parent, offset: index }
    : { container: parent, offset: index + 1 };
}

function normalizedSelectionBoundaries(range) {
  if (!range) return null;
  const start = normalizeBoundaryToToken(range.startContainer, range.startOffset, true);
  const end = normalizeBoundaryToToken(range.endContainer, range.endOffset, false);
  if (!dom.expressionInput.contains(start.container) && start.container !== dom.expressionInput) return null;
  if (!dom.expressionInput.contains(end.container) && end.container !== dom.expressionInput) return null;
  return { start, end };
}

function expressionOffsetFromBoundary(boundary) {
  const before = document.createRange();
  before.selectNodeContents(dom.expressionInput);
  before.setEnd(boundary.container, boundary.offset);
  return caretOffsetMapper.lengthOfFragment(before.cloneContents());
}

function selectionOffsetsInEditor(range) {
  const boundaries = normalizedSelectionBoundaries(range);
  if (!boundaries) return null;
  const start = expressionOffsetFromBoundary(boundaries.start);
  const end = expressionOffsetFromBoundary(boundaries.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    start: Math.max(0, Math.min(start, end)),
    end: Math.max(0, Math.max(start, end)),
  };
}

function insertNodeAtRange(node, range) {
  if (!range || !dom.expressionInput.contains(range.startContainer)) {
    dom.expressionInput.appendChild(node);
    ensureEditorBoundaries();
    placeCaretAfterNode(node);
    return;
  }
  range.deleteContents();
  range.insertNode(node);
  ensureEditorBoundaries();
  placeCaretAfterNode(node);
}

function ensureEditorBoundaries() {
  const first = dom.expressionInput.firstChild;
  if (!first || first.nodeType !== Node.TEXT_NODE) {
    dom.expressionInput.insertBefore(document.createTextNode(CARET_SENTINEL), first || null);
  } else if (!String(first.textContent || "").includes(CARET_SENTINEL)) {
    first.textContent = `${CARET_SENTINEL}${first.textContent || ""}`;
  }

  const last = dom.expressionInput.lastChild;
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    dom.expressionInput.appendChild(document.createTextNode(CARET_SENTINEL));
  } else if (!String(last.textContent || "").includes(CARET_SENTINEL)) {
    last.textContent = `${last.textContent || ""}${CARET_SENTINEL}`;
  }
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
    draggingTokenId = String(token.dataset.tokenId || "");
    draggingMetricName = metricName;
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
      dom.expressionInput.appendChild(document.createTextNode(localizeExpressionText(part.value)));
    }
  }
  ensureEditorBoundaries();
}

function parseExpressionPartsRaw(expression) {
  const parts = [];
  const text = String(expression || "");
  let cursor = 0;
  const regex = /\[([^\]]+)\]/g;
  let match = regex.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > cursor) parts.push({ type: "text", value: text.slice(cursor, start) });
    const metricName = String(match[1] || "").trim();
    if (metricName) parts.push({ type: "metric", value: metricName });
    else parts.push({ type: "text", value: match[0] });
    cursor = end;
    match = regex.exec(text);
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}

function insertExpressionPartsAtCursor(parts) {
  const range = getSelectionRangeInEditor() || editorEndRange();
  const fragment = document.createDocumentFragment();
  const caretAnchor = document.createTextNode(CARET_SENTINEL);
  for (const part of parts || []) {
    if (part.type === "metric") fragment.appendChild(makeMetricTokenNode(part.value));
    else fragment.appendChild(document.createTextNode(String(part.value || "")));
  }
  fragment.appendChild(caretAnchor);
  range.deleteContents();
  range.insertNode(fragment);
  ensureEditorBoundaries();
  const caret = document.createRange();
  caret.setStart(caretAnchor, caretAnchor.textContent?.length || 0);
  caret.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(caret);
}

async function metricExistsForToken(metricName) {
  const name = String(metricName || "").trim();
  if (!name) return false;
  if (state.metrics.some((m) => m.name === name)) return true;
  if (metricExistenceCache.has(name)) return metricExistenceCache.get(name);
  try {
    await apiFetch(`/api/metadata?metric=${encodeURIComponent(name)}`);
    metricExistenceCache.set(name, true);
    return true;
  } catch (_) {
    metricExistenceCache.set(name, false);
    return false;
  }
}

async function pasteExpressionSelectionFromClipboard(event) {
  const raw = String(event.clipboardData?.getData("text/plain") || "");
  if (!raw) return;
  event.preventDefault();
  const normalized = localizeExpressionText(raw.replace(/\r\n/g, "\n"));
  const parsed = parseExpressionPartsRaw(normalized);
  const resolved = [];
  for (const part of parsed) {
    if (part.type !== "metric") {
      resolved.push(part);
      continue;
    }
    const exists = await metricExistsForToken(part.value);
    if (exists) resolved.push(part);
    else resolved.push({ type: "text", value: `[${part.value}]` });
  }
  insertExpressionPartsAtCursor(resolved);
  refreshExpressionValidationState();
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

function handleArrowAroundTokens(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  const range = getSelectionRangeInEditor();
  if (!range || !range.collapsed) return false;

  const container = range.startContainer;
  const offset = range.startOffset;
  let token = null;

  if (container.nodeType === Node.TEXT_NODE) {
    if (event.key === "ArrowLeft" && offset === 0) token = container.previousSibling;
    if (event.key === "ArrowRight" && offset === (container.textContent || "").length) token = container.nextSibling;
  } else if (container.nodeType === Node.ELEMENT_NODE && container === dom.expressionInput) {
    const children = container.childNodes;
    if (event.key === "ArrowLeft" && offset > 0) token = children[offset - 1] || null;
    if (event.key === "ArrowRight") token = children[offset] || null;
  }

  if (!token || token.nodeType !== Node.ELEMENT_NODE || !token.classList.contains("expression-token")) {
    return false;
  }
  event.preventDefault();
  if (event.key === "ArrowLeft") placeCaretBeforeNode(token);
  else placeCaretAfterNode(token);
  return true;
}

function clearValidation() {
  dom.expressionMetricName.classList.remove("is-invalid");
  dom.expressionInput.classList.remove("is-invalid");
  if (dom.expressionValidationError) {
    dom.expressionValidationError.textContent = "";
    dom.expressionValidationError.classList.add("d-none");
  }
  hideExpressionErrorMarker();
}

function showExpressionValidationError(message) {
  if (!dom.expressionValidationError) return;
  dom.expressionValidationError.textContent = String(message || "").trim();
  dom.expressionValidationError.classList.remove("d-none");
}

function localizedExpressionErrorMessage(errorInfo, fallbackMessage) {
  const info = errorInfo || {};
  const code = String(info.type || "").trim();
  const token = String(info.token || "").trim();
  const quotedToken = token ? `"${token}"` : "";
  switch (code) {
    case "missing_closing_bracket":
      return "Fehlende schließende eckige Klammer ] im Ausdruck.";
    case "empty_metric_reference":
      return "Leere Metrik-Referenz [] ist nicht erlaubt.";
    case "empty_expression":
      return "Der Ausdruck ist leer.";
    case "invalid_number":
      return "Ungültige Zahl im Ausdruck.";
    case "unexpected_character":
      return quotedToken
        ? `Ungültiges Zeichen ${quotedToken} im Ausdruck.`
        : "Ungültiges Zeichen im Ausdruck.";
    case "unexpected_token":
      return quotedToken
        ? `Unerwartetes Token ${quotedToken}.`
        : "Unerwartetes Token im Ausdruck.";
    case "missing_closing_parenthesis":
      return "Fehlende schließende Klammer ) im Ausdruck.";
    case "unsupported_function":
      return "Nicht unterstützte Funktion im Ausdruck.";
    case "missing_function_opening_parenthesis":
      return "Fehlende öffnende Klammer bei Funktionsaufruf.";
    case "function_requires_argument":
      return "Funktion benötigt mindestens ein Argument.";
    default:
      return String(fallbackMessage || info.message || "Ungültiger Ausdruck.");
  }
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
  return serializeFullExpressionEditor().trim();
}

function canonicalExpressionFromEditor() {
  return canonicalizeExpressionText(expressionFromEditor());
}

function expressionDraftIsValid() {
  const expr = expandExpressionAliases(canonicalExpressionFromEditor(), state.metrics);
  return Boolean(expr);
}

async function validateExpressionViaBackend(expr) {
  const text = String(expr || "").trim();
  if (!text) return { ok: false, message: "Der Ausdruck ist leer.", info: { type: "empty_expression" } };
  try {
    const body = await apiFetch("/api/expression/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expr: text,
      }),
    });
    const valid = Boolean(body?.valid);
    const errorText = String(body?.error || "").trim();
    const errorInfo = body?.errorInfo || null;
    if (!valid || errorText || errorInfo) {
      return { ok: false, message: errorText || String(errorInfo?.message || ""), info: errorInfo };
    }
    return { ok: true, message: "", info: null };
  } catch (err) {
    return {
      ok: false,
      message: String(err?.message || "Ausdruck konnte nicht validiert werden."),
      info: null,
    };
  }
}

function refreshExpressionValidationState() {
  if (!dom.expressionInput.classList.contains("is-invalid")) return;
  if (expressionDraftIsValid()) {
    dom.expressionInput.classList.remove("is-invalid");
    blockCloseOnInvalidExpression = false;
    if (dom.expressionValidationError) {
      dom.expressionValidationError.textContent = "";
      dom.expressionValidationError.classList.add("d-none");
    }
  }
}

async function saveExpressionMetric(hooks) {
  clearValidation();
  const name = dom.expressionMetricName.value.trim();
  const expr = expandExpressionAliases(canonicalExpressionFromEditor(), state.metrics);
  const isEdit = Boolean(editingMetricName);
  const helpVisible = Boolean(dom.chartEmptyState && !dom.chartEmptyState.classList.contains("d-none"));
  if (!name) {
    showExpressionValidationError("Bitte einen Namen für die berechnete Metrik angeben.");
    markInvalid(dom.expressionMetricName);
    return;
  }
  if (!expr) {
    showExpressionValidationError("Der Ausdruck ist leer.");
    markInvalid(dom.expressionInput);
    blockCloseOnInvalidExpression = true;
    return;
  }
  const remoteValidation = await validateExpressionViaBackend(expr);
  if (!remoteValidation.ok) {
    const message = localizedExpressionErrorMessage(remoteValidation.info, remoteValidation.message);
    showExpressionValidationError(message);
    const position = Number(remoteValidation.info?.position);
    const end = Number(remoteValidation.info?.end);
    if (Number.isFinite(position)) {
      placeExpressionErrorMarker(position, Number.isFinite(end) ? end : position + 1, remoteValidation.info);
    } else {
      hideExpressionErrorMarker();
    }
    markInvalid(dom.expressionInput);
    blockCloseOnInvalidExpression = true;
    return;
  }
  const ok = editingMetricName
    ? updateExpressionMetric(editingMetricName, name, expr, hooks)
    : addExpressionMetric(name, expr, hooks);
  if (!ok) {
    showExpressionValidationError("Metrik konnte nicht gespeichert werden. Name bereits vergeben oder ungültig.");
    markInvalid(dom.expressionMetricName);
    return;
  }
  editingMetricName = "";
  blockCloseOnInvalidExpression = false;
  state.helpOverlayMinimizeDeferred = !isEdit && helpVisible;
  const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.expressionMetricModal);
  if (modal) {
    modal.hide();
  } else if (state.helpOverlayMinimizeDeferred) {
    state.helpOverlayMinimizeDeferred = false;
    startHelpOverlayMinimize(1900);
  }
}

function handleExpressionEditorDrop(event) {
  event.preventDefault();
  dom.expressionInput.classList.remove("expression-drop-target");

  const droppedMetric = event.dataTransfer?.getData("application/x-metricq-metric")
    || draggingMetricName
    || parseBracketMetric(event.dataTransfer?.getData("application/x-metricq-token"))
    || parseBracketMetric(event.dataTransfer?.getData("text/plain"));
  if (!droppedMetric) {
    clearDragState();
    return;
  }

  const sourceTokenId = String(event.dataTransfer?.getData("application/x-metricq-token-id") || draggingTokenId);
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
  clearDragState();
}

function maybeConvertTypedBracketExpression(event) {
  if (event.key !== "]") return;
  const caretOffset = caretOffsetMapper.selectionExpressionOffset();
  const expr = expressionFromEditor();
  renderExpressionEditor(expr);
  if (caretOffset == null) {
    placeCaretAtEnd(dom.expressionInput);
    return;
  }
  caretOffsetMapper.setCaretByExpressionOffset(caretOffset);
}

function maybePlaceCaretOutsideEdgeToken(event) {
  if (event.button !== 0) return;
  if (event.target !== dom.expressionInput) return;
  const tokens = dom.expressionInput.querySelectorAll(".expression-token");
  if (tokens.length === 0) return;
  const clickRange = rangeFromPoint(event.clientX, event.clientY);
  const clickHitsTextNode = Boolean(
    clickRange
      && dom.expressionInput.contains(clickRange.startContainer)
      && clickRange.startContainer.nodeType === Node.TEXT_NODE,
  );
  const first = tokens[0].getBoundingClientRect();
  const last = tokens[tokens.length - 1].getBoundingClientRect();
  const trailingContentAfterLastToken = (() => {
    let node = tokens[tokens.length - 1]?.nextSibling || null;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = String(node.textContent || "").split(CARET_SENTINEL).join("");
        if (text.trim().length > 0) return true;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (!node.classList.contains("expression-drop-marker")) return true;
      }
      node = node.nextSibling;
    }
    return false;
  })();
  if (event.clientX <= first.left - 2) {
    event.preventDefault();
    placeCaretBeforeNode(tokens[0]);
    return;
  }
  if (clickHitsTextNode) return;
  if (event.clientX >= last.right + 2) {
    event.preventDefault();
    if (trailingContentAfterLastToken) placeCaretAtEnd(dom.expressionInput);
    else placeCaretAfterNode(tokens[tokens.length - 1]);
  }
}

function placeCaretOnTokenClick(event) {
  const clickedToken = event.target?.closest?.(".expression-token");
  if (!clickedToken || !dom.expressionInput.contains(clickedToken)) return;
  const rect = clickedToken.getBoundingClientRect();
  event.preventDefault();
  if (event.clientX < rect.left + rect.width / 2) placeCaretBeforeNode(clickedToken);
  else placeCaretAfterNode(clickedToken);
}

export function wireExpressionModal(hooks) {
  function openAddModal() {
    editingMetricName = "";
    blockCloseOnInvalidExpression = false;
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
    blockCloseOnInvalidExpression = false;
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
    const sourceTokenId = String(event.dataTransfer?.getData("application/x-metricq-token-id") || draggingTokenId);
    event.dataTransfer.dropEffect = sourceTokenId ? "move" : "copy";
    dom.expressionInput.classList.add("expression-drop-target");
    setDropMarkerAtPoint(event.clientX, event.clientY);
  });

  dom.expressionInput.addEventListener("dragleave", () => {
    dom.expressionInput.classList.remove("expression-drop-target");
    clearDropMarker();
  });

  dom.expressionInput.addEventListener("drop", handleExpressionEditorDrop);
  dom.expressionInput.addEventListener("dragend", () => {
    clearDropMarker();
    clearDragState();
  });

  dom.expressionInput.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (handleArrowAroundTokens(event)) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (!removeAdjacentToken(event.key)) return;
    event.preventDefault();
  });

  dom.expressionInput.addEventListener("keyup", maybeConvertTypedBracketExpression);
  dom.expressionInput.addEventListener("input", refreshExpressionValidationState);
  dom.expressionInput.addEventListener("copy", copyExpressionSelectionToClipboard);
  dom.expressionInput.addEventListener("cut", cutExpressionSelectionToClipboard);
  dom.expressionInput.addEventListener("paste", (event) => {
    void pasteExpressionSelectionFromClipboard(event);
  });
  dom.expressionInput.addEventListener("mousedown", maybePlaceCaretOutsideEdgeToken);
  dom.expressionInput.addEventListener("click", placeCaretOnTokenClick);

  dom.btnSaveExpressionMetric.addEventListener("click", () => {
    void saveExpressionMetric(hooks);
  });

  dom.expressionMetricModal.addEventListener("hide.bs.modal", (event) => {
    if (!blockCloseOnInvalidExpression) return;
    if (expressionDraftIsValid()) {
      blockCloseOnInvalidExpression = false;
      return;
    }
    showExpressionValidationError("Der Ausdruck ist ungültig und muss korrigiert werden, bevor der Dialog geschlossen werden kann.");
    markInvalid(dom.expressionInput);
    event.preventDefault();
  });

  dom.expressionMetricModal.addEventListener("hidden.bs.modal", () => {
    const shouldReleaseHelpMinimize = state.helpOverlayMinimizeDeferred;
    state.helpOverlayMinimizeDeferred = false;
    editingMetricName = "";
    blockCloseOnInvalidExpression = false;
    dom.expressionMetricSearch.value = "";
    renderMetricSearchHints([]);
    hideHoverInfo();
    hideExpressionErrorMarker();
    clearDropMarker();
    if (shouldReleaseHelpMinimize) {
      startHelpOverlayMinimize(1900);
    }
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
