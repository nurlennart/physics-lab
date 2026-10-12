/** Dense real/complex solves and small matrix functions (exponential, Lyapunov) shared by the physical solvers. */
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
export function preciseDot(a: number[], b: number[]) {
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
/**
 * Gaussian elimination with equilibration, partial pivoting and bounded refinement. The scaled residual of every
 * equation is checked componentwise (relative to that equation's own terms). `normwise` instead bounds it by the
 * equation's coefficients times ‖x‖∞: for sensitivity solves of homogeneous systems, where an exact zero is
 * computed as rounding noise.
 */
export function solveLinear(a: number[][], b: number[], refine = true, normwise = false): number[] {
  const n = b.length,
    m = a.map((r, i) => [...r, b[i]]);
  const largest = (values: (j: number) => number) => { let max = 0; for (let j = 0; j < n; j++) max = Math.max(max, Math.abs(values(j))); return max; };
  for (let i = 0; i < n; i++) {
    const scale = 2 ** Math.floor(Math.log2(largest((j) => m[i][j])));
    if (!(scale > 0) || !Number.isFinite(scale)) throw Error("Singular circuit: an equation has no finite coefficients.");
    for (let j = 0; j <= n; j++) m[i][j] /= scale;
  }
  const columns = Array.from({ length: n }, (_, j) => 2 ** Math.floor(Math.log2(largest((i) => m[i][j]))));
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
      if (f === 0) continue; // circuit matrices are sparse
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
  let maxCoefficient = 0, minCoefficient = Infinity;
  for (const row of a) for (const v of row) if (v !== 0) { maxCoefficient = Math.max(maxCoefficient, Math.abs(v)); minCoefficient = Math.min(minCoefficient, Math.abs(v)); }
  if (refine && n && maxCoefficient / minCoefficient > 1e6) {
    for (let iteration = 0; iteration < 2; iteration++) {
      const residual = b.map((v, i) => v - preciseDot(a[i], x));
      if (residual.every(v => v === 0)) break;
      // The correction's right-hand side is rounding residual: bound it normwise; the refined x is checked below.
      const correction = solveLinear(a, residual, false, true);
      for (let i = 0; i < n; i++) x[i] += correction[i];
    }
  }
  if (x.some((v) => !Number.isFinite(v)))
    throw Error("Circuit solver produced a non-finite result.");
  const magnitude = normwise ? largest((j) => x[j]) : 0;
  for (let i = 0; i < n; i++) {
    let lhs = 0, scale = Math.abs(b[i]);
    for (let j = 0; j < n; j++) { lhs += a[i][j] * x[j]; scale += Math.abs(a[i][j]) * (normwise ? magnitude : Math.abs(x[j])); }
    if (Math.abs(lhs - b[i]) > 256 * Number.EPSILON * Math.max(1, n) * scale) throw Error("Circuit numerical error: scaled equation residual is too large.");
  }
  return x;
}
function matmul(a: number[][], b: number[][]) {
  const n = a.length, m = b[0].length, inner = b.length, c = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) for (let k = 0; k < inner; k++) {
    const aik = a[i][k];
    if (aik === 0) continue;
    const bk = b[k], ci = c[i];
    for (let j = 0; j < m; j++) ci[j] += aik * bk[j];
  }
  return c;
}
/**
 * Gaussian elimination for all columns of B at once: power-of-two row and column equilibration, partial pivoting.
 * For the matrix functions of the storage step (Padé denominator, Lyapunov system); no residual certificate.
 */
function solveColumns(a: number[][], b: number[][]) {
  const n = a.length, m = b[0].length, lhs = a.map((row) => [...row]), rhs = b.map((row) => [...row]);
  const power = (v: number) => (v > 0 && Number.isFinite(v) ? 2 ** Math.floor(Math.log2(v)) : 1);
  for (let i = 0; i < n; i++) {
    let largest = 0;
    for (let j = 0; j < n; j++) largest = Math.max(largest, Math.abs(lhs[i][j]));
    const scale = power(largest);
    for (let j = 0; j < n; j++) lhs[i][j] /= scale;
    for (let j = 0; j < m; j++) rhs[i][j] /= scale;
  }
  const columns = Array.from({ length: n }, (_, j) => { let largest = 0; for (let i = 0; i < n; i++) largest = Math.max(largest, Math.abs(lhs[i][j])); return power(largest); });
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) lhs[i][j] /= columns[j];
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(lhs[i][k]) > Math.abs(lhs[pivot][k])) pivot = i;
    if (!(Math.abs(lhs[pivot][k]) > 0)) throw Error("Singular matrix in a storage step.");
    [lhs[k], lhs[pivot]] = [lhs[pivot], lhs[k]]; [rhs[k], rhs[pivot]] = [rhs[pivot], rhs[k]];
    for (let i = k + 1; i < n; i++) {
      const f = lhs[i][k] / lhs[k][k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) lhs[i][j] -= f * lhs[k][j];
      for (let j = 0; j < m; j++) rhs[i][j] -= f * rhs[k][j];
    }
  }
  for (let i = n - 1; i >= 0; i--) for (let j = 0; j < m; j++) {
    let sum = rhs[i][j];
    for (let k = i + 1; k < n; k++) sum -= lhs[i][k] * rhs[k][j];
    rhs[i][j] = sum / lhs[i][i];
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) rhs[i][j] /= columns[i];
  if (rhs.some((row) => row.some((v) => !Number.isFinite(v)))) throw Error("Singular matrix in a storage step.");
  return rhs;
}
const combine = (terms: [number, number[][]][]) => terms[0][1].map((row, i) => row.map((_, j) => terms.reduce((sum, [f, m]) => sum + f * m[i][j], 0)));
/**
 * Matrix exponential e^M by scaling and squaring with the [13/13] Padé approximant (Higham 2005): accurate to
 * rounding for any norm, including stiff matrices whose fast modes decay completely within the interval.
 */
export function expm(m: number[][]): number[][] {
  const n = m.length, identity = m.map((_, i) => m.map((_, j) => (i === j ? 1 : 0)));
  if (!n) return [];
  const norm = Math.max(...m[0].map((_, j) => m.reduce((sum, row) => sum + Math.abs(row[j]), 0)));
  const squarings = Math.max(0, Math.ceil(Math.log2(norm / 5.371920351148152)));
  const a = m.map((row) => row.map((v) => v / 2 ** squarings));
  const b = [64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000, 10559470521600, 670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1];
  const a2 = matmul(a, a), a4 = matmul(a2, a2), a6 = matmul(a4, a2);
  const u = matmul(a, combine([[1, matmul(a6, combine([[b[13], a6], [b[11], a4], [b[9], a2]]))], [b[7], a6], [b[5], a4], [b[3], a2], [b[1], identity]]));
  const v = combine([[1, matmul(a6, combine([[b[12], a6], [b[10], a4], [b[8], a2]]))], [b[6], a6], [b[4], a4], [b[2], a2], [b[0], identity]]);
  // The Padé denominator V − U is well conditioned for ‖M/2ˢ‖₁ ≤ θ₁₃ (Higham 2005).
  let result = solveColumns(combine([[1, v], [-1, u]]), combine([[1, v], [1, u]]));
  for (let k = 0; k < squarings; k++) result = matmul(result, result);
  return result;
}
/** Symmetric solution W of the Lyapunov equation A·W + W·Aᵀ = R (A Hurwitz, R symmetric), over the n(n+1)/2 unknowns. */
export function solveLyapunov(a: number[][], r: number[][]): number[][] {
  const n = a.length, pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) pairs.push([i, j]);
  const index = (i: number, j: number) => { const [p, q] = i <= j ? [i, j] : [j, i]; return p * n - (p * (p - 1)) / 2 + (q - p); };
  const matrix = pairs.map(() => Array(pairs.length).fill(0));
  pairs.forEach(([i, j], row) => {
    for (let k = 0; k < n; k++) { matrix[row][index(k, j)] += a[i][k]; matrix[row][index(i, k)] += a[j][k]; }
  });
  const w = solveColumns(matrix, pairs.map(([i, j]) => [r[i][j]])).map((row) => row[0]);
  return a.map((_, i) => a.map((_, j) => w[index(i, j)]));
}
