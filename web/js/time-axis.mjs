export function formatAxisTime(ms, rangeMs, tickStepMs = rangeMs) {
  const d = new Date(ms);
  const hh = d.getHours();
  const mm = d.getMinutes();
  const ss = d.getSeconds();
  const msec = d.getMilliseconds();
  const day = d.getDate();
  const mon = d.getMonth() + 1;
  const hh2 = String(hh).padStart(2, "0");
  const mm2 = String(mm).padStart(2, "0");
  const ss2 = String(ss).padStart(2, "0");

  if (tickStepMs < 1000) {
    const sss = String(msec).padStart(3, "0");
    return `${hh2}:${mm2}:${ss2}.${sss}`;
  }
  if (tickStepMs < 60_000) {
    return `${hh2}:${mm2}:${ss2}`;
  }
  if (tickStepMs < 3_600_000) {
    return `${hh2}:${mm2}`;
  }
  if (rangeMs <= 86_400_000 * 2) {
    return `${day}.${mon}. ${hh2}:${mm2}`;
  }
  return `${day}.${mon}.${d.getFullYear()}`;
}

export function formatAbsoluteTime(ms) {
  const d = new Date(ms);
  const pad = (x, n = 2) => String(x).padStart(n, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function pickTimeTickStep(rangeMs, targetTicks) {
  const steps = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1000, 2000, 5000, 10_000, 15_000, 30_000,
    60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
    3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000,
  ];
  const minStep = rangeMs / Math.max(2, targetTicks);
  for (const step of steps) {
    if (step >= minStep) return step;
  }
  return steps[steps.length - 1];
}

export function buildXTicks(xMin, xMax, stepMs) {
  const ticks = [];
  const start = Math.ceil(xMin / stepMs) * stepMs;
  for (let t = start; t <= xMax; t += stepMs) {
    ticks.push(t);
  }
  return ticks;
}
