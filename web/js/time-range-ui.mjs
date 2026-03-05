import { dom } from "./dom.js";
import { state } from "./model.js";

function formatRelativeRangeLabel() {
  const amount = Math.max(
    1,
    Number.parseInt(dom.relativeAmount?.value || "1", 10) || 1,
  );
  const unit = String(dom.relativeUnit?.value || "h");

  const labels = {
    m: { singular: "Minute", plural: "Minuten", gender: "f" },
    h: { singular: "Stunde", plural: "Stunden", gender: "f" },
    d: { singular: "Tag", plural: "Tage", gender: "m" },
    w: { singular: "Woche", plural: "Wochen", gender: "f" },
    M: { singular: "Monat", plural: "Monate", gender: "m" },
    y: { singular: "Jahr", plural: "Jahre", gender: "n" },
  };

  const { singular, plural, gender } = labels[unit] || labels.h;
  if (amount === 1) {
    const singularAdjective =
      gender === "m" ? "Letzter" : gender === "n" ? "Letztes" : "Letzte";
    return `${singularAdjective} ${singular}`;
  }
  return `Letzte ${amount} ${plural}`;
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
      dom.timePopupCurrentRange.textContent =
        Number.isFinite(from.getTime()) && Number.isFinite(to.getTime())
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
