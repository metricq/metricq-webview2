export const state = {
  metrics: [],
  series: new Map(),
  from: 0,
  to: 0,
  loadedFrom: null,
  loadedTo: null,
  loadedMetricsKey: "",
  dataLoadError: "",
  yAxisMode: "local",
  yAxisManualMin: null,
  yAxisManualMax: null,
  yAxisGlobalMin: null,
  yAxisGlobalMax: null,
  yAxisGlobalMetricsKey: "",
  yAxisCurrentMin: null,
  yAxisCurrentMax: null,
  yAxisStacked: false,
  stackedAligned: null,
  timeMode: "relative",
  renderMode: "standard",
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

export function metricDisplayName(metric) {
  const alias = String(metric?.alias || "").trim();
  const expr = String(metric?.expr || "").trim();
  if (!expr && alias) return alias;
  return String(metric?.name || "");
}
