/** Dense real/complex solves and small matrix functions (exponential, Lyapunov) shared by the physical solvers. */
type Cx = [number, number];
/**
 * Complex Gaussian elimination with partial pivoting. Recent systems are memoised by their exact coefficients and
 * right-hand side (bitwise, Object.is): identical inputs give the identical solution, returned as a fresh copy. The
 * same small systems recur within a coupled step (an induction machine's midpoint system for its Thevenin stamp and
 * its readout; the harmonic networks of a drive's supply in every coupling iteration).
 */
export function solveComplex(a: Cx[][], b: Cx[]): Cx[] {
  const n = b.length, square = a.length === n && a.every((row) => row.length === n);
  if (!square) return solveComplexDirect(a, b);
  search: for (const entry of complexCache) {
    if (entry.n !== n) continue;
    const key = entry.key;
    for (let i = 0, k = 0; i < n; i++) {
      const row = a[i];
      for (let j = 0; j < n; j++, k += 2) if (!Object.is(row[j][0], key[k]) || !Object.is(row[j][1], key[k + 1])) continue search;
      if (!Object.is(b[i][0], key[k]) || !Object.is(b[i][1], key[k + 1])) continue search;
      k += 2;
    }
    return entry.x.map((v) => [v[0], v[1]] as Cx);
  }
  const x = solveComplexDirect(a, b), key = new Float64Array(2 * n * (n + 1));
  for (let i = 0, k = 0; i < n; i++) {
    for (let j = 0; j < n; j++, k += 2) { key[k] = a[i][j][0]; key[k + 1] = a[i][j][1]; }
    key[k] = b[i][0]; key[k + 1] = b[i][1]; k += 2;
  }
  complexCache[complexCacheNext] = { n, key, x: x.map((v) => [v[0], v[1]] as Cx) };
  complexCacheNext = (complexCacheNext + 1) % 16;
  return x;
}
const complexCache: { n: number; key: Float64Array; x: Cx[] }[] = [];
let complexCacheNext = 0;
function solveComplexDirect(a: Cx[][], b: Cx[]): Cx[] {
  // Augmented matrix as separate real and imaginary rows (columns 0…n−1 the matrix, n the right-hand side). Complex
  // arithmetic is written out: a·b = (a₀b₀ − a₁b₁, a₀b₁ + a₁b₀), a/b = ((a₀b₀ + a₁b₁)/d, (a₁b₀ − a₀b₁)/d) with
  // d = b₀² + b₁², |a| = hypot(a₀, a₁).
  const n = b.length, rows = a.length, re: Float64Array[] = new Array(rows), im: Float64Array[] = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const source = a[i], r = new Float64Array(n + 1), q = new Float64Array(n + 1);
    for (let j = 0; j < n; j++) { r[j] = source[j][0]; q[j] = source[j][1]; }
    if (i < n) { r[n] = b[i][0]; q[n] = b[i][1]; }
    re[i] = r; im[i] = q;
  }
  // Equilibrate rows and columns before choosing pivots: voltage/current equations use different units.
  for (let i = 0; i < n; i++) {
    const r = re[i], q = im[i];
    let scale = -Infinity;
    for (let j = 0; j < n; j++) scale = Math.max(scale, Math.hypot(r[j], q[j]));
    if (!(scale > 0) || !Number.isFinite(scale)) throw Error("Singular AC circuit: an equation has no finite coefficients.");
    for (let j = 0; j <= n; j++) { r[j] = r[j] / scale; q[j] = q[j] / scale; }
  }
  const columns = new Array<number>(n);
  for (let j = 0; j < n; j++) {
    let largest = -Infinity;
    for (let i = 0; i < rows; i++) largest = Math.max(largest, Math.hypot(re[i][j], im[i][j]));
    columns[j] = largest;
  }
  for (let j = 0; j < n; j++) {
    const column = columns[j];
    if (!(column > 0)) throw Error("Singular AC circuit: undefined circuit unknown.");
    for (let i = 0; i < n; i++) { re[i][j] = re[i][j] / column; im[i][j] = im[i][j] / column; }
  }
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.hypot(re[i][k], im[i][k]) > Math.hypot(re[pivot][k], im[pivot][k])) pivot = i;
    if (Math.hypot(re[pivot][k], im[pivot][k]) <= Number.EPSILON * Math.max(1, n)) throw Error("Singular AC circuit: conflicting sources or a floating node.");
    [re[k], re[pivot]] = [re[pivot], re[k]]; [im[k], im[pivot]] = [im[pivot], im[k]];
    const tr = re[k], tq = im[k], d = tr[k] * tr[k] + tq[k] * tq[k];
    for (let i = k + 1; i < n; i++) {
      const r = re[i], q = im[i];
      // f = m[i][k] / m[k][k]
      const f0 = (r[k] * tr[k] + q[k] * tq[k]) / d, f1 = (q[k] * tr[k] - r[k] * tq[k]) / d;
      // m[i][j] −= f·m[k][j]
      for (let j = k; j <= n; j++) { const p0 = f0 * tr[j] - f1 * tq[j], p1 = f0 * tq[j] + f1 * tr[j]; r[j] = r[j] - p0; q[j] = q[j] - p1; }
    }
  }
  const x: Cx[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const r = re[i], q = im[i];
    let s0 = r[n], s1 = q[n];
    for (let j = i + 1; j < n; j++) { const xj = x[j], p0 = r[j] * xj[0] - q[j] * xj[1], p1 = r[j] * xj[1] + q[j] * xj[0]; s0 = s0 - p0; s1 = s1 - p1; }
    const d = r[i] * r[i] + q[i] * q[i];
    x[i] = [(s0 * r[i] + s1 * q[i]) / d, (s1 * r[i] - s0 * q[i]) / d];
  }
  for (let i = 0; i < n; i++) x[i] = [x[i][0] / columns[i], x[i][1] / columns[i]];
  if (x.some((v) => !v.every(Number.isFinite))) throw Error("AC circuit solver produced a non-finite result.");
  for (let i = 0; i < n; i++) {
    const row = a[i];
    let l0 = 0, l1 = 0, terms = 0;
    for (let j = 0; j < row.length; j++) { const v = row[j], xj = x[j], p0 = v[0] * xj[0] - v[1] * xj[1], p1 = v[0] * xj[1] + v[1] * xj[0]; l0 = l0 + p0; l1 = l1 + p1; }
    for (let j = 0; j < row.length; j++) terms = terms + Math.hypot(row[j][0], row[j][1]) * Math.hypot(x[j][0], x[j][1]);
    const scale = Math.hypot(b[i][0], b[i][1]) + terms;
    if (Math.hypot(l0 - b[i][0], l1 - b[i][1]) > 256 * Number.EPSILON * Math.max(1, n) * scale) throw Error("AC circuit numerical error: scaled equation residual is too large.");
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
  const n = b.length, factor = cachedFactor(a, n), x = substituteLinear(factor, b);
  if (refine && n && coefficientSpread(factor, a) > 1e6) {
    for (let iteration = 0; iteration < 2; iteration++) {
      const residual = b.map((v, i) => v - preciseDot(a[i], x));
      if (residual.every(v => v === 0)) break;
      // The correction's right-hand side is rounding residual: bound it normwise; the refined x is checked below.
      // The matrix is unchanged, so its elimination is reused.
      const correction = substituteLinear(factor, residual);
      certifyLinear(a, residual, correction, true);
      for (let i = 0; i < n; i++) x[i] += correction[i];
    }
  }
  certifyLinear(a, b, x, normwise);
  return x;
}
/**
 * Equilibration and elimination of `solveLinear` for the matrix alone: power-of-two row scales, column scales, the
 * pivot of each column and the nonzero multipliers in elimination order. Replaying them on a right-hand side
 * (substituteLinear) performs exactly the operations of eliminating the augmented matrix.
 */
interface LinearFactor { n: number; m: Float64Array[]; scales: number[]; columns: number[]; pivots: number[]; multipliers: number[][]; spread?: number }
/** Ratio of the largest to the smallest nonzero coefficient magnitude of the factored matrix (it decides refinement). */
function coefficientSpread(factor: LinearFactor, a: number[][]) {
  if (factor.spread === undefined) {
    let maxCoefficient = 0, minCoefficient = Infinity;
    for (const row of a) for (const v of row) if (v !== 0) { maxCoefficient = Math.max(maxCoefficient, Math.abs(v)); minCoefficient = Math.min(minCoefficient, Math.abs(v)); }
    factor.spread = maxCoefficient / minCoefficient;
  }
  return factor.spread;
}
/**
 * Recently factored matrices with a copy of their coefficients. A matrix whose every coefficient is bitwise equal
 * (Object.is: signed zeros distinguished) to a cached one has exactly that factor, so the solves are unchanged. The
 * same network matrix recurs with new right-hand sides: the enthalpy transport's trial evaluations within a substep,
 * and thermal networks with constant coefficients from step to step. Small systems are factored directly.
 */
const FACTOR_CACHE_SIZE = 8, FACTOR_CACHE_MIN = 6;
const factorCache: { source: Float64Array; factor: LinearFactor }[] = [];
let factorCacheNext = 0;
function cachedFactor(a: number[][], n: number): LinearFactor {
  if (n < FACTOR_CACHE_MIN) return factorLinear(a, n);
  search: for (const entry of factorCache) {
    if (entry.factor.n !== n) continue;
    const source = entry.source;
    for (let i = 0, k = 0; i < n; i++) {
      const row = a[i];
      if (row.length !== n) return factorLinear(a, n);
      for (let j = 0; j < n; j++, k++) if (!Object.is(row[j], source[k])) continue search;
    }
    return entry.factor;
  }
  const factor = factorLinear(a, n), source = new Float64Array(n * n);
  for (let i = 0, k = 0; i < n; i++) for (let j = 0; j < n; j++, k++) source[k] = a[i][j];
  factorCache[factorCacheNext] = { source, factor };
  factorCacheNext = (factorCacheNext + 1) % FACTOR_CACHE_SIZE;
  return factor;
}
function factorLinear(a: number[][], n: number): LinearFactor {
  // Working rows in double storage (the same IEEE arithmetic as number arrays, without element-kind transitions).
  const m: Float64Array[] = new Array(n), scales = new Array<number>(n), pivots = new Array<number>(n), multipliers: number[][] = [];
  for (let i = 0; i < n; i++) { const row = new Float64Array(n), source = a[i]; for (let j = 0; j < n; j++) row[j] = source[j]; m[i] = row; }
  for (let i = 0; i < n; i++) {
    const row = m[i];
    let largest = 0;
    for (let j = 0; j < n; j++) largest = Math.max(largest, Math.abs(row[j]));
    const scale = 2 ** Math.floor(Math.log2(largest));
    if (!(scale > 0) || !Number.isFinite(scale)) throw Error("Singular circuit: an equation has no finite coefficients.");
    for (let j = 0; j < n; j++) row[j] /= scale;
    scales[i] = scale;
  }
  const columns = new Array<number>(n);
  for (let j = 0; j < n; j++) {
    let largest = 0;
    for (let i = 0; i < n; i++) largest = Math.max(largest, Math.abs(m[i][j]));
    columns[j] = 2 ** Math.floor(Math.log2(largest));
  }
  for (let j = 0; j < n; j++) {
    const column = columns[j];
    if (!(column > 0)) throw Error("Singular circuit: undefined circuit unknown.");
    for (let i = 0; i < n; i++) m[i][j] /= column;
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
    pivots[k] = pivot;
    const top = m[k], steps: number[] = [];
    for (let i = k + 1; i < n; i++) {
      const row = m[i], f = row[k] / top[k];
      if (f === 0) continue; // circuit matrices are sparse
      for (let j = k; j < n; j++) row[j] -= f * top[j];
      steps.push(i, f);
    }
    multipliers.push(steps);
  }
  return { n, m, scales, columns, pivots, multipliers };
}
/** Solution for one right-hand side from a factor: the right-hand-side column of the augmented elimination, then back substitution. */
function substituteLinear({ n, m, scales, columns, pivots, multipliers }: LinearFactor, b: number[]): number[] {
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = b[i] / scales[i];
  for (let k = 0; k < n; k++) {
    const pivot = pivots[k];
    [r[k], r[pivot]] = [r[pivot], r[k]];
    const top = r[k], steps = multipliers[k];
    for (let s = 0; s < steps.length; s += 2) r[steps[s]] -= steps[s + 1] * top;
  }
  const y = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const row = m[i];
    let s = r[i];
    for (let j = i + 1; j < n; j++) s -= row[j] * y[j];
    y[i] = s / row[i];
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = y[i] / columns[i];
  return x;
}
/** Finite result and scaled equation residual of `solveLinear`. */
function certifyLinear(a: number[][], b: number[], x: number[], normwise: boolean) {
  const n = b.length;
  if (x.some((v) => !Number.isFinite(v)))
    throw Error("Circuit solver produced a non-finite result.");
  let magnitude = 0;
  if (normwise) for (let j = 0; j < n; j++) magnitude = Math.max(magnitude, Math.abs(x[j]));
  for (let i = 0; i < n; i++) {
    const row = a[i];
    let lhs = 0, scale = Math.abs(b[i]);
    for (let j = 0; j < n; j++) { lhs += row[j] * x[j]; scale += Math.abs(row[j]) * (normwise ? magnitude : Math.abs(x[j])); }
    if (Math.abs(lhs - b[i]) > 256 * Number.EPSILON * Math.max(1, n) * scale) throw Error("Circuit numerical error: scaled equation residual is too large.");
  }
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
