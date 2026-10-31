// Runs compiled effect / transition expressions on RGBA pixel buffers (the preview's side of expr.js).
// Sampling is nearest-pixel with clamped coordinates, like the export (geq interpolation=nearest, xfade custom).
import { compile, parse } from './expr.js';

const cache = new Map();
export function compiled(src) {
  let fn = cache.get(src);
  if (!fn) {
    fn = compile(parse(src));
    cache.set(src, fn);
  }
  return fn;
}

const at = (buf, W, H, x, y, ch) => {
  const xi = Math.trunc(Math.min(Math.max(x, 0), W - 1));
  const yi = Math.trunc(Math.min(Math.max(y, 0), H - 1));
  return buf[(yi * W + xi) * 4 + ch];
};
const put = (v) => (v !== v ? 0 : v < 0 ? 0 : v > 255 ? 255 : Math.round(v)); // NaN -> 0

// Effect: out = expr over src at clip time T. Buffers are RGBA, W x H.
export function runEffect(src, out, W, H, T, exprSrc) {
  const fn = compiled(exprSrc);
  const env = { X: 0, Y: 0, W, H, T, P: 0, ch: 0, reg: [], S: null, L: null };
  for (let ch = 0; ch < 3; ch++) {
    env.ch = ch;
    env.S = (x, y) => at(src, W, H, x, y, ch);
    env.L = (x, y) => 0.299 * at(src, W, H, x, y, 0) + 0.587 * at(src, W, H, x, y, 1) + 0.114 * at(src, W, H, x, y, 2);
    for (let y = 0; y < H; y++) {
      env.Y = y;
      for (let x = 0; x < W; x++) {
        env.X = x;
        out[(y * W + x) * 4 + ch] = put(fn(env));
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = src[i];
  return out;
}

// Transition: out = expr mixing a (outgoing) and b (incoming) at progress P (0..1).
export function runTransition(a, b, out, W, H, P, exprSrc) {
  const fn = compiled(exprSrc);
  const env = { X: 0, Y: 0, W, H, T: 0, P, ch: 0, reg: [], A: null, B: null };
  for (let ch = 0; ch < 3; ch++) {
    env.ch = ch;
    env.A = (x, y) => at(a, W, H, x, y, ch);
    env.B = (x, y) => at(b, W, H, x, y, ch);
    for (let y = 0; y < H; y++) {
      env.Y = y;
      for (let x = 0; x < W; x++) {
        env.X = x;
        out[(y * W + x) * 4 + ch] = put(fn(env));
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}
