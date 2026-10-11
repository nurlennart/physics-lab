/** Dense real/complex solves shared by the electrical, thermal, hydraulic and shaft equations. */
type Cx = [number, number];
const cadd = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const csub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: Cx, b: Cx): Cx => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a: Cx) => Math.hypot(a[0], a[1]);
/** Complex Gaussian elimination with partial pivoting. */
export function solveComplex(a: Cx[][], b: Cx[]): Cx[] {
  const n = b.length, m = a.map((row, i) => [...row.map((v) => [...v] as Cx), [...b[i]] as Cx]);
  // Equilibrate rows and columns before choosing pivots: voltage/current equations use different units.
  for (let i = 0; i < n; i++) {
    const scale = Math.max(...m[i].slice(0, n).map(cabs));
    if (!(scale > 0) || !Number.isFinite(scale)) throw Error("Singular AC circuit: an equation has no finite coefficients.");
    for (let j = 0; j <= n; j++) m[i][j] = [m[i][j][0] / scale, m[i][j][1] / scale];
  }
  const columns = Array.from({ length: n }, (_, j) => Math.max(...m.map(row => cabs(row[j]))));
  for (let j = 0; j < n; j++) {
    if (!(columns[j] > 0)) throw Error("Singular AC circuit: undefined circuit unknown.");
    for (let i = 0; i < n; i++) m[i][j] = [m[i][j][0] / columns[j], m[i][j][1] / columns[j]];
  }
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (cabs(m[i][k]) > cabs(m[pivot][k])) pivot = i;
    if (cabs(m[pivot][k]) <= Number.EPSILON * Math.max(1, n)) throw Error("Singular AC circuit: conflicting sources or a floating node.");
    [m[k], m[pivot]] = [m[pivot], m[k]];
    for (let i = k + 1; i < n; i++) {
      const f = cdiv(m[i][k], m[k][k]);
      for (let j = k; j <= n; j++) m[i][j] = csub(m[i][j], cmul(f, m[k][j]));
    }
  }
  const x: Cx[] = Array.from({ length: n }, () => [0, 0]);
  for (let i = n - 1; i >= 0; i--) {
    let sum = m[i][n];
    for (let j = i + 1; j < n; j++) sum = csub(sum, cmul(m[i][j], x[j]));
    x[i] = cdiv(sum, m[i][i]);
  }
  for (let i = 0; i < n; i++) x[i] = [x[i][0] / columns[i], x[i][1] / columns[i]];
  if (x.some((v) => !v.every(Number.isFinite))) throw Error("AC circuit solver produced a non-finite result.");
  for (let i = 0; i < n; i++) {
    const lhs = a[i].reduce<Cx>((sum, v, j) => cadd(sum, cmul(v, x[j])), [0, 0]);
    const scale = cabs(b[i]) + a[i].reduce((sum, v, j) => sum + cabs(v) * cabs(x[j]), 0);
    if (cabs(csub(lhs, b[i])) > 256 * Number.EPSILON * Math.max(1, n) * scale) throw Error("AC circuit numerical error: scaled equation residual is too large.");
  }
  return x;
}
/** Compensated dot product for iterative refinement of poorly scaled equations. */
function preciseDot(a: number[], b: number[]) {
  let sum = 0, error = 0;
  for (let i = 0; i < a.length; i++) {
    const product = a[i] * b[i], next = sum + product;
    error += Math.abs(sum) >= Math.abs(product) ? (sum - next) + product : (product - next) + sum;
    const sa = 134217729 * a[i], sb = 134217729 * b[i], ah = sa - (sa - a[i]), bh = sb - (sb - b[i]), al = a[i] - ah, bl = b[i] - bh;
    error += ((ah * bh - product) + ah * bl + al * bh) + al * bl;
    sum = next;
  }
  return sum + error;
}
export function solveLinear(a: number[][], b: number[], refine = true): number[] {
  const n = b.length,
    m = a.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    const scale = 2 ** Math.floor(Math.log2(Math.max(...m[i].slice(0, n).map(Math.abs))));
    if (!(scale > 0) || !Number.isFinite(scale)) throw Error("Singular circuit: an equation has no finite coefficients.");
    for (let j = 0; j <= n; j++) m[i][j] /= scale;
  }
  const columns = Array.from({ length: n }, (_, j) => 2 ** Math.floor(Math.log2(Math.max(...m.map(row => Math.abs(row[j]))))));
  for (let j = 0; j < n; j++) {
    if (!(columns[j] > 0)) throw Error("Singular circuit: undefined circuit unknown.");
    for (let i = 0; i < n; i++) m[i][j] /= columns[j];
  }
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(m[i][k]) > Math.abs(m[pivot][k])) pivot = i;
    if (Math.abs(m[pivot][k]) <= Number.EPSILON * Math.max(1, n))
      throw Error(
        "Singular circuit: conflicting voltage sources or undefined ideal-source currents.",
      );
    [m[k], m[pivot]] = [m[pivot], m[k]];
    for (let i = k + 1; i < n; i++) {
      const f = m[i][k] / m[k][k];
      for (let j = k; j <= n; j++) m[i][j] -= f * m[k][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  for (let i = 0; i < n; i++) x[i] /= columns[i];
  if (refine && n && Math.max(...a.flat().map(Math.abs)) / Math.min(...a.flat().map(Math.abs).filter(v => v > 0)) > 1e6) {
    for (let iteration = 0; iteration < 2; iteration++) {
      const residual = b.map((v, i) => v - preciseDot(a[i], x));
      if (residual.every(v => v === 0)) break;
      const correction = solveLinear(a, residual, false);
      for (let i = 0; i < n; i++) x[i] += correction[i];
    }
  }
  if (x.some((v) => !Number.isFinite(v)))
    throw Error("Circuit solver produced a non-finite result.");
  for (let i = 0; i < n; i++) {
    const lhs = a[i].reduce((sum, v, j) => sum + v * x[j], 0), scale = Math.abs(b[i]) + a[i].reduce((sum, v, j) => sum + Math.abs(v * x[j]), 0);
    if (Math.abs(lhs - b[i]) > 256 * Number.EPSILON * Math.max(1, n) * scale) throw Error("Circuit numerical error: scaled equation residual is too large.");
  }
  return x;
}
