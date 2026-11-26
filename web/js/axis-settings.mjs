import { SI_PREFIXES, parseSIUnit } from "./si-units.mjs";

export function normalizeUnitOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [family, exp] of Object.entries(raw)) {
    if (parseSIUnit(family)?.family === family && SI_PREFIXES.some((p) => p.exp === exp)) result[family] = exp;
  }
  return result;
}

const AXIS_PREFIXES = ["yAxis", "yAxis2"];

function serializeAxisBlock(state, prefix) {
  const mode = state[`${prefix}Mode`] ?? "local";
  const b = { m: mode };
  if (state[`${prefix}Scale`] === "symlog") b.scale = "symlog";
  const min = state[`${prefix}ManualMin`];
  const max = state[`${prefix}ManualMax`];
  if (mode === "manual" && Number.isFinite(min) && Number.isFinite(max) && min < max) {
    b.min = min;
    b.max = max;
  }
  return b;
}

function applyAxisBlock(state, prefix, y) {
  state[`${prefix}Scale`] = y?.scale === "symlog" ? "symlog" : "linear";
  const mode = ["manual", "global"].includes(y?.m) ? y.m : "local";
  state[`${prefix}Mode`] = mode;
  const valid = (v) => mode === "manual" && typeof v === "number" && Number.isFinite(v) ? v : null;
  state[`${prefix}ManualMin`] = valid(y?.min);
  state[`${prefix}ManualMax`] = valid(y?.max);
}

export function serializeYAxisSettings(state) {
  const units = normalizeUnitOverrides(state.yAxisUnits);
  const y = serializeAxisBlock(state, AXIS_PREFIXES[0]);
  if (state.yAxisStacked) y.s = 1;
  if (Object.keys(units).length) y.units = units;
  // Secondary axis settings are stored compactly and only when non-default.
  const y2 = serializeAxisBlock(state, AXIS_PREFIXES[1]);
  if (y2.m === "local") delete y2.m;
  if (Object.keys(y2).length) y.y2 = y2;
  return y.m === "local" && Object.keys(y).length === 1 ? null : y;
}

export function applyYAxisSettings(state, y) {
  applyAxisBlock(state, AXIS_PREFIXES[0], y);
  applyAxisBlock(state, AXIS_PREFIXES[1], y?.y2);
  state.yAxisUnits = normalizeUnitOverrides(y?.units);
}
