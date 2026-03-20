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
  const rowGap = 6;
  const sectionGap = 8;
  const swatchSize = 10;
  const textX = pad + swatchSize + 8;
  const maxAllowedWidth = Math.min(
    520,
    Math.max(220, Math.floor(cssWidth * 0.42)),
  );
  const minAllowedWidth = 190;

  const buildRows = (metrics) =>
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
      return [{ title: "Einzeln", stacked: false, rows: buildRows(visible) }];
    }
    const nonStacked = visible.filter((metric) => metric.stackMode === "normal");
    const stacked = visible.filter((metric) => metric.stackMode !== "normal");
    const out = [];
    if (nonStacked.length > 0) {
      out.push({ title: "Einzeln", stacked: false, rows: buildRows(nonStacked) });
    }
    if (stacked.length > 0) {
      out.push({
        title: `Stack (${stacked.length})`,
        stacked: true,
        rows: buildRows(stacked),
      });
    }
    return out;
  })();

  let maxTextWidth = 0;
  for (const section of sections) {
    ctx.font = "700 10px sans-serif";
    maxTextWidth = Math.max(maxTextWidth, ctx.measureText(section.title).width + 20);
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
    boxH += 18;
    for (const row of section.rows) {
      boxH += 14;
      if (row.desc) boxH += 13;
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
    const pillTextWidth = Math.ceil(ctx.measureText(section.title).width);
    const pillWidth = Math.min(boxWidth - (pad * 2), pillTextWidth + 28);

    ctx.fillStyle = section.stacked
      ? "rgba(13, 110, 253, 0.14)"
      : "rgba(108, 117, 125, 0.08)";
    ctx.beginPath();
    ctx.roundRect(boxX + pad, y, pillWidth, 16, 999);
    ctx.fill();

    ctx.fillStyle = section.stacked ? "#0b5ed7" : "#5f6b7b";
    ctx.font = "700 10px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(section.stacked ? "≡" : "-", boxX + pad + 7, y + 8);
    ctx.fillText(section.title, boxX + pad + 18, y + 8);
    y += 22;

    if (section.stacked) {
      const sectionRowsHeight = section.rows.reduce((height, row) => {
        let next = height + 14 + rowGap;
        if (row.desc) next += 13;
        return next;
      }, pad - rowGap);
      ctx.fillStyle = "rgba(13, 110, 253, 0.08)";
      ctx.strokeStyle = "rgba(13, 110, 253, 0.16)";
      ctx.beginPath();
      ctx.roundRect(boxX + 4, y - 4, boxWidth - 8, sectionRowsHeight + 8, 6);
      ctx.fill();
      ctx.stroke();
    }

    for (const row of section.rows) {
      const { metric, main, desc } = row;

      ctx.fillStyle = metric.color;
      ctx.textBaseline = "alphabetic";
      ctx.font = "12px sans-serif";
      if (section.stacked) {
        ctx.fillText("≡", boxX + pad + 1, y);
      } else {
        ctx.fillRect(boxX + pad, y - 9, swatchSize, swatchSize);
      }

      ctx.fillStyle = "#1f2937";
      const clippedMain =
        ctx.measureText(main).width > rowMaxTextWidth
          ? `${main.slice(0, 64)}...`
          : main;
      ctx.fillText(clippedMain, boxX + textX, y);

      y += 14;
      if (desc) {
        ctx.fillStyle = "#8a94a6";
        ctx.font = "11px sans-serif";
        const clippedDesc =
          ctx.measureText(desc).width > rowMaxTextWidth
            ? `${desc.slice(0, 84)}...`
            : desc;
        ctx.fillText(clippedDesc, boxX + textX, y);
        y += 13;
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
