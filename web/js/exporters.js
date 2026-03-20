import { dom } from "./dom.js";
import { shownMetricFactor } from "./factor-format.mjs";
import { metricDisplayName, state } from "./model.js";

function downloadBlob(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function truncateMiddle(text, maxLen) {
  const raw = String(text || "");
  if (raw.length <= maxLen) return raw;
  const keep = Math.max(8, Math.floor((maxLen - 1) / 2));
  return `${raw.slice(0, keep)}…${raw.slice(raw.length - keep)}`;
}

function clipTextToWidth(ctx, text, maxWidth) {
  const raw = String(text || "");
  if (!raw) return "";
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  const ellipsis = "…";
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  if (ellipsisWidth > maxWidth) return "";

  let lo = 0;
  let hi = raw.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = raw.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return raw.slice(0, lo) + ellipsis;
}

function drawBootstrapLayersFill(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${size}px bootstrap-icons`;
  ctx.textBaseline = "top";
  ctx.fillText("\uf459", x, y);
  ctx.restore();
}

export function exportJSON() {
  const payload = {
    from: state.from,
    to: state.to,
    metrics: state.metrics,
    series: Object.fromEntries(state.series.entries()),
  };
  downloadBlob(
    "metricq-codex.json",
    "application/json",
    JSON.stringify(payload, null, 2),
  );
}

export function exportCSV() {
  const rows = ["metric,timestamp,value,kind"];
  for (const metric of state.metrics) {
    const series = state.series.get(metric.name);
    if (!series) continue;

    if (series.mode === "values") {
      for (const p of series.points || []) {
        rows.push(`${metric.name},${new Date(p.t).toISOString()},${p.v},raw`);
      }
      continue;
    }

    for (const p of series.aggregatePoints || []) {
      rows.push(`${metric.name},${new Date(p.t).toISOString()},${p.avg},avg`);
      rows.push(`${metric.name},${new Date(p.t).toISOString()},${p.min},min`);
      rows.push(`${metric.name},${new Date(p.t).toISOString()},${p.max},max`);
      rows.push(
        `${metric.name},${new Date(p.t).toISOString()},${p.count},count`,
      );
    }
  }
  downloadBlob("metricq-codex.csv", "text/csv", rows.join("\n"));
}

function drawLegend(ctx, cssWidth, cssHeight) {
  const visible = state.metrics.filter((m) => m.draw);
  if (visible.length === 0) return;

  const pad = 8;
  const rowGap = 5;
  const sectionGap = 10;
  const swatchSize = 10;
  const indicatorSize = 12;
  const headerHeight = 18;
  const mainLineHeight = 16;
  const descLineHeight = 13;
  const textX = pad + indicatorSize + 10;
  const maxAllowedWidth = Math.min(
    520,
    Math.max(220, Math.floor(cssWidth * 0.42)),
  );
  const minAllowedWidth = 190;

  const buildRows = (metrics, stacked = false) =>
    metrics.map((metric) => {
      const unit = metric.displayUnit || metric.unit || "";
      const factor = shownMetricFactor(metric);
      const formulaPrefix = metric.expr ? "ƒ " : "";
      const main = `${formulaPrefix}${metricDisplayName(metric)}${unit ? ` [${unit}]` : ""}${factor ? ` x${factor}` : ""}`;
      const desc = truncateMiddle(String(metric.description || "").trim(), 84);
      return { metric, main, desc };
    });

  const sections = (() => {
    if (!state.yAxisStacked) {
      return [{
        title: "",
        stacked: false,
        showHeader: false,
        rows: buildRows(visible),
      }];
    }
    const nonStacked = visible.filter((metric) => metric.stackMode === "normal");
    const stacked = visible.filter((metric) => metric.stackMode !== "normal");
    const out = [];
    if (nonStacked.length > 0) {
      out.push({
        title: "Einzeln",
        stacked: false,
        showHeader: true,
        rows: buildRows(nonStacked, false),
      });
    }
    if (stacked.length > 0) {
      out.push({
        title: `Stack (${stacked.length})`,
        stacked: true,
        showHeader: true,
        rows: buildRows(stacked, true),
      });
    }
    return out;
  })();

  let maxTextWidth = 0;
  for (const section of sections) {
    if (section.showHeader) {
      ctx.font = "700 10px sans-serif";
      maxTextWidth = Math.max(maxTextWidth, ctx.measureText(section.title).width);
    }
    ctx.font = "12px sans-serif";
    for (const row of section.rows) {
      maxTextWidth = Math.max(maxTextWidth, ctx.measureText(row.main).width);
      if (row.desc) {
        ctx.font = "11px sans-serif";
        maxTextWidth = Math.max(maxTextWidth, ctx.measureText(row.desc).width);
        ctx.font = "12px sans-serif";
      }
    }
  }
  const neededWidth = Math.ceil(textX + maxTextWidth + pad);
  const boxWidth = Math.max(
    minAllowedWidth,
    Math.min(maxAllowedWidth, neededWidth),
  );

  let boxH = pad;
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (section.showHeader) boxH += headerHeight;
    for (const row of section.rows) {
      boxH += mainLineHeight;
      if (row.desc) boxH += descLineHeight;
      boxH += rowGap;
    }
    boxH += pad - rowGap;
    if (i < sections.length - 1) boxH += sectionGap;
  }

  const boxX = cssWidth - 10 - boxWidth;
  const boxY = 10;

  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  ctx.strokeStyle = "#cfd6e4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxH, 7);
  ctx.fill();
  ctx.stroke();

  let y = boxY + pad;
  const rowMaxTextWidth = boxWidth - textX - pad;
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (section.showHeader) {
      ctx.fillStyle = section.stacked ? "#0b5ed7" : "#5f6b7b";
      ctx.font = "700 11px sans-serif";
      ctx.textBaseline = "top";
      const headerTextX = boxX + pad + (section.stacked ? indicatorSize + 6 : 0);
      if (section.stacked) {
        drawBootstrapLayersFill(ctx, boxX + pad, y + 1, indicatorSize, "#0b5ed7");
      }
      ctx.fillText(section.title, headerTextX, y);

      ctx.strokeStyle = section.stacked
        ? "rgba(13, 110, 253, 0.28)"
        : "rgba(108, 117, 125, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(boxX + pad, y + headerHeight - 3);
      ctx.lineTo(boxX + boxWidth - pad, y + headerHeight - 3);
      ctx.stroke();
      y += headerHeight;
    }

    for (const row of section.rows) {
      const { metric, main, desc } = row;
      const mainTop = y;
      const mainBaseline = mainTop + mainLineHeight - 3;

      ctx.fillStyle = metric.color;
      const indicatorY = mainTop + Math.floor((mainLineHeight - indicatorSize) / 2);
      if (section.stacked) {
        drawBootstrapLayersFill(ctx, boxX + pad, indicatorY, indicatorSize, metric.color);
      } else {
        ctx.textBaseline = "alphabetic";
        ctx.font = "12px sans-serif";
        ctx.fillRect(
          boxX + pad + Math.floor((indicatorSize - swatchSize) / 2),
          mainTop + Math.floor((mainLineHeight - swatchSize) / 2),
          swatchSize,
          swatchSize,
        );
      }

      ctx.fillStyle = "#1f2937";
      const clippedMain = clipTextToWidth(ctx, main, rowMaxTextWidth);
      ctx.fillText(clippedMain, boxX + textX, mainBaseline);

      y += mainLineHeight;
      if (desc) {
        ctx.fillStyle = "#8a94a6";
        ctx.font = "11px sans-serif";
        const clippedDesc = clipTextToWidth(ctx, desc, rowMaxTextWidth);
        ctx.fillText(clippedDesc, boxX + textX, y + descLineHeight - 3);
        y += descLineHeight;
      }
      y += rowGap;
    }
    y += pad - rowGap;
    if (i < sections.length - 1) y += sectionGap;
  }
}

export function exportPNG() {
  const source = dom.canvas;
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);

  const cssWidth = source.clientWidth || out.width;
  const cssHeight = source.clientHeight || out.height;
  const ratio = out.width / Math.max(1, cssWidth);
  ctx.save();
  ctx.scale(ratio, ratio);
  drawLegend(ctx, cssWidth, cssHeight);
  ctx.restore();

  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "metricq-codex.png";
    a.click();
    URL.revokeObjectURL(url);
  });
}
