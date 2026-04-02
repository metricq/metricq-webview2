export function wireMetricSearchField(options) {
  const wrapEl = options?.wrapEl || null;
  const groupEl = options?.groupEl || null;
  const inputEl = options?.inputEl || null;
  const resetEl = options?.resetEl || null;
  const prefixEl = options?.prefixEl || null;
  const onSearch =
    typeof options?.onSearch === "function" ? options.onSearch : () => {};
  const debounceMs = Number.isFinite(options?.debounceMs)
    ? Math.max(0, Number(options.debounceMs))
    : 220;
  const minLength = Number.isFinite(options?.minLength)
    ? Math.max(0, Number(options.minLength))
    : 2;
  const focusOnReset = options?.focusOnReset !== false;

  if (!inputEl) {
    return {
      reset: () => {},
      setRegexMode: () => {},
      isRegexMode: () => false,
    };
  }

  let mode = "infix";
  let timer = null;

  const syncResetVisibility = () => {
    if (!resetEl) return;
    const hasValue = String(inputEl.value || "").trim().length > 0;
    resetEl.classList.toggle("is-visible", hasValue || mode !== "infix");
  };

  const syncModeUi = () => {
    const specialMode = mode !== "infix";
    wrapEl?.classList.toggle("mode-selector", mode === "selector");
    wrapEl?.classList.toggle("mode-description", mode === "description");
    groupEl?.classList.toggle("input-group", specialMode);
    groupEl?.classList.toggle("input-group-sm", specialMode);
    prefixEl?.classList.toggle("d-none", !specialMode);
    if (prefixEl) {
      prefixEl.title =
        mode === "selector"
          ? "Regex-Suche aktiv"
          : mode === "description"
            ? "Beschreibungs-Suche aktiv"
            : "";
      prefixEl.setAttribute(
        "aria-label",
        mode === "selector"
          ? "Regex-Suche aktiv"
          : mode === "description"
            ? "Beschreibungs-Suche aktiv"
            : "",
      );
      prefixEl.innerHTML =
        mode === "selector"
          ? `<i class="bi bi-regex"></i>`
          : mode === "description"
            ? `?`
            : "";
    }
    syncResetVisibility();
    options?.onModeChange?.(mode);
  };

  const setMode = (nextMode) => {
    mode =
      nextMode === "selector" || nextMode === "description"
        ? nextMode
        : "infix";
    syncModeUi();
  };

  const runSearch = () => {
    const query = String(inputEl.value || "").trim();
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
    if (mode === "infix" && current.startsWith("/")) {
      setMode("selector");
      inputEl.value = current.slice(1);
    } else if (mode === "infix" && current.startsWith("?")) {
      setMode("description");
      inputEl.value = current.slice(1);
    }
    syncResetVisibility();
    scheduleSearch();
  };

  const handleKeyDown = (event) => {
    if (mode === "infix") return;
    if (event.key !== "Backspace") return;
    if (String(inputEl.value || "").length !== 0) return;
    setMode("infix");
    scheduleSearch();
  };

  const handleReset = (focus = false) => {
    inputEl.value = "";
    setMode("infix");
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    void onSearch("", "infix");
    if (focus) inputEl.focus();
  };

  const handleFocus = () => options?.onFocusChange?.(true, mode);
  const handleBlur = () => options?.onFocusChange?.(false, mode);

  inputEl.addEventListener("input", handleInput);
  inputEl.addEventListener("keydown", handleKeyDown);
  inputEl.addEventListener("focus", handleFocus);
  inputEl.addEventListener("blur", handleBlur);
  resetEl?.addEventListener("click", () => handleReset(focusOnReset));

  setMode("infix");
  syncResetVisibility();

  return {
    reset: () => handleReset(false),
    setRegexMode: (enabled) => setMode(enabled ? "selector" : "infix"),
    setMode,
    isRegexMode: () => mode === "selector",
    getMode: () => mode,
  };
}
