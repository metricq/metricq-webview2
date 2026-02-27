import { dom } from "./dom.js";
import { state } from "./model.js";
import { loadData } from "./data.js";
import { exportCSV, exportJSON, exportPNG } from "./exporters.js";
import { runAnalyze } from "./analyze.js";
import { renderCollapsedLegend } from "./collapsed-legend.js";
import { wireExpressionModal } from "./expressions.js";
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
import {
  getPlotXBoundsInCanvas,
  hideHover,
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
} from "./utils.js";
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
  syncUrlStateNow();
}

const hooks = {
  renderChart,
  loadData: () => loadData(renderChart, syncUrlStateIfAllowed),
  renderCollapsedLegend,
  onStateChanged: syncUrlStateIfAllowed,
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
let zoomRangeBadgeTimer = null;

function syncRenderModeButton() {
  if (!dom.btnRenderMode) return;
  const tiActive = state.renderMode === "ti";
  dom.btnRenderMode.classList.toggle("btn-primary", tiActive);
  dom.btnRenderMode.classList.toggle("btn-outline-primary", !tiActive);
  dom.btnRenderMode.textContent = tiActive ? "TI" : "STD";
  dom.btnRenderMode.title = tiActive
    ? "TI-Modus aktiv (Last-Semantik)"
    : "Standard-Modus aktiv (Point-to-Point)";
}

function syncStackedModeButton() {
  if (!dom.btnStackedMode) return;
  const stackedActive = !!state.yAxisStacked;
  dom.btnStackedMode.classList.toggle("btn-primary", stackedActive);
  dom.btnStackedMode.classList.toggle("btn-outline-primary", !stackedActive);
  dom.btnStackedMode.title = stackedActive
    ? "Stacked-Mode aktiv"
    : "Stacked-Mode inaktiv";
}

function updateSidebarToggleIcon() {
  const icon = dom.btnSidebarToggle.querySelector("i");
  if (!icon) return;
  icon.className = state.sidebarCollapsed ? "bi bi-chevron-bar-left" : "bi bi-chevron-bar-right";
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
  syncRenderModeButton();
  syncStackedModeButton();
  renderCollapsedLegend();
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

function showUrlStateErrorModal(message) {
  const text = String(message || "").trim() || "Der Link-Status war ungültig und wurde entfernt.";
  if (!dom.urlStateErrorModal || !dom.urlStateErrorText || !globalThis.bootstrap?.Modal) {
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
  switchTimeMode(state.timeMode || "relative");
  dom.timePopup.classList.remove("d-none");
  updateRelativePreview();
  positionTimePopup();
}

function closeTimePopup() {
  dom.timePopup.classList.add("d-none");
}

function toggleTimePopup() {
  if (dom.timePopup.classList.contains("d-none")) openTimePopup();
  else closeTimePopup();
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
    const text = sec < 10
      ? sec.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : Math.round(sec).toLocaleString("de-DE");
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
    if (months >= 12) return `${years + 1} ${plural(years + 1, "Jahr", "Jahre")}`;
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
  return h > 0 ? `${d} ${plural(d, "Tag", "Tage")} ${h} h` : `${d} ${plural(d, "Tag", "Tage")}`;
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

function selectedYAxisMode() {
  if (dom.yAxisModeManual.checked) return "manual";
  if (dom.yAxisModeGlobal.checked) return "global";
  return "local";
}

function updateYAxisManualInputsEnabled() {
  const manual = selectedYAxisMode() === "manual";
  dom.yAxisManualMin.disabled = !manual;
  dom.yAxisManualMax.disabled = !manual;
}

function syncYAxisModalFromState() {
  dom.yAxisModeLocal.checked = state.yAxisMode === "local";
  dom.yAxisModeGlobal.checked = state.yAxisMode === "global";
  dom.yAxisModeManual.checked = state.yAxisMode === "manual";
  syncStackedModeButton();
  const fillMin = Number.isFinite(state.yAxisManualMin) ? state.yAxisManualMin : state.yAxisCurrentMin;
  const fillMax = Number.isFinite(state.yAxisManualMax) ? state.yAxisManualMax : state.yAxisCurrentMax;
  dom.yAxisManualMin.value = Number.isFinite(fillMin) ? String(fillMin) : "";
  dom.yAxisManualMax.value = Number.isFinite(fillMax) ? String(fillMax) : "";
  updateYAxisManualInputsEnabled();
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
  const clampedRange = Math.max(MIN_ZOOM_RANGE_MS, Math.min(MAX_ZOOM_RANGE_MS, rawRange));
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

function wireEvents() {
  wireExpressionModal(hooks);

  dom.btnShiftBack.addEventListener("click", () => {
    shiftRangeByFactor(-0.5);
    hooks.loadData();
  });
  dom.btnShiftForward.addEventListener("click", () => {
    shiftRangeByFactor(0.5);
    hooks.loadData();
  });
  dom.btnTimeRange.addEventListener("click", toggleTimePopup);
  dom.btnRenderMode.addEventListener("click", () => {
    state.renderMode = state.renderMode === "ti" ? "standard" : "ti";
    syncRenderModeButton();
    hooks.loadData();
  });
  dom.btnStackedMode.addEventListener("click", async () => {
    state.yAxisStacked = !state.yAxisStacked;
    syncStackedModeButton();
    renderMetricList(hooks);
    if (state.yAxisMode === "global") {
      try {
        await ensureGlobalYAxisRange();
      } catch (_) {}
    }
    hooks.loadData();
  });
  dom.btnSidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!state.sidebarCollapsed);
  });
  dom.btnCloseTimePopup.addEventListener("click", closeTimePopup);
  dom.btnCancelTimeRange.addEventListener("click", closeTimePopup);
  dom.btnApplyTimeRange.addEventListener("click", () => {
    const absoluteActive =
      state.timeMode === "absolute" ||
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
      applyRelativeRange();
    }
    updateRangeButtonLabel();
    hooks.loadData();
    closeTimePopup();
  });

  dom.btnAddMetric.addEventListener("click", () => {
    addMetric(dom.metricSearch.value.trim(), hooks);
    dom.metricSearch.value = "";
    dom.metricHints.innerHTML = "";
  });

  dom.btnHideAll.addEventListener("click", () => setAllVisible(false, hooks));
  dom.btnShowAll.addEventListener("click", () => setAllVisible(true, hooks));
  dom.btnClear.addEventListener("click", () => clearMetrics(hooks));
  dom.btnRecolorClassic.addEventListener("click", () => recolorMetricsClassic(hooks));
  dom.btnRecolor.addEventListener("click", () => recolorMetrics(hooks));

  dom.metricSearch.addEventListener("input", () => {
    window.clearTimeout(dom.metricSearch._timer);
    dom.metricSearch._timer = window.setTimeout(async () => {
      const hints = await searchMetricHints(dom.metricSearch.value.trim());
      renderHints(hints, hooks);
    }, 220);
  });

  dom.analyzeModal.addEventListener("shown.bs.modal", runAnalyze);

  dom.btnExportPng.addEventListener("click", exportPNG);
  dom.btnExportCsv.addEventListener("click", exportCSV);
  dom.btnExportJson.addEventListener("click", exportJSON);
  dom.btnApplyFactor.addEventListener("click", () => applyFactorFromModal(hooks));
  dom.btnYAxis.addEventListener("click", syncYAxisModalFromState);
  dom.yAxisModal.addEventListener("shown.bs.modal", syncYAxisModalFromState);
  dom.yAxisModeLocal.addEventListener("change", updateYAxisManualInputsEnabled);
  dom.yAxisModeGlobal.addEventListener("change", updateYAxisManualInputsEnabled);
  dom.yAxisModeManual.addEventListener("change", updateYAxisManualInputsEnabled);
  dom.btnApplyYAxis.addEventListener("click", async () => {
    state.yAxisMode = selectedYAxisMode();
    const manualMin = Number.parseFloat(dom.yAxisManualMin.value);
    const manualMax = Number.parseFloat(dom.yAxisManualMax.value);
    state.yAxisManualMin = Number.isFinite(manualMin) ? manualMin : null;
    state.yAxisManualMax = Number.isFinite(manualMax) ? manualMax : null;
    if (state.yAxisMode === "global") {
      try {
        await ensureGlobalYAxisRange();
      } catch (_) {}
    }
    renderChart();
    hooks.onStateChanged();
  });

  dom.canvas.addEventListener("mousemove", showHover);
  dom.canvas.addEventListener("mouseleave", hideHover);

  dom.canvas.addEventListener("mousedown", (event) => {
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
      event.preventDefault();
      forceAbsoluteTimeModeFromCurrentRange();
      const center = timestampAtCanvasX(event.clientX);
      zoomAt(center, event.deltaY < 0 ? 0.8 : 1.25, () => {
        showZoomRangeBadge();
        hooks.loadData();
      });
    },
    { passive: false },
  );

  window.addEventListener("resize", () => {
    applyResponsiveSidebarMode();
    fitContentHeight();
    renderChart();
    renderCollapsedLegend();
    if (!dom.timePopup.classList.contains("d-none")) positionTimePopup();
  });

  dom.rangePresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
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
  state.timeMode = isRelative ? "relative" : "absolute";
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
  state.timeMode = "relative";
  const amount = Math.max(
    1,
    Number.parseInt(dom.relativeAmount.value, 10) || 1,
  );
  const unit = dom.relativeUnit.value || "h";
  const now = Date.now();
  state.from = relativeRangeStart(now, amount, unit);
  state.to = now;
  dom.fromInput.value = toLocalInput(new Date(state.from));
  dom.toInput.value = toLocalInput(new Date(state.to));
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
    applyRelativeRange();
    updateRangeButtonLabel();
    hooks.onStateChanged();
    return;
  }

  const tokens = presetTokenMap[preset];
  if (!tokens) return;
  const now = new Date();
  const from = evalPresetToken(tokens[0], now);
  const to = evalPresetToken(tokens[1], now);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return;
  }

  dom.fromInput.value = toLocalInput(from);
  dom.toInput.value = toLocalInput(to);
  state.from = from.getTime();
  state.to = to.getTime();
  switchTimeMode("absolute");
  updateRangeButtonLabel();
  hooks.onStateChanged();
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
    restoredFromUrl = applyStateFromUrl() || applyLegacyWebviewHashFallback();
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
  syncYAxisModalFromState();
  syncRenderModeButton();
  syncStackedModeButton();
  applyResponsiveSidebarMode();
  fitContentHeight();
  wireEvents();
  if (restoredFromUrl) setSidebarCollapsed(true);
  else if (!state.compactSidebarMode) setSidebarCollapsed(false);
  renderMetricList(hooks);
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
