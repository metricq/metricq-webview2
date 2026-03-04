import { parseLocalizedNumber } from "./number-format.mjs";

export function sanitizeFactor(value, fallback = 1) {
  const parsed = parseLocalizedNumber(value, fallback);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed === 0) return 1;
  return parsed;
}
