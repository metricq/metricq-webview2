export function wireMetricSearchField(options) {
  const wrapEl = options?.wrapEl || null;
  const groupEl = options?.groupEl || null;
  const inputEl = options?.inputEl || null;
  const resetEl = options?.resetEl || null;
  const prefixEl = options?.prefixEl || null;
  const onSearch = typeof options?.onSearch === "function" ? options.onSearch : (() => {});
  const debounceMs = Number.isFinite(options?.debounceMs) ? Math.max(0, Number(options.debounceMs)) : 220;
  const minLength = Number.isFinite(options?.minLength) ? Math.max(0, Number(options.minLength)) : 2;
  const focusOnReset = options?.focusOnReset !== false;

  if (!inputEl) {
    return {
      reset: () => {},
      setRegexMode: () => {},
      isRegexMode: () => false,
    };
  }

  let regexMode = false;
  let timer = null;

  const syncResetVisibility = () => {
    if (!resetEl) return;
    const hasValue = String(inputEl.value || "").trim().length > 0;
    resetEl.classList.toggle("is-visible", hasValue || regexMode);
  };

  const setRegexMode = (enabled) => {
    regexMode = Boolean(enabled);
    wrapEl?.classList.toggle("regex-mode", regexMode);
    groupEl?.classList.toggle("input-group", regexMode);
    groupEl?.classList.toggle("input-group-sm", regexMode);
    prefixEl?.classList.toggle("d-none", !regexMode);
    syncResetVisibility();
  };

  const runSearch = () => {
    const query = String(inputEl.value || "").trim();
    const mode = regexMode ? "selector" : "infix";
    if (query.length < minLength) {
      void onSearch("", mode);
      return;
    }
    void onSearch(query, mode);
  };

  const scheduleSearch = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(runSearch, debounceMs);
  };

  const handleInput = () => {
    const current = String(inputEl.value || "");
    if (!regexMode && current.startsWith("/")) {
      setRegexMode(true);
      inputEl.value = current.slice(1);
    }
    syncResetVisibility();
    scheduleSearch();
  };

  const handleKeyDown = (event) => {
    if (!regexMode) return;
    if (event.key !== "Backspace") return;
    if (String(inputEl.value || "").length !== 0) return;
    setRegexMode(false);
    scheduleSearch();
  };

  const handleReset = (focus = false) => {
    inputEl.value = "";
    setRegexMode(false);
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    void onSearch("", "infix");
    if (focus) inputEl.focus();
  };

  inputEl.addEventListener("input", handleInput);
  inputEl.addEventListener("keydown", handleKeyDown);
  resetEl?.addEventListener("click", () => handleReset(focusOnReset));

  setRegexMode(false);
  syncResetVisibility();

  return {
    reset: () => handleReset(false),
    setRegexMode,
    isRegexMode: () => regexMode,
  };
}
