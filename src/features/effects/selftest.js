// Compares the WebGL shaders with the JavaScript reference (run.js) on a test picture. Used by the UI test.
// Effects and transitions built on pseudo-random noise differ in detail between GPU and CPU maths, so for them
// only the average brightness is compared.
import { FX_TRANSITIONS, PIXEL_EFFECTS } from './catalog.js';
import { fxGL } from './gl.js';
import { runEffect, runTransition } from './run.js';

// Expressions using hash() (pseudo random) drift between float32 shaders and float64 JavaScript.
const noisy = (expr) => expr.includes('hash(');

function pattern(W, H, seed) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    d[i] = (x * 255) / W;
    d[i + 1] = (y * 255) / H;
    d[i + 2] = (((x >> 3) + (y >> 3) + seed) % 2) * 200 + 30;
    d[i + 3] = 255;
  }
  return d;
}

function diff(a, b) {
  let sum = 0;
  let far = 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      m = Math.max(m, Math.abs(a[i + c] - b[i + c]));
      meanA += a[i + c];
      meanB += b[i + c];
    }
    sum += m;
    if (m > 40) far++;
  }
  const n = a.length / 4;
  return { mean: sum / n, far: far / n, avg: Math.abs(meanA - meanB) / (n * 3) };
}

export function fxSelfTest() {
  const W = 320;
  const H = 180;
  const A = pattern(W, H, 0);
  const B = pattern(W, H, 1).map((v, i) => (i % 4 === 3 ? 255 : 255 - v));
  const gl = fxGL();
  const res = {};
  for (const t of FX_TRANSITIONS) {
    for (const P of [0.25, 0.5, 0.75]) {
      gl.transition({ data: A }, { data: B }, W, H, P, t.expr);
      const r = diff(gl.read(W, H), runTransition(A, B, new Uint8ClampedArray(A.length), W, H, P, t.expr));
      res[`${t.id}@${P}`] = noisy(t.expr) ? { ...r, noisy: true } : r;
    }
  }
  for (const e of PIXEL_EFFECTS) {
    for (const T of [0.05, 0.4, 1.3]) {
      gl.effects({ data: A }, W, H, [{ expr: e.expr, T }]);
      const r = diff(gl.read(W, H), runEffect(A, new Uint8ClampedArray(A.length), W, H, T, e.expr));
      res[`${e.id}@${T}`] = noisy(e.expr) ? { ...r, noisy: true } : r;
    }
  }
  const failed = Object.entries(res).filter(([, r]) => (r.noisy ? r.avg > 12 : r.mean > 3 || r.far > 0.01)).map(([k]) => k);
  return { failed, res };
}
