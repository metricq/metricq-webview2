import { normalizeSIUnit } from "./units.mjs";

export const SI_PREFIXES = [
  { exp: -9, prefix: "n" },
  { exp: -6, prefix: "u" },
  { exp: -3, prefix: "m" },
  { exp: 0, prefix: "" },
  { exp: 3, prefix: "k" },
  { exp: 6, prefix: "M" },
  { exp: 9, prefix: "G" },
];

const BASE_UNITS = ["W", "Wh", "V", "A", "VA", "Pa", "Hz", "B"];

const UNIT_TABLE = (() => {
  const map = new Map();
  for (const base of BASE_UNITS) {
    for (const entry of SI_PREFIXES) {
      map.set(`${entry.prefix}${base}`, { family: base, exp: entry.exp });
    }
  }
  return map;
})();

export function parseSIUnit(unit) {
  const normalized = normalizeSIUnit(unit);
  if (!normalized) return null;
  return UNIT_TABLE.get(normalized) || null;
}

export function formatSIUnit(family, exp) {
  const prefix = SI_PREFIXES.find((entry) => entry.exp === exp)?.prefix;
  if (prefix == null) return family;
  return `${prefix}${family}`;
}
