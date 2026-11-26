import { applyAutoScaling } from "./auto-factor.mjs";
import { SI_PREFIXES, formatSIUnit, parseSIUnit } from "./si-units.mjs";
import { dom } from "./dom.js";
import { axisConfig, normalizeMetricRenderMode, state } from "./model.js";
import { loadData } from "./data.js";
import { exportCSV, exportJSON, exportPNG } from "./exporters.js";
import { runAnalyze } from "./analyze.js";
import { fetchFrontendConfig } from "./api.js";
import { renderCollapsedLegend } from "./collapsed-legend.js";
import { wireExpressionModal } from "./expressions.js";
import { createHelpModule } from "./help.js";
import { buildLegacyChartsUrl } from "./legacy-url.mjs";
import {
  formatDecimalInput,
  formatFixed,
  formatInteger,
  parseLocalizedNumber,
} from "./number-format.mjs";
import {
  addMetric,
  clearMetrics,
  fetchMetadata,
  recolorMetricsClassic,
  recolorMetrics,
  renderHints,
  renderMetricList,
  searchMetricHints,
  setAllVisible,
  applyFactorFromModal,
} from "./metrics.js";
import { wireMetricSearchField } from "./metric-search-field.js";
import { wireAdvancedSearch } from "./advanced-search.js";
import {
  getPlotXBoundsInCanvas,
  hideHover,
  isChartInteractive,
  MAX_ZOOM_RANGE_MS,
  MIN_ZOOM_RANGE_MS,
  panByPixels,
  renderChart,
  showHover,
  timestampAtCanvasX,
  zoomAt,
} from "./chart.js";
import {
  setInitialRange,
  toLocalInput,
  updateRangeButtonLabel,
} from "./time-range-ui.mjs";
import { applyTokenOffset, relativeRangeStart } from "./time-range.mjs";
import { ensureGlobalYAxisRange } from "./y-axis.mjs";
import {
  applyLegacyWebviewHashFallback,
  applyStateFromUrl,
  InvalidUrlStateError,
  syncUrlStateNow,
} from "./url-state.mjs";

let suppressUrlStateSync = false;
function syncUrlStateIfAllowed() {
  if (suppressUrlStateSync) return;
  void syncUrlStateNow().catch(() => {});
}

document.addEventListener("metricq:legend-moved", () => syncUrlStateIfAllowed());

function onStateChangedCombined() {
  renderContextualHelp();
  syncUrlStateIfAllowed();
}

const hooks = {
  renderChart,
  loadData: () => loadData(renderChart, onStateChangedCombined),
  renderCollapsedLegend,
  onStateChanged: onStateChangedCombined,
};

const presetTokenMap = {
  last_15m: ["now-15m", "now"],
  last_1h: ["now-1h", "now"],
  last_6h: ["now-6h", "now"],
  last_24h: ["now-24h", "now"],
  last_3d: ["now-3d", "now"],
  last_7d: ["now-7d", "now"],
  last_30d: ["now-30d", "now"],
  last_3M: ["now-3M", "now"],
  last_6M: ["now-6M", "now"],
  last_1y: ["now-1y", "now"],
  last_3y: ["now-3y", "now"],
  today: ["startday", "endday"],
  today_now: ["startday", "now"],
  yesterday: ["startday-1d", "endday-1d"],
  this_hour: ["starthour", "endhour"],
  this_week: ["startweek", "endweek"],
  this_week_now: ["startweek", "now"],
  this_month: ["startmonth", "endmonth"],
  this_month_now: ["startmonth", "now"],
  prev_month: ["startmonth-1M", "endmonth-1M"],
  this_year: ["startyear", "endyear"],
  this_year_now: ["startyear", "now"],
  prev_year: ["startyear-1y", "endyear-1y"],
};
const COMPACT_SIDEBAR_BREAKPOINT_PX = 1400;
// Bootstrap's sm breakpoint (576px) — "smaller than sm" is everything under it.
const HELP_BUTTON_BURGER_BREAKPOINT_PX = 576;
let zoomRangeBadgeTimer = null;
let helpButtonInBurgerMenu = false;
let wheelZoomLoadTimer = null;
let timeDialogMode = "relative";
let helpModule = null;
let sharePopTimer = null;
let metricSearchMode = "infix";
let metricSearchFocused = false;

function renderContextualHelp() {
  helpModule?.renderContextualHelp();
}

function activeViewMode() {
  if (state.renderMode === "ti") return "ti";
  if (state.renderMode === "candlestick") return "candlestick";
  return normalizeMetricRenderMode(state.metricRenderMode);
}

function syncViewButtons() {
  const buttons = [
    { el: dom.btnRenderBands, mode: "bands", title: "Linie mit Bändern" },
    { el: dom.btnRenderLine, mode: "line", title: "Nur Linie" },
    { el: dom.btnRenderCount, mode: "count", title: "Frequenz" },
    { el: dom.btnRenderTi, mode: "ti", title: "TI-Modus (Last-Semantik)" },
    { el: dom.btnRenderCandles, mode: "candlestick", title: "Kerzenchart (OHLC)" },
  ];
  const activeMode = activeViewMode();
  for (const { el, mode, title } of buttons) {
    if (!el) continue;
    const active = activeMode === mode;
    el.classList.add("btn-outline-secondary");
    el.classList.toggle("render-mode-active", active);
    el.title = title;
    el.setAttribute("aria-checked", active ? "true" : "false");
  }
}

function syncLegacyChartsButton() {
  if (!dom.btnOpenLegacyCharts) return;
  const hasBaseUrl = !!String(state.legacyChartsBaseUrl || "").trim();
  dom.btnOpenLegacyCharts.disabled = !hasBaseUrl;
  dom.btnOpenLegacyCharts.title = hasBaseUrl
    ? "Aktuellen View in Legacy Charts öffnen"
    : "Legacy-Charts-URL ist nicht konfiguriert";
}

function updateSidebarToggleIcon() {
  const icon = dom.btnSidebarToggle.querySelector("i");
  if (!icon) return;
  icon.className = state.sidebarCollapsed
    ? "bi bi-chevron-bar-left"
    : "bi bi-chevron-bar-right";
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = Boolean(collapsed);
  dom.metricsCol.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  dom.metricsCol.classList.toggle(
    "sidebar-overlay-open",
    state.compactSidebarMode && !state.sidebarCollapsed,
  );
  dom.chartCol.classList.toggle(
    "col-xxl-9",
    !state.sidebarCollapsed && !state.compactSidebarMode,
  );
  updateSidebarToggleIcon();
  syncViewButtons();
  renderCollapsedLegend();
  renderContextualHelp();
  renderChart();
}

function applyResponsiveSidebarMode() {
  const compact = window.innerWidth < COMPACT_SIDEBAR_BREAKPOINT_PX;
  if (compact === state.compactSidebarMode) return;

  state.compactSidebarMode = compact;
  dom.appContent.classList.toggle("compact-sidebar-mode", compact);
  dom.metricsCol.classList.toggle("compact-sidebar-mode", compact);
  if (compact) {
    setSidebarCollapsed(true);
    return;
  }
  setSidebarCollapsed(false);
}

// Moves the actual button node between its normal spot and the burger
// dropdown rather than duplicating it, so its listeners/state (is-visible,
// is-pop, etc.) stay attached to the one real element regardless of where
// it currently lives in the DOM.
function applyResponsiveHelpButtonPlacement() {
  const shouldBeInBurger = window.innerWidth < HELP_BUTTON_BURGER_BREAKPOINT_PX;
  if (shouldBeInBurger === helpButtonInBurgerMenu) return;
  helpButtonInBurgerMenu = shouldBeInBurger;
  if (!dom.btnHelpOverlayToggle) return;
  if (shouldBeInBurger) {
    dom.topNavControls?.insertBefore(
      dom.btnHelpOverlayToggle,
      dom.topNavControls.firstChild,
    );
  } else {
    dom.navbarRightGroup?.insertBefore(
      dom.btnHelpOverlayToggle,
      dom.navbarRightGroup.firstChild,
    );
  }
}

function showUrlStateErrorModal(message) {
  const text =
    String(message || "").trim() ||
    "Der Link-Status war ungültig und wurde entfernt.";
  if (
    !dom.urlStateErrorModal ||
    !dom.urlStateErrorText ||
    !globalThis.bootstrap?.Modal
  ) {
    return;
  }
  dom.urlStateErrorText.textContent = text;
  globalThis.bootstrap.Modal.getOrCreateInstance(dom.urlStateErrorModal).show();
}

function clearUrlToBasePath() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  history.replaceState(null, "", url);
}

function positionTimePopup() {
  const anchor = dom.btnTimeRange.getBoundingClientRect();
  const popup = dom.timePopup;
  if (!popup) return;
  const top = anchor.bottom + 8;
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - popup.offsetWidth - 8),
  );
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

function openTimePopup() {
  timeDialogMode = state.timeMode === "absolute" ? "absolute" : "relative";
  switchTimeMode(timeDialogMode);
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
  dom.timePopup.classList.remove("d-none");
  dom.btnTimeRange.classList.add("time-range-open");
  updateRelativePreview();
  positionTimePopup();
}

function closeTimePopup() {
  dom.timePopup.classList.add("d-none");
  dom.btnTimeRange.classList.remove("time-range-open");
}

function toggleTimePopup() {
  if (dom.timePopup.classList.contains("d-none")) openTimePopup();
  else closeTimePopup();
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {}

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.top = "0";
  document.body.appendChild(fallback);
  fallback.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {
    ok = false;
  }
  document.body.removeChild(fallback);
  return ok;
}

function showShareCopiedPop(anchorEl, text = "Kopiert.", kind = "success") {
  if (!anchorEl) return;
  let pop = document.getElementById("shareCopyPop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "shareCopyPop";
    pop.className = "share-copy-pop";
    document.body.appendChild(pop);
  }
  pop.textContent = String(text || "Kopiert.");
  pop.classList.toggle("is-error", kind === "error");
  pop.classList.toggle("is-success", kind !== "error");
  const rect = anchorEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth;
  const clampedX = Math.max(24, Math.min(viewportWidth - 24, centerX));
  const top = rect.bottom + 12;
  pop.style.left = `${Math.round(clampedX)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.classList.remove("is-visible");
  void pop.offsetWidth;
  pop.classList.add("is-visible");
  if (sharePopTimer) window.clearTimeout(sharePopTimer);
  sharePopTimer = window.setTimeout(() => {
    pop.classList.remove("is-visible");
    sharePopTimer = null;
  }, 1100);
}

async function showUrlQrModal() {
  await syncUrlStateNow().catch(() => {});
  const currentUrl = window.location.href;
  if (dom.urlQrImage) {
    const qrUrl = new URL("https://api.qrserver.com/v1/create-qr-code/");
    qrUrl.searchParams.set("size", "320x320");
    qrUrl.searchParams.set("data", currentUrl);
    dom.urlQrImage.src = qrUrl.toString();
  }
  const modal = globalThis.bootstrap?.Modal.getOrCreateInstance(dom.urlQrModal);
  modal?.show();
}

function fitContentHeight() {
  const nav = document.querySelector("nav.navbar");
  const content = document.getElementById("appContent");
  const main = document.querySelector("main.app-main");
  if (!content || !main) return;

  const navH = nav ? nav.offsetHeight : 0;
  const mainStyle = window.getComputedStyle(main);
  const padTop = parseFloat(mainStyle.paddingTop || "0");
  const padBottom = parseFloat(mainStyle.paddingBottom || "0");
  const available = window.innerHeight - navH - padTop - padBottom;
  content.style.height = `${Math.max(260, Math.floor(available))}px`;
}

function formatDurationHuman(ms) {
  const plural = (n, one, many) => (n === 1 ? one : many);
  const abs = Math.max(0, Math.round(ms));
  if (abs < 1000) return `${abs} ms`;
  if (abs < 60_000) {
    const sec = abs / 1000;
    const text =
      sec < 10 ? formatFixed(sec, 1) : formatInteger(Math.round(sec));
    return `${text} s`;
  }
  if (abs < 3_600_000) {
    const min = Math.floor(abs / 60_000);
    const sec = Math.round((abs % 60_000) / 1000);
    return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
  }
  if (abs < 86_400_000) {
    const h = Math.floor(abs / 3_600_000);
    const min = Math.round((abs % 3_600_000) / 60_000);
    return min > 0 ? `${h} h ${min} min` : `${h} h`;
  }
  const dayMs = 86_400_000;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;
  if (abs >= yearMs) {
    const years = Math.floor(abs / yearMs);
    const months = Math.round((abs % yearMs) / monthMs);
    if (months >= 12)
      return `${years + 1} ${plural(years + 1, "Jahr", "Jahre")}`;
    return months > 0
      ? `${years} ${plural(years, "Jahr", "Jahre")} ${months} ${plural(months, "Monat", "Monate")}`
      : `${years} ${plural(years, "Jahr", "Jahre")}`;
  }
  if (abs >= monthMs) {
    const months = Math.floor(abs / monthMs);
    const days = Math.round((abs % monthMs) / dayMs);
    return days > 0
      ? `${months} ${plural(months, "Monat", "Monate")} ${days} ${plural(days, "Tag", "Tage")}`
      : `${months} ${plural(months, "Monat", "Monate")}`;
  }
  const d = Math.floor(abs / 86_400_000);
  const h = Math.round((abs % 86_400_000) / 3_600_000);
  return h > 0
    ? `${d} ${plural(d, "Tag", "Tage")} ${h} h`
    : `${d} ${plural(d, "Tag", "Tage")}`;
}

function showZoomRangeBadge() {
  if (!dom.zoomRangeBadge) return;
  dom.zoomRangeBadge.textContent = formatDurationHuman(state.to - state.from);
  dom.zoomRangeBadge.classList.add("is-visible");
  if (zoomRangeBadgeTimer != null) window.clearTimeout(zoomRangeBadgeTimer);
  zoomRangeBadgeTimer = window.setTimeout(() => {
    dom.zoomRangeBadge.classList.remove("is-visible");
    zoomRangeBadgeTimer = null;
  }, 900);
}

function scheduleWheelZoomDataLoad() {
  if (wheelZoomLoadTimer != null) window.clearTimeout(wheelZoomLoadTimer);
  wheelZoomLoadTimer = window.setTimeout(() => {
    wheelZoomLoadTimer = null;
    hooks.loadData();
  }, 50);
}

function resetPenTracking() {
  state.penPointerId = null;
}

function beginPenPan(clientX) {
  forceAbsoluteTimeModeFromCurrentRange();
  hideHover();
  state.interactionMode = "pan";
  state.isPanning = true;
  state.panStartX = clientX;
  state.panRangeStart = state.from;
  state.panRangeEnd = state.to;
}

function zoomByFactor(factor) {
  forceAbsoluteTimeModeFromCurrentRange();
  const center = state.from + (state.to - state.from) / 2;
  zoomAt(center, factor, () => {
    showZoomRangeBadge();
    hooks.loadData();
  });
}

function forceAbsoluteTimeModeFromCurrentRange() {
  if (state.timeMode !== "relative") return;
  state.timeMode = "absolute";
  switchTimeMode("absolute");
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
  updateRangeButtonLabel();
}

function getClampedClientX(clientX) {
  const rect = dom.canvas.getBoundingClientRect();
  const bounds = getPlotXBoundsInCanvas();
  if (!bounds) return Math.max(rect.left, Math.min(clientX, rect.right));
  const minClientX = rect.left + bounds.left;
  const maxClientX = rect.left + bounds.right;
  return Math.max(minClientX, Math.min(clientX, maxClientX));
}

function hideDragSelection() {
  dom.dragSelectBox.classList.add("d-none");
}

const yAxisPanes = [];

function createYAxisPane(axis) {
  const root = document.createElement("div");
  const id = (name) => `yAxis${axis}${name}`;
  root.innerHTML = `
    <div class="mb-3">
      <label for="${id("Scale")}" class="form-label">Achsenskalierung</label>
      <select id="${id("Scale")}" class="form-select" aria-describedby="${id("ScaleHint")}">
        <option value="linear">Linear</option>
        <option value="symlog">Symmetrisch logarithmisch</option>
      </select>
      <div class="form-text" id="${id("ScaleHint")}" aria-live="polite"></div>
    </div>
    <div class="form-label">Achsenbereich</div>
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name="${id("Mode")}" id="${id("ModeLocal")}" value="local" checked />
      <label class="form-check-label" for="${id("ModeLocal")}">Lokal (sichtbarer Zeitraum)</label>
    </div>
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name="${id("Mode")}" id="${id("ModeGlobal")}" value="global" />
      <label class="form-check-label" for="${id("ModeGlobal")}">Global (historisches Min/Max)</label>
    </div>
    <div class="form-check mb-3">
      <input class="form-check-input" type="radio" name="${id("Mode")}" id="${id("ModeManual")}" value="manual" />
      <label class="form-check-label" for="${id("ModeManual")}">Manuell</label>
    </div>
    <div class="row g-2">
      <div class="col">
        <label for="${id("ManualMin")}" class="form-label">Min</label>
        <input id="${id("ManualMin")}" type="text" class="form-control" inputmode="decimal" />
      </div>
      <div class="col">
        <label for="${id("ManualMax")}" class="form-label">Max</label>
        <input id="${id("ManualMax")}" type="text" class="form-control" inputmode="decimal" />
      </div>
    </div>`;
  const pane = {
    axis,
    root,
    scale: root.querySelector(`#${id("Scale")}`),
    hint: root.querySelector(`#${id("ScaleHint")}`),
    modes: [...root.querySelectorAll(`input[name="${id("Mode")}"]`)],
    min: root.querySelector(`#${id("ManualMin")}`),
    max: root.querySelector(`#${id("ManualMax")}`),
  };
  const selectedMode = () => pane.modes.find((r) => r.checked)?.value || "local";
  pane.selectedMode = selectedMode;
  pane.updateManualEnabled = () => {
    const manual = selectedMode() === "manual";
    pane.min.disabled = !manual;
    pane.max.disabled = !manual;
  };
  pane.updateHint = () => {
    pane.hint.textContent = pane.scale.value === "symlog"
      ? "Nahe Null annähernd linear, bei größeren Beträgen logarithmisch. Negative Werte werden spiegelbildlich dargestellt. Der Übergangsbereich passt sich den sichtbaren Daten an."
      : "Gleiche Wertunterschiede haben gleiche Abstände auf der Achse.";
  };
  pane.scale.addEventListener("change", pane.updateHint);
  for (const radio of pane.modes) radio.addEventListener("change", pane.updateManualEnabled);
  return pane;
}

function ensureYAxisPanes() {
  if (yAxisPanes.length) return;
  for (const axis of [0, 1]) {
    const pane = createYAxisPane(axis);
    yAxisPanes.push(pane);
    dom.yAxisPanes.append(pane.root);
  }
  dom.yAxisTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-axis]");
    if (button) showYAxisPane(Number(button.dataset.axis));
  });
}

function showYAxisPane(axis) {
  for (const pane of yAxisPanes) pane.root.classList.toggle("d-none", pane.axis !== axis);
  for (const button of dom.yAxisTabs.querySelectorAll("button[data-axis]")) {
    button.classList.toggle("active", Number(button.dataset.axis) === axis);
  }
}

function syncYAxisModalFromState() {
  ensureYAxisPanes();
  const hasSecondary = state.metrics.some((m) => m.axis === 1);
  dom.yAxisTabs.classList.toggle("d-none", !hasSecondary);
  showYAxisPane(0);
  for (const pane of yAxisPanes) {
    const cfg = axisConfig(pane.axis);
    pane.scale.value = cfg.scale;
    pane.updateHint();
    for (const radio of pane.modes) radio.checked = radio.value === cfg.mode;
    const fillMin = Number.isFinite(cfg.manualMin) ? cfg.manualMin : cfg.currentMin;
    const fillMax = Number.isFinite(cfg.manualMax) ? cfg.manualMax : cfg.currentMax;
    pane.min.value = Number.isFinite(fillMin) ? formatDecimalInput(fillMin) : "";
    pane.max.value = Number.isFinite(fillMax) ? formatDecimalInput(fillMax) : "";
    pane.updateManualEnabled();
  }
  dom.yAxisUnits.replaceChildren();
  const families = [...new Set(state.metrics.map((m) => parseSIUnit(m.unit)?.family).filter(Boolean))];
  for (const family of families) {
    const label = document.createElement("label");
    label.className = "d-flex align-items-center gap-2";
    const name = document.createElement("span");
    name.textContent = family;
    const select = document.createElement("select");
    select.className = "form-select";
    select.dataset.family = family;
    select.add(new Option("Automatisch", "auto"));
    for (const prefix of SI_PREFIXES) select.add(new Option(formatSIUnit(family, prefix.exp).replace("u", "µ"), String(prefix.exp)));
    select.value = state.yAxisUnits[family] == null ? "auto" : String(state.yAxisUnits[family]);
    label.append(name, select);
    dom.yAxisUnits.append(label);
  }
  if (families.length === 0) dom.yAxisUnits.textContent = "Keine skalierbaren Einheiten vorhanden.";
}

function updateDragSelection() {
  if (state.interactionMode !== "zoom-select") return;
  const wrapRect = dom.chartWrap.getBoundingClientRect();
  const leftClientX = Math.min(state.dragStartX, state.dragCurrentX);
  const rightClientX = Math.max(state.dragStartX, state.dragCurrentX);
  const left = leftClientX - wrapRect.left;
  const width = Math.max(1, rightClientX - leftClientX);
  const fromTs = timestampAtCanvasX(leftClientX);
  const toTs = timestampAtCanvasX(rightClientX);
  dom.dragSelectBox.style.left = `${left}px`;
  dom.dragSelectBox.style.width = `${width}px`;
  dom.dragSelectBox.textContent = formatDurationHuman(Math.abs(toTs - fromTs));
  dom.dragSelectBox.classList.remove("d-none");
}

function commitDragZoom() {
  const pxWidth = Math.abs(state.dragCurrentX - state.dragStartX);
  if (pxWidth < 6) {
    hideDragSelection();
    return;
  }
  const tA = timestampAtCanvasX(state.dragStartX);
  const tB = timestampAtCanvasX(state.dragCurrentX);
  const from = Math.min(tA, tB);
  const to = Math.max(tA, tB);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 1) {
    hideDragSelection();
    return;
  }
  const rawRange = to - from;
  const clampedRange = Math.max(
    MIN_ZOOM_RANGE_MS,
    Math.min(MAX_ZOOM_RANGE_MS, rawRange),
  );
  const center = from + rawRange / 2;
  state.from = Math.round(center - clampedRange / 2);
  state.to = Math.round(center + clampedRange / 2);
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
  updateRangeButtonLabel();
  showZoomRangeBadge();
  hideDragSelection();
  hooks.loadData();
}

function wireTopBarEvents() {
  dom.btnZoomIn.addEventListener("click", () => zoomByFactor(0.8));
  dom.btnZoomOut.addEventListener("click", () => zoomByFactor(1.25));
  dom.btnShiftBack.addEventListener("click", () => {
    shiftRangeByFactor(-0.5);
    hooks.loadData();
  });
  dom.btnShiftForward.addEventListener("click", () => {
    shiftRangeByFactor(0.5);
    hooks.loadData();
  });
  dom.btnTimeRange.addEventListener("click", toggleTimePopup);
  dom.btnShare?.addEventListener("click", async () => {
    await syncUrlStateNow().catch(() => {});
    const copied = await copyTextToClipboard(window.location.href);
    if (copied) showShareCopiedPop(dom.btnShare, "Kopiert.", "success");
    else showShareCopiedPop(dom.btnShare, "Kopieren fehlgeschlagen.", "error");
  });
  dom.btnShowUrlQr?.addEventListener("click", () => {
    void showUrlQrModal();
  });
  dom.btnOpenLegacyCharts?.addEventListener("click", () => {
    const url = buildLegacyChartsUrl(
      state.legacyChartsBaseUrl,
      {
        metrics: state.metrics,
        from: state.from,
        to: state.to,
      },
      window.location.href,
    );
    if (!url) {
      showShareCopiedPop(
        dom.btnOpenLegacyCharts,
        "Keine kompatiblen Rohmetriken im View.",
        "error",
      );
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  });
  const setView = (renderMode, metricRenderMode) => {
    const renderModeChanged = state.renderMode !== renderMode;
    state.renderMode = renderMode;
    state.metricRenderMode = normalizeMetricRenderMode(metricRenderMode);
    syncViewButtons();
    if (renderModeChanged) {
      hooks.loadData();
    } else {
      renderChart();
      syncUrlStateIfAllowed();
    }
  };
  dom.btnRenderBands?.addEventListener("click", () => {
    setView("standard", "bands");
  });
  dom.btnRenderLine?.addEventListener("click", () => {
    setView("standard", "line");
  });
  dom.btnRenderCount?.addEventListener("click", () => {
    setView("standard", "count");
  });
  dom.btnRenderTi?.addEventListener("click", () => {
    setView("ti", "bands");
  });
  dom.btnRenderCandles?.addEventListener("click", () => {
    setView("candlestick", "bands");
  });
  dom.btnSidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!state.sidebarCollapsed);
  });
  dom.btnSidebarClose?.addEventListener("click", () => {
    setSidebarCollapsed(true);
  });
}

function wireTimeDialogEvents() {
  dom.btnCloseTimePopup.addEventListener("click", closeTimePopup);
  dom.btnCancelTimeRange.addEventListener("click", closeTimePopup);
  dom.btnApplyTimeRange.addEventListener("click", () => {
    const absoluteActive =
      timeDialogMode === "absolute" ||
      dom.tabAbsolute.classList.contains("active") ||
      !dom.absolutePanel.classList.contains("d-none");
    if (absoluteActive) {
      const from = new Date(dom.fromInput.value).getTime();
      const to = new Date(dom.toInput.value).getTime();
      if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
        state.timeMode = "absolute";
        state.from = from;
        state.to = to;
      }
    } else {
      state.timeMode = "relative";
      const rel = applyRelativeRange();
      state.from = rel.from;
      state.to = rel.to;
      dom.fromInput.value = toLocalInput(new Date(state.from));
      dom.toInput.value = toLocalInput(new Date(state.to));
    }
    updateRangeButtonLabel();
    hooks.loadData();
    closeTimePopup();
  });

  dom.rangePresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    button.classList.remove("time-shortcut-active");
    // restart animation even when quickly re-clicking same shortcut
    void button.offsetWidth;
    button.classList.add("time-shortcut-active");
    window.setTimeout(
      () => button.classList.remove("time-shortcut-active"),
      460,
    );
    applyPreset(button.dataset.range);
  });

  dom.tabRelative.addEventListener("click", (event) => {
    event.preventDefault();
    switchTimeMode("relative");
  });
  dom.tabAbsolute.addEventListener("click", (event) => {
    event.preventDefault();
    switchTimeMode("absolute");
  });
  dom.relativeAmount.addEventListener("input", updateRelativePreview);
  dom.relativeUnit.addEventListener("change", updateRelativePreview);

  dom.timePopup.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      event.repeat ||
      dom.timePopup.classList.contains("d-none") ||
      !event.target.matches("input, select")
    ) return;
    event.preventDefault();
    dom.btnApplyTimeRange.click();
  });

  document.addEventListener("mousedown", (event) => {
    if (dom.timePopup.classList.contains("d-none")) return;
    const target = event.target;
    if (dom.timePopup.contains(target) || dom.btnTimeRange.contains(target))
      return;
    closeTimePopup();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTimePopup();
  });
}

function wireMetricPanelEvents() {
  wireMetricSearchField({
    wrapEl: dom.metricSearchWrap,
    groupEl: dom.metricSearchGroup,
    inputEl: dom.metricSearch,
    resetEl: dom.btnResetMetricSearch,
    prefixEl: dom.metricSearchModePrefix,
    debounceMs: 220,
    minLength: 2,
    onModeChange: (mode) => {
      metricSearchMode = mode;
      renderContextualHelp();
    },
    onFocusChange: (focused, mode) => {
      metricSearchFocused = focused;
      metricSearchMode = mode;
      renderContextualHelp();
    },
    onSearch: async (query, mode) => {
      if (!query) {
        dom.metricHints.innerHTML = "";
        return;
      }
      const hints = await searchMetricHints(query, { mode });
      renderHints(hints, hooks);
    },
  });

  dom.btnHideAll.addEventListener("click", () => setAllVisible(false, hooks));
  dom.btnShowAll.addEventListener("click", () => setAllVisible(true, hooks));
  dom.btnClear.addEventListener("click", () => clearMetrics(hooks));
  dom.btnRecolorClassic.addEventListener("click", () =>
    recolorMetricsClassic(hooks),
  );
  dom.btnRecolor.addEventListener("click", () => recolorMetrics(hooks));
}

function wireModalEvents() {
  dom.analyzeModal.addEventListener("shown.bs.modal", runAnalyze);
  dom.btnExportPng.addEventListener("click", exportPNG);
  dom.btnExportCsv.addEventListener("click", exportCSV);
  dom.btnExportJson.addEventListener("click", exportJSON);
  dom.btnApplyFactor.addEventListener("click", () =>
    applyFactorFromModal(hooks),
  );
}

function wireYAxisEvents() {
  dom.btnYAxis.addEventListener("click", syncYAxisModalFromState);
  dom.yAxisModal.addEventListener("shown.bs.modal", syncYAxisModalFromState);
  dom.btnApplyYAxis.addEventListener("click", async () => {
    ensureYAxisPanes();
    for (const pane of yAxisPanes) {
      const prefix = pane.axis === 1 ? "yAxis2" : "yAxis";
      const mode = pane.selectedMode();
      state[`${prefix}Mode`] = mode;
      state[`${prefix}Scale`] = pane.scale.value === "symlog" ? "symlog" : "linear";
      const manualMin = parseLocalizedNumber(pane.min.value);
      const manualMax = parseLocalizedNumber(pane.max.value);
      state[`${prefix}ManualMin`] = mode === "manual" && Number.isFinite(manualMin) ? manualMin : null;
      state[`${prefix}ManualMax`] = mode === "manual" && Number.isFinite(manualMax) ? manualMax : null;
    }
    const units = { ...state.yAxisUnits };
    for (const select of dom.yAxisUnits.querySelectorAll("select[data-family]")) {
      if (select.value === "auto") delete units[select.dataset.family];
      else units[select.dataset.family] = Number(select.value);
    }
    state.yAxisUnits = units;
    applyAutoScaling(state.metrics, state.series);
    renderMetricList(hooks);
    renderCollapsedLegend();
    if (state.yAxisMode === "global" || state.yAxis2Mode === "global") {
      try {
        await ensureGlobalYAxisRange();
      } catch (_) {}
    }
    renderChart();
    hooks.onStateChanged();
  });
}

function wireCanvasInteractionEvents() {
  const touchDistance = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.hypot(dx, dy);
  };

  const touchMidpointClientX = (touches) => {
    if (!touches || touches.length < 2) return 0;
    return (touches[0].clientX + touches[1].clientX) / 2;
  };

  const previewPinchZoom = (clientX, scale) => {
    const old = state.pinchRangeEnd - state.pinchRangeStart;
    if (!(old > 0) || !(scale > 0)) return;
    const next = old / scale;
    if (next < MIN_ZOOM_RANGE_MS || next > MAX_ZOOM_RANGE_MS) return;
    const center = Number.isFinite(state.pinchCenterMs)
      ? state.pinchCenterMs
      : timestampAtCanvasX(clientX);
    const rel = (center - state.pinchRangeStart) / old;
    state.from = Math.round(center - next * rel);
    state.to = Math.round(center + next * (1 - rel));
    dom.fromInput.value = toLocalInput(new Date(state.from));
    dom.toInput.value = toLocalInput(new Date(state.to));
    updateRangeButtonLabel();
    renderChart();
  };

  dom.canvas.addEventListener("mousemove", showHover);
  dom.canvas.addEventListener("mouseleave", hideHover);

  dom.canvas.addEventListener("mousedown", (event) => {
    if (!isChartInteractive()) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    hideHover();
    if (event.ctrlKey) {
      forceAbsoluteTimeModeFromCurrentRange();
      state.interactionMode = "pan";
      state.isPanning = true;
      state.panStartX = event.clientX;
      state.panRangeStart = state.from;
      state.panRangeEnd = state.to;
      return;
    }
    state.interactionMode = "zoom-select";
    state.dragStartX = getClampedClientX(event.clientX);
    state.dragCurrentX = state.dragStartX;
    updateDragSelection();
  });

  window.addEventListener("mouseup", () => {
    if (state.interactionMode === "pan") {
      if (state.isPanning) {
        state.isPanning = false;
        hooks.loadData();
      }
      state.interactionMode = "";
      return;
    }
    if (state.interactionMode === "zoom-select") {
      commitDragZoom();
      state.interactionMode = "";
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (state.interactionMode === "pan" && state.isPanning) {
      panByPixels(event.clientX - state.panStartX);
      return;
    }
    if (state.interactionMode === "zoom-select") {
      state.dragCurrentX = getClampedClientX(event.clientX);
      updateDragSelection();
    }
  });

  dom.canvas.addEventListener(
    "wheel",
    (event) => {
      if (!isChartInteractive()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      forceAbsoluteTimeModeFromCurrentRange();
      const center = timestampAtCanvasX(event.clientX);
      zoomAt(center, event.deltaY < 0 ? 0.8 : 1.25, () => {
        showZoomRangeBadge();
        scheduleWheelZoomDataLoad();
      });
    },
    { passive: false },
  );

  dom.canvas.addEventListener(
    "touchstart",
    (event) => {
      if (!isChartInteractive()) {
        event.preventDefault();
        return;
      }
      if (event.touches.length === 1) {
        event.preventDefault();
        hideHover();
        forceAbsoluteTimeModeFromCurrentRange();
        state.interactionMode = "pan";
        state.isPanning = true;
        state.panStartX = event.touches[0].clientX;
        state.panRangeStart = state.from;
        state.panRangeEnd = state.to;
        return;
      }
      if (event.touches.length >= 2) {
        event.preventDefault();
        hideHover();
        forceAbsoluteTimeModeFromCurrentRange();
        state.interactionMode = "pinch";
        state.isPanning = false;
        state.pinchStartDistance = touchDistance(event.touches);
        state.pinchRangeStart = state.from;
        state.pinchRangeEnd = state.to;
        state.pinchCenterMs = timestampAtCanvasX(
          touchMidpointClientX(event.touches),
        );
      }
    },
    { passive: false },
  );

  dom.canvas.addEventListener(
    "touchmove",
    (event) => {
      if (!isChartInteractive()) {
        event.preventDefault();
        return;
      }
      if (
        state.interactionMode === "pan" &&
        state.isPanning &&
        event.touches.length === 1
      ) {
        event.preventDefault();
        panByPixels(event.touches[0].clientX - state.panStartX);
        return;
      }
      if (state.interactionMode === "pinch" && event.touches.length >= 2) {
        event.preventDefault();
        const distance = touchDistance(event.touches);
        if (!(distance > 0) || !(state.pinchStartDistance > 0)) return;
        previewPinchZoom(
          touchMidpointClientX(event.touches),
          distance / state.pinchStartDistance,
        );
      }
    },
    { passive: false },
  );

  const finishTouchInteraction = () => {
    if (state.interactionMode === "pan" && state.isPanning) {
      state.isPanning = false;
      state.interactionMode = "";
      hooks.loadData();
      return;
    }
    if (state.interactionMode === "pinch") {
      state.interactionMode = "";
      hooks.loadData();
    }
  };

  dom.canvas.addEventListener("touchend", finishTouchInteraction, {
    passive: true,
  });
  dom.canvas.addEventListener("touchcancel", finishTouchInteraction, {
    passive: true,
  });

  dom.canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "pen") return;
    if (!isChartInteractive()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    dom.canvas.setPointerCapture?.(event.pointerId);
    state.penPointerId = event.pointerId;
    state.penStartX = event.clientX;
    state.penStartY = event.clientY;
    beginPenPan(state.penStartX);
  });

  dom.canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "pen") return;
    if (state.penPointerId !== event.pointerId) return;
    event.preventDefault();
    if (state.interactionMode === "pan" && state.isPanning) {
      panByPixels(event.clientX - state.panStartX);
    }
  });

  dom.canvas.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "pen") return;
    if (state.penPointerId !== event.pointerId) return;
    event.preventDefault();
    dom.canvas.releasePointerCapture?.(event.pointerId);
    if (state.interactionMode === "pan" && state.isPanning) {
      state.isPanning = false;
      state.interactionMode = "";
      resetPenTracking();
      hooks.loadData();
    } else {
      resetPenTracking();
    }
  });

  dom.canvas.addEventListener("pointercancel", (event) => {
    if (event.pointerType !== "pen") return;
    if (state.penPointerId !== event.pointerId) return;
    dom.canvas.releasePointerCapture?.(event.pointerId);
    if (state.interactionMode === "pan") {
      state.isPanning = false;
      state.interactionMode = "";
    }
    resetPenTracking();
  });

  window.addEventListener("resize", () => {
    applyResponsiveSidebarMode();
    applyResponsiveHelpButtonPlacement();
    fitContentHeight();
    renderChart();
    renderCollapsedLegend();
    if (!dom.timePopup.classList.contains("d-none")) positionTimePopup();
  });
}

function wireEvents() {
  wireExpressionModal(hooks);
  wireAdvancedSearch({ addMetric: (name) => addMetric(name, hooks) });
  wireTopBarEvents();
  wireTimeDialogEvents();
  wireMetricPanelEvents();
  helpModule?.wireHelpEvents();
  wireModalEvents();
  wireYAxisEvents();
  wireCanvasInteractionEvents();
}

function shiftRangeByFactor(factor) {
  const range = state.to - state.from;
  if (!Number.isFinite(range) || range <= 0) return;
  forceAbsoluteTimeModeFromCurrentRange();
  const delta = Math.round(range * factor);
  state.from += delta;
  state.to += delta;
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
  updateRangeButtonLabel();
}

function switchTimeMode(mode) {
  const isRelative = mode === "relative";
  timeDialogMode = isRelative ? "relative" : "absolute";
  dom.tabRelative.classList.toggle("active", isRelative);
  dom.tabAbsolute.classList.toggle("active", !isRelative);
  dom.relativePanel.classList.toggle("d-none", !isRelative);
  dom.absolutePanel.classList.toggle("d-none", isRelative);
}

function updateRelativePreview() {
  const amount = Math.max(
    1,
    Number.parseInt(dom.relativeAmount.value, 10) || 1,
  );
  const unit = dom.relativeUnit.value || "h";
  dom.relativePreview.textContent = `now-${amount}${unit} to now`;
}

function applyRelativeRange() {
  const amount = Math.max(
    1,
    Number.parseInt(dom.relativeAmount.value, 10) || 1,
  );
  const unit = dom.relativeUnit.value || "h";
  const now = Date.now();
  return {
    from: relativeRangeStart(now, amount, unit),
    to: now,
  };
}

function relativePresetValues(preset) {
  const tokens = presetTokenMap[preset];
  if (!tokens || tokens.length !== 2) return null;
  const [fromToken, toToken] = tokens;
  if (toToken !== "now") return null;
  const m = /^now-(\d+)([mhdwMy])$/.exec(fromToken);
  if (!m) return null;
  const amount = Number.parseInt(m[1], 10);
  const unit = m[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit };
}

function applyPreset(preset) {
  const rel = relativePresetValues(preset);
  if (rel) {
    dom.relativeAmount.value = String(rel.amount);
    dom.relativeUnit.value = rel.unit;
    switchTimeMode("relative");
    updateRelativePreview();
    return;
  }

  const tokens = presetTokenMap[preset];
  if (!tokens) return;
  const now = new Date();
  const from = evalPresetToken(tokens[0], now);
  const to = evalPresetToken(tokens[1], now);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to
  ) {
    return;
  }

  dom.fromInput.value = toLocalInput(from);
  dom.toInput.value = toLocalInput(to);
  switchTimeMode("absolute");
}

function evalPresetToken(token, now) {
  const full = String(token || "").trim();
  const match = /^(?<base>[a-z]+)(?<offset>[+-]\d+[mhdwMy])?$/.exec(full);
  if (!match) return new Date(now);
  const { base, offset } = match.groups;
  const baseDate = baseTokenDate(base, now);
  if (!offset) return baseDate;
  return applyTokenOffset(baseDate, offset);
}

function baseTokenDate(base, now) {
  const d = new Date(now);
  if (base === "now") return d;

  if (base === "startday" || base === "endday") {
    d.setHours(0, 0, 0, 0);
    if (base === "endday") d.setHours(23, 59, 59, 999);
    return d;
  }

  if (base === "starthour" || base === "endhour") {
    d.setMinutes(0, 0, 0);
    if (base === "endhour") d.setMinutes(59, 59, 999);
    return d;
  }

  if (base === "startweek" || base === "endweek") {
    const mondayBased = (d.getDay() + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - mondayBased);
    if (base === "endweek") {
      d.setDate(d.getDate() + 7);
      d.setMilliseconds(d.getMilliseconds() - 1);
    }
    return d;
  }

  if (base === "startmonth" || base === "endmonth") {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    if (base === "endmonth") {
      d.setMonth(d.getMonth() + 1);
      d.setMilliseconds(d.getMilliseconds() - 1);
    }
    return d;
  }

  if (base === "startyear" || base === "endyear") {
    d.setHours(0, 0, 0, 0);
    d.setMonth(0, 1);
    if (base === "endyear") {
      d.setFullYear(d.getFullYear() + 1);
      d.setMilliseconds(d.getMilliseconds() - 1);
    }
    return d;
  }

  return d;
}

async function init() {
  let restoredFromUrl = false;
  let urlStateError = "";
  try {
    restoredFromUrl = await applyStateFromUrl();
    if (!restoredFromUrl) restoredFromUrl = applyLegacyWebviewHashFallback();
  } catch (err) {
    if (err instanceof InvalidUrlStateError) {
      urlStateError = err.message;
      clearUrlToBasePath();
      restoredFromUrl = false;
    } else {
      throw err;
    }
  }
  suppressUrlStateSync = Boolean(urlStateError);
  if (urlStateError) {
    showUrlStateErrorModal(urlStateError);
  }
  if (!restoredFromUrl) setInitialRange();
  helpModule = createHelpModule({
    setSidebarCollapsed,
    toggleTimePopup,
    renderChart,
  });
  syncYAxisModalFromState();
  syncViewButtons();
  try {
    const frontendConfig = await fetchFrontendConfig();
    state.legacyChartsBaseUrl = String(frontendConfig?.legacyChartsBaseUrl || "").trim();
  } catch (_) {
    state.legacyChartsBaseUrl = "";
  }
  syncLegacyChartsButton();
  applyResponsiveSidebarMode();
  applyResponsiveHelpButtonPlacement();
  fitContentHeight();
  wireEvents();
  if (restoredFromUrl) setSidebarCollapsed(true);
  else if (!state.compactSidebarMode) setSidebarCollapsed(false);
  renderMetricList(hooks);
  renderContextualHelp();
  for (const metric of state.metrics) {
    if (!metric.expr) fetchMetadata(metric.name, hooks);
  }
  try {
    await hooks.loadData();
  } catch (_) {
    renderChart();
  }
  if (urlStateError) {
    clearUrlToBasePath();
    suppressUrlStateSync = false;
    return;
  }
  suppressUrlStateSync = false;
  hooks.onStateChanged();
}

init();
