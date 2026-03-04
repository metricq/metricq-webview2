const DEFAULT_LOCALE = "de-DE";
let uiLocale = null;

export function getUiLocale() {
  if (uiLocale) return uiLocale;
  const docLocale = String(globalThis.document?.documentElement?.lang || "").trim();
  return docLocale || DEFAULT_LOCALE;
}

export function setUiLocale(locale) {
  const next = String(locale || "").trim();
  uiLocale = next || DEFAULT_LOCALE;
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.lang = uiLocale;
  }
}
