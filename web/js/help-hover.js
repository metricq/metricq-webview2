const HELP_ATTR = "data-help";
const NATIVE_TITLE_STASH_ATTR = "data-help-native-title";

let tooltipEl = null;
let currentTarget = null;
let wired = false;

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "help-hover-tooltip d-none";
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function isHelpHoverModeActive() {
  return document.body.classList.contains("help-hover-mode");
}

// Icon-only buttons wrap their real explanation on an ancestor (title or
// data-help), not on the <i> the pointer actually lands on — walk up to it.
function findHelpTarget(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      const text = node.getAttribute(HELP_ATTR) || node.getAttribute("title");
      if (text && text.trim()) return { node, text: text.trim() };
    }
    node = node.parentElement;
  }
  return null;
}

// The browser's own title tooltip would otherwise pop up late and fight
// for space with ours, so it's stashed away while help-hover owns the
// element, then put back exactly as it was.
function suppressNativeTitle(node) {
  const title = node.getAttribute("title");
  if (title != null) {
    node.setAttribute(NATIVE_TITLE_STASH_ATTR, title);
    node.removeAttribute("title");
  }
}

function restoreNativeTitle(node) {
  const stashed = node.getAttribute(NATIVE_TITLE_STASH_ATTR);
  if (stashed != null) {
    node.setAttribute("title", stashed);
    node.removeAttribute(NATIVE_TITLE_STASH_ATTR);
  }
}

function positionTooltip(el, targetRect) {
  const margin = 8;
  const rect = el.getBoundingClientRect();
  let left = targetRect.left + targetRect.width / 2 - rect.width / 2;
  left = Math.max(
    margin,
    Math.min(left, window.innerWidth - rect.width - margin),
  );
  let top = targetRect.bottom + margin;
  let placement = "bottom";
  if (top + rect.height > window.innerHeight - margin) {
    const above = targetRect.top - rect.height - margin;
    top = Math.max(margin, above);
    placement = "top";
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.classList.toggle("help-hover-tooltip-top", placement === "top");
  el.classList.toggle("help-hover-tooltip-bottom", placement === "bottom");
}

function showTooltipFor(match) {
  const el = ensureTooltipEl();
  el.textContent = match.text;
  el.classList.remove("d-none");
  positionTooltip(el, match.node.getBoundingClientRect());
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.classList.add("d-none");
}

function clearCurrentTarget() {
  if (!currentTarget) return;
  restoreNativeTitle(currentTarget);
  currentTarget = null;
  hideTooltip();
}

function handlePointerOver(event) {
  if (!isHelpHoverModeActive()) return;
  const match = findHelpTarget(event.target);
  if (!match) {
    clearCurrentTarget();
    return;
  }
  if (match.node === currentTarget) {
    positionTooltip(ensureTooltipEl(), match.node.getBoundingClientRect());
    return;
  }
  clearCurrentTarget();
  currentTarget = match.node;
  suppressNativeTitle(currentTarget);
  showTooltipFor(match);
}

function handlePointerOut(event) {
  if (!currentTarget) return;
  const related = event.relatedTarget;
  if (related && currentTarget.contains(related)) return;
  clearCurrentTarget();
}

export function setHelpHoverModeActive(active) {
  const next = !!active;
  if (document.body.classList.contains("help-hover-mode") === next) return;
  document.body.classList.toggle("help-hover-mode", next);
  if (!next) clearCurrentTarget();
}

export function initHelpHoverMode() {
  if (wired) return;
  wired = true;
  document.addEventListener("mouseover", handlePointerOver, true);
  document.addEventListener("mouseout", handlePointerOut, true);
  window.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
}
