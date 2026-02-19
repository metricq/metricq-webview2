export function sanitizeFactor(value, fallback = 1) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed === 0) return 1;
  return parsed;
}
