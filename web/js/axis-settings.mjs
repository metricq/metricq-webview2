import { SI_PREFIXES, parseSIUnit } from "./si-units.mjs";

export function normalizeUnitOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [family, exp] of Object.entries(raw)) {
    if (parseSIUnit(family)?.family === family && SI_PREFIXES.some((p) => p.exp === exp)) result[family] = exp;
  }
  return result;
}

export function serializeYAxisSettings(state) {
  const units = normalizeUnitOverrides(state.yAxisUnits);
  const y = { m: state.yAxisMode };
  if (state.yAxisStacked) y.s = 1;
  if (state.yAxisScale === "symlog") y.scale = "symlog";
  if (Object.keys(units).length) y.units = units;
  if (y.m === "manual" && Number.isFinite(state.yAxisManualMin) && Number.isFinite(state.yAxisManualMax) && state.yAxisManualMin < state.yAxisManualMax) {
    y.min = state.yAxisManualMin;
    y.max = state.yAxisManualMax;
  }
  return y.m === "local" && Object.keys(y).length === 1 ? null : y;
}

export function applyYAxisSettings(state, y) {
  state.yAxisScale = y?.scale === "symlog" ? "symlog" : "linear";
  state.yAxisUnits = normalizeUnitOverrides(y?.units);
  state.yAxisMode = ["manual", "global"].includes(y?.m) ? y.m : "local";
  state.yAxisManualMin = state.yAxisMode === "manual" && typeof y?.min === "number" && Number.isFinite(y.min) ? y.min : null;
  state.yAxisManualMax = state.yAxisMode === "manual" && typeof y?.max === "number" && Number.isFinite(y.max) ? y.max : null;
}
