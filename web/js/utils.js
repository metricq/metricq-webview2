import { dom } from "./dom.js";
import { state } from "./model.js";

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
  const from = new Date(state.from);
  const to = new Date(state.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    dom.btnTimeRange.textContent = "Zeitraum";
    if (dom.timePopupCurrentRange) dom.timePopupCurrentRange.textContent = "-";
    return;
  }
  const label = `${from.toLocaleString()} - ${to.toLocaleString()}`;
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
