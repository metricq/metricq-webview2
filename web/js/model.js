export const state = {
  metrics: [],
  series: new Map(),
  from: 0,
  to: 0,
  loadedFrom: null,
  loadedTo: null,
  loadedMetricsKey: "",
  dataLoadError: "",
  dataLoadErrorKind: "",
  yAxisMode: "local",
  yAxisScale: "linear",
  yAxisUnits: {},
  yAxisManualMin: null,
  yAxisManualMax: null,
  yAxisGlobalMin: null,
  yAxisGlobalMax: null,
  yAxisGlobalMetricsKey: "",
  yAxis2GlobalMin: null,
  yAxis2GlobalMax: null,
  yAxis2GlobalMetricsKey: "",
  yAxisCurrentMin: null,
  yAxisCurrentMax: null,
  yAxisStacked: false,
  stackedAligned: null,
  timeMode: "relative",
  renderMode: "standard",
  metricRenderMode: "bands",
  legacyChartsBaseUrl: "",
  resolution: 2,
  maxPoints: 3000,
  sidebarCollapsed: false,
  compactSidebarMode: false,
  helpOverlayForced: false,
  helpOverlayMinimizeDeferred: false,
  helpOverlayMinimizeActive: false,
  interactionMode: "",
  isPanning: false,
  panStartX: 0,
  panRangeStart: 0,
  panRangeEnd: 0,
  pinchStartDistance: 0,
  pinchRangeStart: 0,
  pinchRangeEnd: 0,
  pinchCenterMs: 0,
  penPointerId: null,
  penStartX: 0,
  penStartY: 0,
  dragStartX: 0,
  dragCurrentX: 0,
};

export const colors = [
  "#2643e9", "#00897b", "#c62828", "#7b1fa2", "#f57c00",
  "#0277bd", "#558b2f", "#6d4c41", "#00695c", "#8e24aa",
];

export function metricByName(name) {
  return state.metrics.find((m) => m.name === name);
}

// A second y-axis only exists while visible metrics sit on both axes;
// otherwise everything is drawn against the primary axis.
export function secondaryAxisActive() {
  let primary = false;
  let secondary = false;
  for (const metric of state.metrics) {
    if (!metric.draw) continue;
    if (metric.axis === 1) secondary = true;
    else primary = true;
  }
  return primary && secondary;
}

export function metricAxis(metric) {
  return metric?.axis === 1 && secondaryAxisActive() ? 1 : 0;
}

export function syncYAxisStackedState() {
  state.yAxisStacked = state.metrics.some(
    (metric) => metric.stackMode !== "normal",
  );
  return state.yAxisStacked;
}

export function metricDisplayName(metric) {
  const alias = String(metric?.alias || "").trim();
  const expr = String(metric?.expr || "").trim();
  if (!expr && alias) return alias;
  return String(metric?.name || "");
}

export function normalizeMetricRenderMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "line" || mode === "count") return mode;
  return "bands";
}

export function metricShownUnit(metric) {
  if (state.metricRenderMode === "count") return "Hz";
  return String(metric?.displayUnit || metric?.unit || "").trim();
}

export function metricRenderShowsBands() {
  return state.metricRenderMode === "bands";
}

export function metricRenderShowsCounts() {
  return state.metricRenderMode === "count";
}

export function yAxisStackingActive() {
  return state.yAxisStacked && !metricRenderShowsCounts();
}
