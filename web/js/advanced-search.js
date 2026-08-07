import { apiFetch } from "./api.js";
import { dom } from "./dom.js";
import { metricByName } from "./model.js";

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 100;

const DISPLAY_METADATA_KEYS = [
  "site",
  "room",
  "rack",
  "feed",
  "asset_type",
  "asset_id",
  "location_code",
  "metric_type",
  "circuit",
  "phase",
  "source",
  "cluster",
  "system",
  "service",
  "team",
  "criticality",
  "scope",
  "position",
];

const MODE_HINTS = {
  infix: "Substring-Suche im Metriknamen",
  selector: "Regulärer Ausdruck auf Metriknamen",
  description: "Volltextsuche in der Beschreibung",
  metadata: "Nach Metadaten-Feldern filtern",
};

let currentMode = "infix";
let searchTimer = null;
let results = [];
let selectedNames = new Set();
let metaFilters = {};
let suggestableFields = null;
let addMetricFn = null;

function syncSearchModePrefix(mode) {
  const prefixEl = dom.advSearchModePrefix;
  if (!prefixEl) return;
  dom.advSearchInputGroup?.classList.toggle("mode-selector", mode === "selector");
  dom.advSearchInputGroup?.classList.toggle("mode-description", mode === "description");

  if (mode === "selector") {
    prefixEl.title = "Regex-Suche aktiv";
    prefixEl.setAttribute("aria-label", "Regex-Suche aktiv");
    prefixEl.innerHTML = `<i class="bi bi-regex"></i>`;
    return;
  }

  if (mode === "description") {
    prefixEl.title = "Beschreibungs-Suche aktiv";
    prefixEl.setAttribute("aria-label", "Beschreibungs-Suche aktiv");
    prefixEl.innerHTML = `?`;
    return;
  }

  prefixEl.title = "";
  prefixEl.setAttribute("aria-label", "");
  prefixEl.innerHTML = "⌕";
}

export function wireAdvancedSearch(hooks) {
  addMetricFn = hooks.addMetric;

  const modeTabs = [
    dom.advSearchModeInfix,
    dom.advSearchModeRegex,
    dom.advSearchModeDesc,
    dom.advSearchModeMeta,
  ];

  for (const tab of modeTabs) {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      setMode(mode);
      for (const t of modeTabs) t.classList.toggle("active", t === tab);
    });
  }

  dom.advSearchInput.addEventListener("input", scheduleSearch);
  dom.advSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });

  dom.advMetaFieldSelect.addEventListener("change", onFieldSelected);
  dom.advMetaValueSelect.addEventListener("change", syncAddFilterButton);
  dom.advMetaAddFilter.addEventListener("click", addMetaFilter);

  dom.advSearchAddSelected.addEventListener("click", addSelectedMetrics);
  dom.advSearchAddAll.addEventListener("click", addAllMetrics);

  dom.advancedSearchModal.addEventListener("shown.bs.modal", () => {
    if (currentMode !== "metadata") {
      dom.advSearchInput.focus();
    }
    if (!suggestableFields) {
      loadSuggestableFields();
    }
  });

  dom.advancedSearchModal.addEventListener("hidden.bs.modal", () => {
    // Keep state so the user can reopen and continue.
  });

  syncSearchModePrefix(currentMode);
  showEmptyState();
}

function setMode(mode) {
  currentMode = mode;
  const isMeta = mode === "metadata";
  dom.advSearchTextPanel.classList.toggle("d-none", isMeta);
  dom.advSearchMetaPanel.classList.toggle("d-none", !isMeta);
  dom.advSearchTextHint.textContent = MODE_HINTS[mode] || "";
  syncSearchModePrefix(mode);

  if (!isMeta) {
    dom.advSearchInput.focus();
  } else {
    if (!suggestableFields) loadSuggestableFields();
  }

  runSearch();
}

function scheduleSearch() {
  if (searchTimer != null) clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, DEBOUNCE_MS);
}

async function runSearch() {
  if (searchTimer != null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }

  if (currentMode === "metadata") {
    await runMetadataSearch();
    return;
  }

  const query = String(dom.advSearchInput.value || "").trim();
  if (query.length < 2) {
    results = [];
    selectedNames.clear();
    renderResults();
    return;
  }

  showSpinner();

  try {
    const body = await apiFetch("/api/metrics/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        mode: currentMode,
        limit: RESULT_LIMIT,
      }),
    });
    results = body.metrics || [];
    selectedNames.clear();
    renderResults();
  } catch (err) {
    results = [];
    renderResults();
  }
}

async function runMetadataSearch() {
  if (Object.keys(metaFilters).length === 0) {
    results = [];
    selectedNames.clear();
    renderResults();
    return;
  }

  showSpinner();

  try {
    const body = await apiFetch("/api/metrics/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "",
        mode: "metadata",
        filter: metaFilters,
        limit: RESULT_LIMIT,
      }),
    });
    results = body.metrics || [];
    selectedNames.clear();
    renderResults();
  } catch (err) {
    results = [];
    renderResults();
  }
}

function showSpinner() {
  dom.advSearchResults.innerHTML = "";
  dom.advSearchEmpty.classList.add("d-none");
  dom.advSearchSpinner.classList.remove("d-none");
  dom.advSearchResultCount.textContent = "Suche läuft...";
  dom.advSearchAddSelected.disabled = true;
  dom.advSearchAddAll.disabled = true;
}

function showEmptyState() {
  dom.advSearchResults.innerHTML = "";
  dom.advSearchSpinner.classList.add("d-none");
  dom.advSearchEmpty.classList.remove("d-none");
  dom.advSearchResultCount.textContent = "Keine Ergebnisse";
  dom.advSearchAddSelected.disabled = true;
  dom.advSearchAddAll.disabled = true;
}

function renderResults() {
  dom.advSearchSpinner.classList.add("d-none");
  dom.advSearchResults.innerHTML = "";

  if (results.length === 0) {
    showEmptyState();
    return;
  }

  dom.advSearchEmpty.classList.add("d-none");
  const addable = results.filter((m) => !metricByName(m.name));
  dom.advSearchResultCount.textContent = `${results.length} Ergebnis${results.length !== 1 ? "se" : ""}`;
  dom.advSearchAddAll.disabled = addable.length === 0;

  for (const metric of results) {
    const alreadyAdded = !!metricByName(metric.name);
    const item = document.createElement("label");
    item.className =
      "adv-result-item" +
      (alreadyAdded ? " adv-result-already-added" : "") +
      (selectedNames.has(metric.name) ? " adv-result-selected" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "form-check-input adv-result-check";
    checkbox.checked = selectedNames.has(metric.name);
    checkbox.disabled = alreadyAdded;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedNames.add(metric.name);
      } else {
        selectedNames.delete(metric.name);
      }
      item.classList.toggle("adv-result-selected", checkbox.checked);
      syncSelectedButton();
    });

    const body = document.createElement("div");
    body.className = "adv-result-body";

    const nameEl = document.createElement("div");
    nameEl.className = "adv-result-name";
    nameEl.textContent = metric.name;
    body.appendChild(nameEl);

    if (metric.description) {
      const descEl = document.createElement("div");
      descEl.className = "adv-result-desc";
      descEl.textContent = metric.description;
      descEl.title = metric.description;
      body.appendChild(descEl);
    }

    const metaBadges = buildMetaBadges(metric.metadata);
    if (metaBadges) {
      body.appendChild(metaBadges);
    }

    const trailing = document.createElement("div");
    trailing.className = "adv-result-trailing";

    const renderAddedBadge = () => {
      trailing.innerHTML = "";
      const badge = document.createElement("span");
      badge.className = "adv-result-added-badge";
      badge.textContent = "✓ Hinzugefügt";
      trailing.appendChild(badge);
    };

    const renderAddButton = () => {
      trailing.innerHTML = "";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn btn-sm btn-outline-primary adv-result-add-btn";
      addBtn.innerHTML = '<i class="bi bi-plus-lg"></i>';
      addBtn.title = "Metrik übernehmen";
      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!addMetricFn || metricByName(metric.name)) return;
        addMetricFn(metric.name);
        item.classList.add("adv-result-already-added");
        checkbox.disabled = true;
        checkbox.checked = false;
        selectedNames.delete(metric.name);
        renderAddedBadge();
        syncSelectedButton();
      });
      trailing.appendChild(addBtn);
    };

    if (alreadyAdded) renderAddedBadge();
    else renderAddButton();

    item.append(checkbox, body, trailing);
    dom.advSearchResults.appendChild(item);
  }
  syncSelectedButton();
}

function buildMetaBadges(metadata) {
  if (!metadata) return null;
  const entries = [];
  for (const key of DISPLAY_METADATA_KEYS) {
    const val = metadata[key];
    if (val == null || val === "") continue;
    entries.push({ key, val: String(val) });
  }
  if (entries.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "adv-result-meta";
  for (const { key, val } of entries) {
    const badge = document.createElement("span");
    badge.className = "adv-meta-badge";
    badge.innerHTML = `<span class="adv-meta-key">${escHtml(key)}</span>: ${escHtml(val)}`;
    wrap.appendChild(badge);
  }
  return wrap;
}

function escHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function syncSelectedButton() {
  const count = selectedNames.size;
  dom.advSearchAddSelected.disabled = count === 0;
  dom.advSearchAddSelected.textContent =
    count > 0
      ? `Ausgewählte übernehmen (${count})`
      : "Ausgewählte übernehmen";
}

function addSelectedMetrics() {
  if (!addMetricFn) return;
  for (const name of selectedNames) {
    if (!metricByName(name)) {
      addMetricFn(name);
    }
  }
  selectedNames.clear();
  renderResults();
}

function addAllMetrics() {
  if (!addMetricFn) return;
  for (const metric of results) {
    if (!metricByName(metric.name)) {
      addMetricFn(metric.name);
    }
  }
  selectedNames.clear();
  renderResults();
}

// ── Metadata filter logic ──

async function loadSuggestableFields() {
  try {
    const body = await apiFetch("/api/metrics/suggest-fields");
    suggestableFields = body.fields || [];
    populateFieldSelect();
  } catch (_) {
    suggestableFields = [];
  }
}

function populateFieldSelect() {
  dom.advMetaFieldSelect.innerHTML = '<option value="">Feld wählen...</option>';
  for (const field of suggestableFields || []) {
    if (metaFilters[field] !== undefined) continue;
    const opt = document.createElement("option");
    opt.value = field;
    opt.textContent = field;
    dom.advMetaFieldSelect.appendChild(opt);
  }
}

async function onFieldSelected() {
  const field = dom.advMetaFieldSelect.value;
  dom.advMetaValueSelect.innerHTML = '<option value="">Wert wählen...</option>';
  dom.advMetaValueSelect.disabled = true;
  dom.advMetaAddFilter.disabled = true;

  if (!field) return;

  try {
    const filterParam =
      Object.keys(metaFilters).length > 0 ? metaFilters : undefined;
    const qs = new URLSearchParams({ field, limit: "200" });
    if (filterParam) qs.set("filter", JSON.stringify(filterParam));

    const body = await apiFetch(`/api/metrics/suggest?${qs}`);
    const values = body.values || [];

    dom.advMetaValueSelect.innerHTML =
      '<option value="">Wert wählen...</option>';
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v.value;
      opt.textContent = `${v.value} (${v.count})`;
      dom.advMetaValueSelect.appendChild(opt);
    }
    dom.advMetaValueSelect.disabled = false;
  } catch (_) {
    dom.advMetaValueSelect.disabled = true;
  }
}

function syncAddFilterButton() {
  dom.advMetaAddFilter.disabled =
    !dom.advMetaFieldSelect.value || !dom.advMetaValueSelect.value;
}

function addMetaFilter() {
  const field = dom.advMetaFieldSelect.value;
  const value = dom.advMetaValueSelect.value;
  if (!field || !value) return;

  if (metaFilters[field]) {
    if (!Array.isArray(metaFilters[field])) {
      metaFilters[field] = [metaFilters[field]];
    }
    if (!metaFilters[field].includes(value)) {
      metaFilters[field].push(value);
    }
  } else {
    metaFilters[field] = value;
  }

  renderMetaFilterTags();
  populateFieldSelect();
  dom.advMetaFieldSelect.value = "";
  dom.advMetaValueSelect.innerHTML = '<option value="">Wert wählen...</option>';
  dom.advMetaValueSelect.disabled = true;
  dom.advMetaAddFilter.disabled = true;

  runMetadataSearch();
}

function removeMetaFilter(field, value) {
  if (Array.isArray(metaFilters[field])) {
    metaFilters[field] = metaFilters[field].filter((v) => v !== value);
    if (metaFilters[field].length === 1) {
      metaFilters[field] = metaFilters[field][0];
    } else if (metaFilters[field].length === 0) {
      delete metaFilters[field];
    }
  } else {
    delete metaFilters[field];
  }

  renderMetaFilterTags();
  populateFieldSelect();
  runMetadataSearch();
}

function renderMetaFilterTags() {
  dom.advMetaFilters.innerHTML = "";
  for (const [field, val] of Object.entries(metaFilters)) {
    const values = Array.isArray(val) ? val : [val];
    for (const v of values) {
      const tag = document.createElement("span");
      tag.className = "adv-meta-filter-tag";
      tag.innerHTML = `<strong>${escHtml(field)}</strong>: ${escHtml(v)}`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.innerHTML = '<i class="bi bi-x"></i>';
      removeBtn.title = "Filter entfernen";
      removeBtn.addEventListener("click", () => removeMetaFilter(field, v));
      tag.appendChild(removeBtn);
      dom.advMetaFilters.appendChild(tag);
    }
  }
}
