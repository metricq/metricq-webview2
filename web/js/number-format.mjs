import { getUiLocale } from "./locale.mjs";

export function parseLocalizedNumber(input, fallback = NaN, locale = getUiLocale()) {
  if (typeof input === "number") return Number.isFinite(input) ? input : fallback;
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;
  const compact = raw.replace(/\s+/g, "").replace(/\u00A0/g, "").replace(/'/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;
  let normalized = compact;
  if (hasComma && hasDot) {
    if (lastComma > lastDot) normalized = compact.replace(/\./g, "").replace(",", ".");
    else normalized = compact.replace(/,/g, "");
  } else if (hasComma) {
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && String(locale).toLowerCase().startsWith("de")) {
    // accept dot decimals in de input to keep UX forgiving
    normalized = compact;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatNumber(value, options = {}, locale = getUiLocale()) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString(locale, options);
}

export function formatInteger(value, locale = getUiLocale()) {
  return formatNumber(value, { maximumFractionDigits: 0 }, locale);
}

export function formatFixed(value, fractionDigits = 3, locale = getUiLocale()) {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }, locale);
}

export function formatCompact(value, maxFractionDigits = 6, locale = getUiLocale()) {
  return formatNumber(value, {
    maximumSignificantDigits: maxFractionDigits + 1,
    maximumFractionDigits: maxFractionDigits,
  }, locale);
}

export function formatDecimalInput(value, maxFractionDigits = 12, locale = getUiLocale()) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString(locale, {
    useGrouping: false,
    maximumFractionDigits: maxFractionDigits,
  });
}
