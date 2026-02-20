import { dom } from "./dom.js";
import { state } from "./model.js";

function formatRelativeRangeLabel() {
  const amount = Math.max(1, Number.parseInt(dom.relativeAmount?.value || "1", 10) || 1);
  const unit = String(dom.relativeUnit?.value || "h");

  const labels = {
    m: ["Minute", "Minuten"],
    h: ["Stunde", "Stunden"],
    d: ["Tag", "Tage"],
    w: ["Woche", "Wochen"],
    M: ["Monat", "Monate"],
    y: ["Jahr", "Jahre"],
  };

  const [one, many] = labels[unit] || labels.h;
  const noun = amount === 1 ? one : many;
  return `Letzte ${amount} ${noun}`;
}

function formatAbsoluteRangeDate(date) {
  const pad2 = (x) => String(x).padStart(2, "0");
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function toLocalInput(date) {
  const pad = (x) => String(x).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}`;
}

export function setInitialRange() {
  const now = new Date();
  const before = new Date(now.getTime() - 24 * 3600 * 1000);
  dom.fromInput.value = toLocalInput(before);
  dom.toInput.value = toLocalInput(now);
  state.from = before.getTime();
  state.to = now.getTime();
  updateRangeButtonLabel();
}

export function parseRangeFromInputs() {
  const from = new Date(dom.fromInput.value).getTime();
  const to = new Date(dom.toInput.value).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error("Ungueltiger Zeitraum");
  }
  state.from = from;
  state.to = to;
  updateRangeButtonLabel();
}

export function updateRangeButtonLabel() {
  if (!dom.btnTimeRange) return;
  if (state.timeMode === "relative") {
    const relLabel = formatRelativeRangeLabel();
    dom.btnTimeRange.innerHTML = `<i class="bi bi-clock-history me-1"></i>${relLabel}`;
    if (dom.timePopupCurrentRange) {
      const from = new Date(state.from);
      const to = new Date(state.to);
      dom.timePopupCurrentRange.textContent = Number.isFinite(from.getTime()) && Number.isFinite(to.getTime())
        ? `${from.toLocaleString()} - ${to.toLocaleString()}`
        : relLabel;
    }
    return;
  }

  const from = new Date(state.from);
  const to = new Date(state.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    dom.btnTimeRange.textContent = "Zeitraum";
    if (dom.timePopupCurrentRange) dom.timePopupCurrentRange.textContent = "-";
    return;
  }
  const label = `${formatAbsoluteRangeDate(from)} - ${formatAbsoluteRangeDate(to)}`;
  dom.btnTimeRange.innerHTML = `<i class="bi bi-clock-history me-1"></i>${label}`;
  if (dom.timePopupCurrentRange) dom.timePopupCurrentRange.textContent = label;
}

export function downloadBlob(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
