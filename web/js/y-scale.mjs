// Symmetric logarithms keep zero and negative values defined.
export function createYScale(min, max, logarithmic = false, constant = 1) {
  constant = Number.isFinite(constant) && constant > 0 ? constant : 1;
  const transform = logarithmic
    ? (value) => Math.sign(value) * Math.log1p(Math.abs(value) / constant)
    : (value) => value;
  const inverse = logarithmic
    ? (value) => Math.sign(value) * Math.expm1(Math.abs(value)) * constant
    : (value) => value;
  const low = transform(min);
  const high = transform(max);
  return {
    transform, inverse,
    position: (value) => (transform(value) - low) / (high - low),
    valueAt: (position) => inverse(low + position * (high - low)),
  };
}

export function logarithmicTicks(min, max, height, scale) {
  const hasZero = min <= 0 && max >= 0;
  const candidates = hasZero ? [0] : [];
  for (let exp = -18; exp <= 24; exp++) {
    const value = 10 ** exp;
    if (value >= min && value <= max) candidates.push(value);
    if (-value >= min && -value <= max) candidates.push(-value);
  }
  candidates.sort((a, b) => a - b);
  const ticks = [];
  for (const value of candidates) {
    // Reserve the zero label before spacing the remaining ticks.
    if (hasZero && value !== 0 && Math.abs(scale.position(value) - scale.position(0)) * height < 48) continue;
    if (ticks.length === 0 || (scale.position(value) - scale.position(ticks.at(-1))) * height >= 48) ticks.push(value);
  }
  return ticks.length ? ticks : [min, max];
}

export function formatLogarithmicTick(value) {
  if (value === 0) return "0";
  if (!Number.isFinite(value)) return "";
  const magnitude = Math.abs(value);
  const exponent = Math.floor(Math.log10(magnitude) + 1e-12);
  const mantissa = Number((magnitude / 10 ** exponent).toPrecision(3));
  const superscripts = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  const power = [...String(exponent)].map((digit) => superscripts[digit]).join("");
  const sign = value < 0 ? "−" : "";
  if (exponent === 0) return `${sign}${mantissa}`;
  return `${sign}${mantissa === 1 ? "" : `${mantissa}×`}10${power}`;
}
