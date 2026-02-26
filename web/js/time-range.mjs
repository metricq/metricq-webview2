export function relativeRangeStart(now, amount, unit) {
  const from = new Date(now);
  if (unit === "M") {
    from.setMonth(from.getMonth() - amount);
    return from.getTime();
  }
  if (unit === "y") {
    from.setFullYear(from.getFullYear() - amount);
    return from.getTime();
  }
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
  const delta = (unitMs[unit] || unitMs.h) * amount;
  return now - delta;
}

export function applyTokenOffset(date, offset) {
  const match = /^([+-])(\d+)([mhdwMy])$/.exec(String(offset || "").trim());
  if (!match) return date;
  const sign = match[1] === "-" ? -1 : 1;
  const value = sign * Number.parseInt(match[2], 10);
  const unit = match[3];
  const out = new Date(date);
  if (unit === "m") out.setMinutes(out.getMinutes() + value);
  else if (unit === "h") out.setHours(out.getHours() + value);
  else if (unit === "d") out.setDate(out.getDate() + value);
  else if (unit === "w") out.setDate(out.getDate() + value * 7);
  else if (unit === "M") out.setMonth(out.getMonth() + value);
  else if (unit === "y") out.setFullYear(out.getFullYear() + value);
  return out;
}
