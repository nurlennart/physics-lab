/**
 * Axis range with three gridlines on round values (1, 2, 2.5, 5 × 10ⁿ steps). The range follows the
 * data instead of always including zero, so a 20 → 21 °C trace is not flattened against 0 °C.
 */
export function niceRange(values: number[]) {
  if (!values.length) return { lo: 0, hi: 1 };
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-12) { const d = Math.max(Math.abs(max) * 0.05, 1e-6); min -= d; max += d; }
  const raw = (max - min) / 2, mag = 10 ** Math.floor(Math.log10(raw));
  for (const f of [1, 2, 2.5, 5, 10, 20]) {
    const step = f * mag, lo = Math.floor(min / step) * step;
    if (lo + 2 * step >= max - 1e-12 * Math.abs(max)) return { lo, hi: lo + 2 * step };
  }
  return { lo: min, hi: max };
}
/** Tick label: enough decimals for the step, thousands as k/M. */
export function formatTick(v: number, step: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  return String(+v.toFixed(decimals));
}
