import { startHelpOverlayMinimize } from "./chart.js";
import { dom } from "./dom.js";
import { classicPalette } from "./metrics.js";
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
  const iconHtml = icon ? `<i class="bi ${icon} me-1"></i>` : "";
  return `<button class="btn btn-${tone} btn-sm" type="button" data-help-action="${action}"${disabledAttr}>${iconHtml}${label}</button>`;
}

const HELP_ATTR = "data-help";
const HELP_RICH_ATTR = "data-help-rich";
const NATIVE_TITLE_STASH_ATTR = "data-help-native-title";

// Sized, labeled example diagrams shown above a render-mode button's own
// explanation on hover. Labeled with the exact same terms the real hover
// tooltip in chart.js uses (min/avg/max, O/H/L/C — see the rows built in
// renderHoverAt), so the diagram maps directly onto what you'll actually see
// once data is loaded. Drawn to match how renderChart() renders each mode:
// bands/line draw the same avg line, bands additionally fills the min/max
// band; count replaces the value with a frequency (Hz) — more samples in the
// same time means a higher Hz, not a bigger measured value; TI draws the same
// band+line but stepped (a value holds until the next measurement); and
// candlesticks draw a wick (low/high) with an open/close body, full opacity
// when rising and translucent when falling.
const VIEW_MODE_DIAGRAM_HEIGHT = 170;

// Every diagram below renders its own time axis (ticks at the actual report
// timestamps, plus a trailing arrowhead) so the interval each mode assigns
// to a value is never ambiguous. Bands/Line use the *same* axis but shade a
// centered midpoint-to-midpoint interval (a plotted point summarizes its
// neighborhood), while TI shades the raw point-to-next-point interval
// (a report holds forward, verbatim, until the next one) — see
// stackedValueAtLastSemantics in series_stacking.go for the backing logic.
const VIEW_MODE_GLYPH = {
  bands: `<svg viewBox="0 0 320 ${VIEW_MODE_DIAGRAM_HEIGHT}" width="320" height="${VIEW_MODE_DIAGRAM_HEIGHT}" aria-hidden="true">
    <rect x="95" y="6" width="50" height="130" fill="var(--mq-navy)" opacity="0.07"></rect>
    <line x1="95" y1="6" x2="95" y2="136" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <line x1="145" y1="6" x2="145" y2="136" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <path d="M20,25 L70,15 L120,31 L170,9 L220,21 L220,81 L170,69 L120,91 L70,75 L20,85 Z" fill="var(--mq-blue)" opacity="0.18"></path>
    <polyline points="20,25 70,15 120,31 170,9 220,21" fill="none" stroke="var(--mq-blue)" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.85"></polyline>
    <polyline points="20,85 70,75 120,91 170,69 220,81" fill="none" stroke="var(--mq-blue)" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.85"></polyline>
    <polyline points="20,55 70,45 120,61 170,39 220,51" fill="none" stroke="var(--mq-blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <line x1="220" y1="21" x2="230" y2="21" stroke="var(--mq-blue)" stroke-width="1"></line>
    <line x1="220" y1="51" x2="230" y2="51" stroke="var(--mq-navy)" stroke-width="1"></line>
    <line x1="220" y1="81" x2="230" y2="81" stroke="var(--mq-blue)" stroke-width="1"></line>
    <text x="234" y="21" font-size="15" fill="var(--mq-blue)" dominant-baseline="middle">max</text>
    <text x="234" y="51" font-size="15" fill="var(--mq-navy)" font-weight="700" dominant-baseline="middle">avg</text>
    <text x="234" y="81" font-size="15" fill="var(--mq-blue)" dominant-baseline="middle">min</text>
    <line x1="15" y1="112" x2="225" y2="112" stroke="var(--mq-line)" stroke-width="1"></line>
    <polygon points="225,108 233,112 225,116" fill="var(--mq-line)"></polygon>
    <g stroke="var(--mq-line)" stroke-width="1">
      <line x1="20" y1="108" x2="20" y2="116"></line>
      <line x1="70" y1="108" x2="70" y2="116"></line>
      <line x1="120" y1="108" x2="120" y2="116"></line>
      <line x1="170" y1="108" x2="170" y2="116"></line>
      <line x1="220" y1="108" x2="220" y2="116"></line>
    </g>
    <g font-size="11" fill="var(--mq-line)" text-anchor="middle">
      <text x="20" y="130">t&#8321;</text>
      <text x="70" y="130">t&#8322;</text>
      <text x="120" y="130">t&#8323;</text>
      <text x="170" y="130">t&#8324;</text>
      <text x="220" y="130">t&#8325;</text>
    </g>
    <text x="120" y="152" font-size="12" fill="var(--mq-navy)" text-anchor="middle">Zeitraum = Mitte &#8596; Mitte zu Nachbarn</text>
  </svg>`,
  line: `<svg viewBox="0 0 320 ${VIEW_MODE_DIAGRAM_HEIGHT}" width="320" height="${VIEW_MODE_DIAGRAM_HEIGHT}" aria-hidden="true">
    <rect x="95" y="6" width="50" height="130" fill="var(--mq-navy)" opacity="0.07"></rect>
    <line x1="95" y1="6" x2="95" y2="136" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <line x1="145" y1="6" x2="145" y2="136" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <polyline points="20,56 70,46 120,62 170,40 220,54" fill="none" stroke="var(--mq-blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <line x1="220" y1="54" x2="230" y2="54" stroke="var(--mq-navy)" stroke-width="1"></line>
    <text x="234" y="54" font-size="15" fill="var(--mq-navy)" font-weight="700" dominant-baseline="middle">avg</text>
    <line x1="15" y1="112" x2="225" y2="112" stroke="var(--mq-line)" stroke-width="1"></line>
    <polygon points="225,108 233,112 225,116" fill="var(--mq-line)"></polygon>
    <g stroke="var(--mq-line)" stroke-width="1">
      <line x1="20" y1="108" x2="20" y2="116"></line>
      <line x1="70" y1="108" x2="70" y2="116"></line>
      <line x1="120" y1="108" x2="120" y2="116"></line>
      <line x1="170" y1="108" x2="170" y2="116"></line>
      <line x1="220" y1="108" x2="220" y2="116"></line>
    </g>
    <g font-size="11" fill="var(--mq-line)" text-anchor="middle">
      <text x="20" y="130">t&#8321;</text>
      <text x="70" y="130">t&#8322;</text>
      <text x="120" y="130">t&#8323;</text>
      <text x="170" y="130">t&#8324;</text>
      <text x="220" y="130">t&#8325;</text>
    </g>
    <text x="120" y="152" font-size="12" fill="var(--mq-navy)" text-anchor="middle">Zeitraum = Mitte &#8596; Mitte zu Nachbarn</text>
  </svg>`,
  count: `<svg viewBox="0 0 320 ${VIEW_MODE_DIAGRAM_HEIGHT}" width="320" height="${VIEW_MODE_DIAGRAM_HEIGHT}" aria-hidden="true">
    <rect x="95" y="6" width="50" height="130" fill="var(--mq-teal)" opacity="0.07"></rect>
    <line x1="95" y1="6" x2="95" y2="136" stroke="var(--mq-teal)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <line x1="145" y1="6" x2="145" y2="136" stroke="var(--mq-teal)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <g stroke="var(--mq-teal)" stroke-width="2" stroke-linecap="round" opacity="0.55">
      <line x1="18" y1="90" x2="18" y2="104"></line>
      <line x1="30" y1="90" x2="30" y2="104"></line>
      <line x1="52" y1="90" x2="52" y2="104"></line>
      <line x1="65" y1="90" x2="65" y2="104"></line>
      <line x1="80" y1="90" x2="80" y2="104"></line>
      <line x1="100" y1="90" x2="100" y2="104"></line>
      <line x1="108" y1="90" x2="108" y2="104"></line>
      <line x1="116" y1="90" x2="116" y2="104"></line>
      <line x1="124" y1="90" x2="124" y2="104"></line>
      <line x1="132" y1="90" x2="132" y2="104"></line>
      <line x1="140" y1="90" x2="140" y2="104"></line>
      <line x1="152" y1="90" x2="152" y2="104"></line>
      <line x1="165" y1="90" x2="165" y2="104"></line>
      <line x1="178" y1="90" x2="178" y2="104"></line>
      <line x1="190" y1="90" x2="190" y2="104"></line>
      <line x1="202" y1="90" x2="202" y2="104"></line>
      <line x1="218" y1="90" x2="218" y2="104"></line>
    </g>
    <polyline points="20,70 70,58 120,25 170,50 220,68" fill="none" stroke="var(--mq-teal)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <line x1="220" y1="68" x2="230" y2="68" stroke="var(--mq-teal)" stroke-width="1"></line>
    <text x="234" y="68" font-size="15" fill="var(--mq-teal)" font-weight="700" dominant-baseline="middle">Hz</text>
    <line x1="15" y1="112" x2="225" y2="112" stroke="var(--mq-line)" stroke-width="1"></line>
    <polygon points="225,108 233,112 225,116" fill="var(--mq-line)"></polygon>
    <g stroke="var(--mq-line)" stroke-width="1">
      <line x1="20" y1="108" x2="20" y2="116"></line>
      <line x1="70" y1="108" x2="70" y2="116"></line>
      <line x1="120" y1="108" x2="120" y2="116"></line>
      <line x1="170" y1="108" x2="170" y2="116"></line>
      <line x1="220" y1="108" x2="220" y2="116"></line>
    </g>
    <g font-size="11" fill="var(--mq-line)" text-anchor="middle">
      <text x="20" y="130">t&#8321;</text>
      <text x="70" y="130">t&#8322;</text>
      <text x="120" y="130">t&#8323;</text>
      <text x="170" y="130">t&#8324;</text>
      <text x="220" y="130">t&#8325;</text>
    </g>
    <text x="120" y="152" font-size="12" fill="var(--mq-teal)" text-anchor="middle">Wert = Rohpunkte je Zeitraum</text>
  </svg>`,
  ti: `<svg viewBox="0 0 400 ${VIEW_MODE_DIAGRAM_HEIGHT}" width="400" height="${VIEW_MODE_DIAGRAM_HEIGHT}" aria-hidden="true">
    <rect x="20" y="40" width="70" height="30" fill="var(--mq-navy)" opacity="0.18"></rect>
    <rect x="90" y="15" width="70" height="30" fill="var(--mq-navy)" opacity="0.18"></rect>
    <rect x="160" y="55" width="70" height="30" fill="var(--mq-navy)" opacity="0.18"></rect>
    <path d="M20,55 L90,55 L90,28 L160,28 L160,68 L230,68" fill="none" stroke="var(--mq-navy)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
    <line x1="15" y1="112" x2="235" y2="112" stroke="var(--mq-line)" stroke-width="1"></line>
    <polygon points="235,108 243,112 235,116" fill="var(--mq-line)"></polygon>
    <g stroke="var(--mq-line)" stroke-width="1">
      <line x1="20" y1="108" x2="20" y2="116"></line>
      <line x1="90" y1="108" x2="90" y2="116"></line>
      <line x1="160" y1="108" x2="160" y2="116"></line>
      <line x1="230" y1="108" x2="230" y2="116"></line>
    </g>
    <g font-size="11" fill="var(--mq-line)" text-anchor="middle">
      <text x="20" y="130">t&#8321;</text>
      <text x="90" y="130">t&#8322;</text>
      <text x="160" y="130">t&#8323;</text>
      <text x="230" y="130">t&#8324;</text>
    </g>
    <text x="125" y="152" font-size="12" fill="var(--mq-navy)" text-anchor="middle">Zeitraum = Punkt bis n&#228;chster Punkt</text>
    <line x1="240" y1="50" x2="250" y2="50" stroke="var(--mq-navy)" stroke-width="1"></line>
    <line x1="240" y1="70" x2="250" y2="70" stroke="var(--mq-navy)" stroke-width="1"></line>
    <line x1="240" y1="90" x2="250" y2="90" stroke="var(--mq-navy)" stroke-width="1"></line>
    <text x="254" y="50" font-size="13" fill="var(--mq-navy)" dominant-baseline="middle">max</text>
    <text x="254" y="70" font-size="13" fill="var(--mq-navy)" font-weight="700" dominant-baseline="middle">avg</text>
    <text x="254" y="90" font-size="13" fill="var(--mq-navy)" dominant-baseline="middle">min</text>
  </svg>`,
  candlestick: `<svg viewBox="0 0 370 ${VIEW_MODE_DIAGRAM_HEIGHT}" width="370" height="${VIEW_MODE_DIAGRAM_HEIGHT}" aria-hidden="true">
    <rect x="100" y="6" width="40" height="130" fill="var(--mq-navy)" opacity="0.07"></rect>
    <line x1="100" y1="6" x2="100" y2="136" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <line x1="140" y1="6" x2="140" y2="136" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>
    <line x1="40" y1="40" x2="40" y2="45" stroke="var(--mq-green)" stroke-width="2"></line>
    <line x1="40" y1="65" x2="40" y2="70" stroke="var(--mq-green)" stroke-width="2"></line>
    <rect x="26" y="45" width="28" height="20" fill="var(--mq-green)"></rect>
    <line x1="80" y1="42" x2="80" y2="45" stroke="var(--mq-green)" stroke-width="2"></line>
    <line x1="80" y1="60" x2="80" y2="64" stroke="var(--mq-green)" stroke-width="2"></line>
    <rect x="66" y="45" width="28" height="15" fill="var(--mq-green)" opacity="0.4"></rect>
    <line x1="120" y1="30" x2="120" y2="35" stroke="var(--mq-green)" stroke-width="2"></line>
    <line x1="120" y1="60" x2="120" y2="66" stroke="var(--mq-green)" stroke-width="2"></line>
    <rect x="106" y="35" width="28" height="25" fill="var(--mq-green)"></rect>
    <line x1="160" y1="32" x2="160" y2="35" stroke="var(--mq-green)" stroke-width="2"></line>
    <line x1="160" y1="58" x2="160" y2="63" stroke="var(--mq-green)" stroke-width="2"></line>
    <rect x="146" y="35" width="28" height="23" fill="var(--mq-green)" opacity="0.4"></rect>
    <line x1="200" y1="12" x2="200" y2="33" stroke="var(--mq-green)" stroke-width="2"></line>
    <line x1="200" y1="57" x2="200" y2="80" stroke="var(--mq-green)" stroke-width="2"></line>
    <rect x="186" y="33" width="28" height="24" fill="var(--mq-green)"></rect>
    <line x1="200" y1="12" x2="280" y2="12" stroke="var(--mq-green)" stroke-width="1" stroke-dasharray="2,2"></line>
    <text x="284" y="12" font-size="12" fill="var(--mq-green)" dominant-baseline="middle">Hoch (H)</text>
    <line x1="214" y1="33" x2="280" y2="33" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="2,2"></line>
    <text x="284" y="33" font-size="12" fill="var(--mq-navy)" font-weight="700" dominant-baseline="middle">Close (C)</text>
    <line x1="214" y1="57" x2="280" y2="57" stroke="var(--mq-navy)" stroke-width="1" stroke-dasharray="2,2"></line>
    <text x="284" y="57" font-size="12" fill="var(--mq-navy)" font-weight="700" dominant-baseline="middle">Open (O)</text>
    <line x1="200" y1="80" x2="280" y2="80" stroke="var(--mq-green)" stroke-width="1" stroke-dasharray="2,2"></line>
    <text x="284" y="80" font-size="12" fill="var(--mq-green)" dominant-baseline="middle">Tief (L)</text>
    <rect x="284" y="124" width="10" height="10" fill="var(--mq-green)"></rect>
    <text x="298" y="133" font-size="11" fill="var(--mq-navy)">steigend</text>
    <rect x="284" y="142" width="10" height="10" fill="var(--mq-green)" opacity="0.4"></rect>
    <text x="298" y="151" font-size="11" fill="var(--mq-navy)">fallend</text>
    <line x1="15" y1="112" x2="225" y2="112" stroke="var(--mq-line)" stroke-width="1"></line>
    <polygon points="225,108 233,112 225,116" fill="var(--mq-line)"></polygon>
    <g stroke="var(--mq-line)" stroke-width="1">
      <line x1="20" y1="108" x2="20" y2="116"></line>
      <line x1="60" y1="108" x2="60" y2="116"></line>
      <line x1="100" y1="108" x2="100" y2="116"></line>
      <line x1="140" y1="108" x2="140" y2="116"></line>
      <line x1="180" y1="108" x2="180" y2="116"></line>
      <line x1="220" y1="108" x2="220" y2="116"></line>
    </g>
    <g font-size="10" fill="var(--mq-line)" text-anchor="middle">
      <text x="20" y="130">t&#8321;</text>
      <text x="60" y="130">t&#8322;</text>
      <text x="100" y="130">t&#8323;</text>
      <text x="140" y="130">t&#8324;</text>
      <text x="180" y="130">t&#8325;</text>
      <text x="220" y="130">t&#8326;</text>
    </g>
    <text x="120" y="152" font-size="12" fill="var(--mq-navy)" text-anchor="middle">Intervall = volle Breite</text>
  </svg>`,
  classicPalette: `<div class="view-mode-palette-row">${classicPalette
    .map(
      (hex) =>
        `<span class="metric-color" style="background:${hex}" title="${hex}"></span>`,
    )
    .join("")}</div>`,
};

// Renders a hovered render-mode button's own explanation (desc, from its
// data-help attribute) below its labeled example diagram — not a combined
// overview of all modes, just that one button's.
function viewModeRichSubtitle(mode, desc) {
  const glyph = VIEW_MODE_GLYPH[mode];
  if (!glyph) return null;
  return `<div class="view-mode-legend-row"><div class="view-mode-diagram">${glyph}</div><div class="view-mode-legend-text">${desc}</div></div>`;
}

// The browser's own title tooltip would otherwise pop up late and fight
// for space with the in-modal explanation, so it's stashed away while
// help-hover owns the element, then put back exactly as it was. Reads
// fall back to the stash too, since a second mouseover within the same
// element (e.g. moving from an icon to its parent button) would otherwise
// see the title as already gone and lose the explanation mid-hover.
function readTitle(node) {
  return (
    node.getAttribute("title") ||
    node.getAttribute(NATIVE_TITLE_STASH_ATTR) ||
    ""
  ).trim();
}

function suppressNativeTitle(node) {
  const title = node.getAttribute("title");
  if (title != null) {
    node.setAttribute(NATIVE_TITLE_STASH_ATTR, title);
    node.removeAttribute("title");
  }
}

function restoreNativeTitle(node) {
  const stashed = node.getAttribute(NATIVE_TITLE_STASH_ATTR);
  if (stashed != null) {
    node.setAttribute("title", stashed);
    node.removeAttribute(NATIVE_TITLE_STASH_ATTR);
  }
}

// Icon-only buttons wrap their real explanation on an ancestor (title or
// data-help), not on the <i> the pointer actually lands on — walk up to it.
function findHoverHelpTarget(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      const term = readTitle(node);
      const desc = (node.getAttribute(HELP_ATTR) || term).trim();
      const rich = (node.getAttribute(HELP_RICH_ATTR) || "").trim();
      if (term || desc || rich)
        return { node, term: term || desc, desc: desc || term, rich };
    }
    node = node.parentElement;
  }
  return null;
}

export function createHelpModule({
  setSidebarCollapsed,
  toggleTimePopup,
  renderChart,
}) {
  let hoverTarget = null;
  let hoverExplainActive = false;

  function isHelpPanelOpen() {
    return !!(
      dom.chartEmptyState && !dom.chartEmptyState.classList.contains("d-none")
    );
  }

  // Overrides the panel's own title/subtitle with the hovered control's
  // explanation instead of a separate floating tooltip, so the "dynamic
  // help" panel stays the single place help text shows up.
  function showHoverExplanation({ term, desc, rich }) {
    if (!dom.chartHelpTitle || !dom.chartHelpSubtitle) return;
    hoverExplainActive = true;
    dom.chartEmptyState
      ?.querySelector(".chart-empty-card")
      ?.classList.add("is-hover-explain");
    dom.chartHelpTitle.textContent = term;
    const richHtml = rich ? viewModeRichSubtitle(rich, desc) : null;
    if (richHtml) dom.chartHelpSubtitle.innerHTML = richHtml;
    else dom.chartHelpSubtitle.textContent = desc;
    dom.chartHelpSections?.classList.add("d-none");
  }

  function clearHoverExplanation() {
    if (!hoverExplainActive) return;
    hoverExplainActive = false;
    dom.chartEmptyState
      ?.querySelector(".chart-empty-card")
      ?.classList.remove("is-hover-explain");
    dom.chartHelpSections?.classList.remove("d-none");
    renderContextualHelp();
  }

  function releaseHoverTarget() {
    if (!hoverTarget) return;
    restoreNativeTitle(hoverTarget);
    hoverTarget = null;
    clearHoverExplanation();
  }

  function handleHelpHoverOver(event) {
    if (!isHelpPanelOpen()) {
      releaseHoverTarget();
      return;
    }
    const match = findHoverHelpTarget(event.target);
    if (!match) {
      releaseHoverTarget();
      return;
    }
    if (match.node === hoverTarget) return;
    releaseHoverTarget();
    hoverTarget = match.node;
    suppressNativeTitle(hoverTarget);
    showHoverExplanation(match);
  }

  function handleHelpHoverOut(event) {
    if (!hoverTarget) return;
    const related = event.relatedTarget;
    if (related && hoverTarget.contains(related)) return;
    releaseHoverTarget();
  }

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
          "outline-primary",
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
          "+ƒ Berechnete Metrik",
          "",
          "primary",
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
    document.addEventListener("mouseover", handleHelpHoverOver, true);
    document.addEventListener("mouseout", handleHelpHoverOut, true);
  }

  return {
    renderContextualHelp,
    wireHelpEvents,
  };
}
