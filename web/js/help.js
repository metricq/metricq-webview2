import { startHelpOverlayMinimize } from "./chart.js";
import { dom } from "./dom.js";
import { state } from "./model.js";

function animateCoachToTarget(fromEl, targetEl) {
  if (!targetEl) return Promise.resolve();
  const targetRect = targetEl.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0) return Promise.resolve();

  targetEl.classList.add("coach-highlight-target");

  const ring = document.createElement("div");
  ring.className = "coach-highlight-ring";
  ring.style.left = `${Math.round(targetRect.left - 6)}px`;
  ring.style.top = `${Math.round(targetRect.top - 6)}px`;
  ring.style.width = `${Math.round(targetRect.width + 12)}px`;
  ring.style.height = `${Math.round(targetRect.height + 12)}px`;
  document.body.appendChild(ring);

  let dot = null;
  if (fromEl) {
    const fromRect = fromEl.getBoundingClientRect();
    const x1 = fromRect.left + fromRect.width / 2;
    const y1 = fromRect.top + fromRect.height / 2;
    const x2 = targetRect.left + targetRect.width / 2;
    const y2 = targetRect.top + targetRect.height / 2;
    dot = document.createElement("div");
    dot.className = "coach-guide-dot";
    dot.style.left = `${Math.round(x1)}px`;
    dot.style.top = `${Math.round(y1)}px`;
    document.body.appendChild(dot);
    dot.animate(
      [
        { transform: "translate(0px, 0px) scale(1)", opacity: 0.9 },
        {
          transform: `translate(${Math.round(x2 - x1)}px, ${Math.round(y2 - y1)}px) scale(0.8)`,
          opacity: 0.25,
        },
      ],
      { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" },
    );
  }

  return new Promise((resolve) => {
    window.setTimeout(() => {
      targetEl.classList.remove("coach-highlight-target");
      ring.remove();
      dot?.remove();
      resolve();
    }, 900);
  });
}

function firstMetricToggleButton() {
  return (
    dom.metricList?.querySelector(
      "li.metric-draggable-row button[data-action='toggle']",
    ) || null
  );
}

function firstMetricColorButton() {
  return (
    dom.metricList?.querySelector(
      "li.metric-draggable-row .metric-color-button",
    ) || null
  );
}

function helpActionButton(
  action,
  label,
  icon,
  tone = "outline-secondary",
  disabled = false,
) {
  const disabledAttr = disabled ? " disabled" : "";
  return `<button class="btn btn-${tone} btn-sm" type="button" data-help-action="${action}"${disabledAttr}><i class="bi ${icon} me-1"></i>${label}</button>`;
}

export function createHelpModule({
  setSidebarCollapsed,
  toggleTimePopup,
  renderChart,
}) {
  function renderContextualHelp() {
    if (!dom.chartHelpSections || !dom.chartHelpTitle || !dom.chartHelpSubtitle)
      return;
    const metricCount = state.metrics.length;
    const hasMetrics = metricCount > 0;
    const hasMultipleMetrics = metricCount > 1;
    const sidebarOpen = !state.sidebarCollapsed;
    const metricSearchFocused = document.activeElement === dom.metricSearch;
    const metricSearchMode = dom.metricSearchWrap?.classList.contains(
      "mode-selector",
    )
      ? "Regex"
      : dom.metricSearchWrap?.classList.contains("mode-description")
        ? "Beschreibung"
        : "Metrikname";
    if (dom.btnEmptyHideHelp)
      dom.btnEmptyHideHelp.classList.toggle("d-none", !hasMetrics);

    if (metricSearchFocused) {
      dom.chartHelpTitle.textContent = "Suchmodi";
      dom.chartHelpSubtitle.innerHTML = `
        <strong>Aktuell:</strong> ${metricSearchMode}. Mit <code>/</code> aktivierst du Regex, mit <code>?</code> die Suche in Descriptions.
      `;
      dom.chartHelpSections.innerHTML = [
        `<div class="small text-muted">Metrikname: normal tippen, sucht im Namen.</div>`,
        `<div class="small text-muted">Regex: <code>/</code> tippen, dann Muster eingeben.</div>`,
        `<div class="small text-muted">Beschreibung: <code>?</code> tippen, dann Text aus der Description suchen.</div>`,
        `<div class="small text-muted">Zurück zum Standardmodus: Feld leeren und <code>Backspace</code>.</div>`,
      ].join("");
      return;
    }

    dom.chartHelpTitle.textContent = hasMetrics
      ? "Metriken vorhanden: nächste Schritte"
      : "Noch keine Metriken ausgewählt";
    dom.chartHelpSubtitle.textContent = hasMetrics
      ? "Nur die aktuell passenden Aktionen."
      : "Starte mit einer Metrik oder lege eine berechnete Metrik an.";

    const actions = [];
    if (!hasMetrics) {
      actions.push(
        helpActionButton(
          "focus_metric_search",
          hasMetrics ? "Weitere Metrik suchen" : "Metrik suchen",
          "bi-search",
          "primary",
        ),
      );
      actions.push(
        helpActionButton(
          "open_advanced_search",
          "Erweiterte Suche",
          "bi-funnel",
          "outline-primary",
        ),
      );
      actions.push(
        helpActionButton(
          "open_expression",
          "Berechnete Metrik",
          "bi-plus-lg",
          "outline-primary",
        ),
      );
    }

    if (!hasMetrics) {
      if (sidebarOpen)
        actions.push(
          helpActionButton(
            "close_sidebar",
            "Sidebar schließen",
            "bi-layout-sidebar-inset-reverse",
            "secondary",
          ),
        );
      else
        actions.push(
          helpActionButton(
            "open_sidebar",
            "Sidebar öffnen",
            "bi-layout-sidebar-inset",
          ),
        );
      dom.chartHelpSections.innerHTML = actions.join("");
      return;
    }

    if (sidebarOpen) {
      if (hasMultipleMetrics) {
        actions.push(
          helpActionButton("hide_all", "Alle ausblenden", "bi-eye-slash"),
        );
        actions.push(helpActionButton("show_all", "Alle zeigen", "bi-eye"));
        actions.push(
          helpActionButton("recolor_classic", "Klassisch färben", "bi-brush"),
        );
        actions.push(
          helpActionButton("recolor_random", "Neu färben", "bi-palette"),
        );
      } else {
        actions.push(
          helpActionButton(
            "toggle_first_metric",
            "Metrik Ein/Ausblenden",
            "bi-toggles",
            "outline-primary",
          ),
        );
        actions.push(
          helpActionButton(
            "first_metric_color",
            "Farbe wählen",
            "bi-circle-fill",
            "outline-primary",
          ),
        );
      }
      actions.push(
        helpActionButton(
          "close_sidebar",
          "Sidebar schließen",
          "bi-layout-sidebar-inset-reverse",
          "secondary",
        ),
      );
    } else {
      actions.push(
        helpActionButton(
          "open_y_axis",
          "Y-Achse",
          "bi-arrows-vertical",
          "outline-primary",
        ),
      );
      actions.push(
        helpActionButton(
          "open_time_range",
          "Zeitraum wählen",
          "bi-clock-history",
          "outline-primary",
        ),
      );
      actions.push(
        helpActionButton(
          "open_sidebar",
          "Sidebar öffnen",
          "bi-layout-sidebar-inset",
        ),
      );
    }

    dom.chartHelpSections.innerHTML = actions.join("");
  }

  async function runHelpAction(action, sourceEl) {
    const ensureSidebarOpen = () => {
      if (!state.sidebarCollapsed) return;
      setSidebarCollapsed(false);
    };

    if (action === "focus_metric_search") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.metricSearch);
      dom.metricSearch?.focus();
      return;
    }
    if (action === "open_expression") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.btnAddExpressionMetric);
      dom.btnAddExpressionMetric?.click();
      return;
    }
    if (action === "open_advanced_search") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.btnAdvancedSearch);
      dom.btnAdvancedSearch?.click();
      return;
    }
    if (action === "close_sidebar") {
      if (!state.sidebarCollapsed) {
        await animateCoachToTarget(sourceEl, dom.btnSidebarToggle);
        dom.btnSidebarToggle?.click();
      }
      return;
    }
    if (action === "open_sidebar") {
      if (state.sidebarCollapsed) {
        await animateCoachToTarget(sourceEl, dom.btnSidebarToggle);
        dom.btnSidebarToggle?.click();
      }
      return;
    }
    if (action === "hide_all") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.btnHideAll);
      dom.btnHideAll?.click();
      return;
    }
    if (action === "show_all") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.btnShowAll);
      dom.btnShowAll?.click();
      return;
    }
    if (action === "toggle_first_metric") {
      ensureSidebarOpen();
      const target = firstMetricToggleButton();
      await animateCoachToTarget(sourceEl, target);
      target?.click();
      return;
    }
    if (action === "recolor_classic") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.btnRecolorClassic);
      dom.btnRecolorClassic?.click();
      return;
    }
    if (action === "recolor_random") {
      ensureSidebarOpen();
      await animateCoachToTarget(sourceEl, dom.btnRecolor);
      dom.btnRecolor?.click();
      return;
    }
    if (action === "first_metric_color") {
      ensureSidebarOpen();
      const target = firstMetricColorButton();
      await animateCoachToTarget(sourceEl, target);
      target?.click();
      return;
    }
    if (action === "open_y_axis") {
      await animateCoachToTarget(sourceEl, dom.btnYAxis);
      dom.btnYAxis?.click();
      return;
    }
    if (action === "open_time_range") {
      await animateCoachToTarget(sourceEl, dom.btnTimeRange);
      toggleTimePopup();
    }
  }

  function wireHelpEvents() {
    dom.btnHelpOverlayToggle?.addEventListener("click", () => {
      state.helpOverlayForced = true;
      state.helpOverlayMinimizeDeferred = false;
      state.helpOverlayMinimizeActive = false;
      renderContextualHelp();
      renderChart();
    });
    dom.btnEmptyHideHelp?.addEventListener("click", () => {
      startHelpOverlayMinimize(1900);
    });
    dom.chartEmptyState?.addEventListener("click", (event) => {
      const target = event.target.closest("[data-help-action]");
      if (!target) return;
      const action = String(target.dataset.helpAction || "").trim();
      if (!action) return;
      void runHelpAction(action, target);
    });
  }

  return {
    renderContextualHelp,
    wireHelpEvents,
  };
}
