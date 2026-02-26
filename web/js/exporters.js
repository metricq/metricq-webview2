import { dom } from "./dom.js";
import { shownMetricFactor } from "./factor-format.mjs";
import { metricDisplayName, state } from "./model.js";
import { downloadBlob } from "./utils.js";

export function exportJSON() {
  const payload = {
    from: state.from,
    to: state.to,
    metrics: state.metrics,
    series: Object.fromEntries(state.series.entries()),
  };
  downloadBlob("metricq-codex.json", "application/json", JSON.stringify(payload, null, 2));
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
      rows.push(`${metric.name},${new Date(p.t).toISOString()},${p.count},count`);
    }
  }
  downloadBlob("metricq-codex.csv", "text/csv", rows.join("\n"));
}

function drawLegend(ctx, cssWidth, cssHeight) {
  const visible = state.metrics.filter((m) => m.draw);
  if (visible.length === 0) return;

  const pad = 8;
  const rowGap = 6;
  const swatchSize = 10;
  const textX = pad + swatchSize + 8;
  const maxAllowedWidth = Math.min(520, Math.max(220, Math.floor(cssWidth * 0.42)));
  const minAllowedWidth = 190;

  const rows = visible.map((metric) => {
    const unit = metric.displayUnit || metric.unit || "";
    const factor = shownMetricFactor(metric);
    const formulaPrefix = metric.expr ? "ƒ " : "";
    const main = `${formulaPrefix}${metricDisplayName(metric)}${unit ? ` [${unit}]` : ""}${factor ? ` x${factor}` : ""}`;
    const desc = String(metric.description || "").trim();
    return { metric, main, desc };
  });

  let maxTextWidth = 0;
  ctx.font = "12px sans-serif";
  for (const row of rows) {
    maxTextWidth = Math.max(maxTextWidth, ctx.measureText(row.main).width);
    if (row.desc) {
      ctx.font = "11px sans-serif";
      maxTextWidth = Math.max(maxTextWidth, ctx.measureText(row.desc).width);
      ctx.font = "12px sans-serif";
    }
  }
  const neededWidth = Math.ceil(textX + maxTextWidth + pad);
  const boxWidth = Math.max(minAllowedWidth, Math.min(maxAllowedWidth, neededWidth));

  let boxH = pad;
  for (const row of rows) {
    const desc = row.desc;
    boxH += 14;
    if (desc) boxH += 13;
    boxH += rowGap;
  }
  boxH += pad - rowGap;

  const boxX = cssWidth - 10 - boxWidth;
  const boxY = 10;

  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  ctx.strokeStyle = "#cfd6e4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxH, 7);
  ctx.fill();
  ctx.stroke();

  let y = boxY + pad + 10;
  for (const row of rows) {
    const { metric, main, desc } = row;

    ctx.fillStyle = metric.color;
    ctx.fillRect(boxX + pad, y - 9, swatchSize, swatchSize);

    ctx.fillStyle = "#1f2937";
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "alphabetic";
    const rowMaxTextWidth = boxWidth - textX - pad;
    const clippedMain = ctx.measureText(main).width > rowMaxTextWidth ? `${main.slice(0, 64)}...` : main;
    ctx.fillText(clippedMain, boxX + textX, y);

    y += 14;
    if (desc) {
      ctx.fillStyle = "#8a94a6";
      ctx.font = "11px sans-serif";
      const clippedDesc = ctx.measureText(desc).width > rowMaxTextWidth ? `${desc.slice(0, 84)}...` : desc;
      ctx.fillText(clippedDesc, boxX + textX, y);
      y += 13;
    }
    y += rowGap;
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
