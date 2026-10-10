/** Engineering number entry and display (pure, UI-independent). */
const prefixes: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
/** Parse "30k", "4.7 M", "100m", "2,5", "1e-3" into a number (SI prefixes, decimal comma). */
export function parseEngineering(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "").replace(/\u2212/g, "-").replace(/^([+-]?\d+),(\d+)$/, "$1.$2").replace(/^([+-]?\d+),(\d+)([pnuµmkKMGT])$/, "$1.$2$3");
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuµmkKMGT])?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? prefixes[m[2]] : 1);
  return Number.isFinite(v) ? v : null;
}
/** Compact engineering display with up to 6 significant digits. */
export function formatEngineering(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : v < 0 ? "−∞" : "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(Math.min(digits - 1, 4)).replace(/\.?0+e/, "e");
  return String(Number(v.toPrecision(digits)));
}
