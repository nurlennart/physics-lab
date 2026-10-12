/** Dense real/complex solves and a small symmetric eigen-decomposition shared by the physical solvers. */
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
/**
 * Gaussian elimination with equilibration, partial pivoting and bounded refinement. The scaled residual of every
 * equation is checked componentwise (relative to that equation's own terms). `normwise` instead bounds it by the
 * equation's coefficients times ‖x‖∞: for sensitivity solves of homogeneous systems, where an exact zero is
 * computed as rounding noise.
 */
export function solveLinear(a: number[][], b: number[], refine = true, normwise = false): number[] {
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
      const correction = solveLinear(a, residual, false, normwise);
      for (let i = 0; i < n; i++) x[i] += correction[i];
    }
  }
  if (x.some((v) => !Number.isFinite(v)))
    throw Error("Circuit solver produced a non-finite result.");
  const magnitude = normwise ? Math.max(0, ...x.map(Math.abs)) : 0;
  for (let i = 0; i < n; i++) {
    const lhs = a[i].reduce((sum, v, j) => sum + v * x[j], 0), scale = Math.abs(b[i]) + a[i].reduce((sum, v, j) => sum + Math.abs(v) * (normwise ? magnitude : Math.abs(x[j])), 0);
    if (Math.abs(lhs - b[i]) > 256 * Number.EPSILON * Math.max(1, n) * scale) throw Error("Circuit numerical error: scaled equation residual is too large.");
  }
  return x;
}
/**
 * Eigen-decomposition a = V·diag(values)·Vᵀ of a small symmetric matrix by cyclic Jacobi rotations (accurate to
 * rounding relative to the matrix norm; columns of `vectors` are orthonormal eigenvectors).
 */
export function symmetricEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length, m = a.map((row) => [...row]), v = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  const norm = Math.hypot(...m.flat());
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] ** 2;
    if (Math.sqrt(off) <= Number.EPSILON * norm) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (m[p][q] === 0) continue;
        // Rotation J with tan φ = t annihilates m[p][q]: m ← Jᵀ·m·J, v ← v·J.
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]), t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.hypot(theta, 1));
        const c = 1 / Math.hypot(t, 1), s = t * c;
        for (const x of [m, v]) for (let k = 0; k < n; k++) { const kp = x[k][p], kq = x[k][q]; x[k][p] = c * kp - s * kq; x[k][q] = s * kp + c * kq; }
        for (let k = 0; k < n; k++) { const pk = m[p][k], qk = m[q][k]; m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk; }
      }
  }
  return { values: m.map((row, i) => row[i]), vectors: v };
}
