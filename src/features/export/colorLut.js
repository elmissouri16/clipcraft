// Colour-only looks as a 3D LUT for the export.
//
// A filter, a LUT and the Adjust settings change each pixel from its own colour
// alone. Sending every frame of such a clip through the GPU (decode → interface →
// WebGL → back → lossless file) made a graded export about 15× slower than a plain
// one. A colour-only look is fully described by what it does to every colour, so it
// is baked once into a 3D LUT with the very same shaders and FFmpeg applies it
// (lut3d) during the normal encode.
//
// Not every colour-only look survives the bake: a LUT interpolates between its
// lattice points, so hard steps (posterize) would soften. Every bake is therefore
// checked against the exact shader on 65,536 colours between the lattice points,
// and a look that differs visibly keeps the frame-by-frame GPU path.
import { parse } from '../effects/expr.js';

// 255 = 85 × 3: every lattice point is an exact 8-bit value, so the shader sees
// the same input colours a frame would give it.
export const LUT_SIZE = 86;
// Accepted difference from the exact shader, in 8-bit levels.
export const LUT_TOLERANCE = { p999: 2, max: 6 };

const SAMPLERS = new Set(['S', 'L', 'PR', 'PG', 'PB']);
const at = (args) => args.length === 2 && args[0].k === 'var' && args[0].v === 'X' && args[1].k === 'var' && args[1].v === 'Y';

// True when an expression reads only the colour of the pixel it writes: every
// sample is at (X, Y), and nothing uses the position, size, time or noise.
export function colorOnlyExpr(src) {
  let ast;
  try { ast = parse(src); } catch { return false; }
  const ok = (n) => {
    switch (n.k) {
      case 'num': return true;
      case 'var': return n.v === 'PI' || n.v === 'E';
      case 'neg': return ok(n.a);
      case 'bin': case 'seq': return ok(n.a) && ok(n.b);
      case 'call':
        if (SAMPLERS.has(n.f)) return at(n.args);
        if (n.f === 'hash' || n.f === 'A' || n.f === 'B') return false;
        return n.args.every(ok);
      default: return false;
    }
  };
  return ok(ast);
}

// Shader passes ({ expr, T } | { lut, K }) that a LUT can stand for.
export function colorOnlyPasses(passes) {
  return passes.length > 0 && passes.every((p) => (p.lut ? !p.key && !p.expr
    : !p.key && typeof p.expr === 'string' && colorOnlyExpr(p.expr)));
}

// Colours laid out on a strip image, `width` pixels per row.
function strip(colors, width) {
  const height = Math.ceil(colors.length / 3 / width);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = colors.length / 3; i < n; i++) {
    data[i * 4] = colors[i * 3]; data[i * 4 + 1] = colors[i * 3 + 1]; data[i * 4 + 2] = colors[i * 3 + 2]; data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}
function shade(gl, colors, passes) {
  const { data, width, height } = strip(colors, 1024);
  gl.effects({ data }, width, height, passes.map((p) => ({ ...p, T: 0 })));
  const px = gl.read(width, height), n = colors.length / 3, out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = px[i * 4]; out[i * 3 + 1] = px[i * 4 + 1]; out[i * 3 + 2] = px[i * 4 + 2]; }
  return out;
}

// Tetrahedral interpolation (as FFmpeg's lut3d interp=tetrahedral) of an 8-bit colour.
export function applyLut(table, size, r, g, b) {
  const s = (size - 1) / 255, x = r * s, y = g * s, z = b * s;
  const x0 = Math.min(size - 1, Math.floor(x)), y0 = Math.min(size - 1, Math.floor(y)), z0 = Math.min(size - 1, Math.floor(z));
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1), z1 = Math.min(size - 1, z0 + 1);
  const dr = x - x0, dg = y - y0, db = z - z0;
  const c = (i, j, k, ch) => table[((k * size + j) * size + i) * 3 + ch];
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c000 = c(x0, y0, z0, ch), c111 = c(x1, y1, z1, ch);
    let v;
    if (dr > dg) {
      if (dg > db) v = (1 - dr) * c000 + (dr - dg) * c(x1, y0, z0, ch) + (dg - db) * c(x1, y1, z0, ch) + db * c111;
      else if (dr > db) v = (1 - dr) * c000 + (dr - db) * c(x1, y0, z0, ch) + (db - dg) * c(x1, y0, z1, ch) + dg * c111;
      else v = (1 - db) * c000 + (db - dr) * c(x0, y0, z1, ch) + (dr - dg) * c(x1, y0, z1, ch) + dg * c111;
    } else if (db > dg) v = (1 - db) * c000 + (db - dg) * c(x0, y0, z1, ch) + (dg - dr) * c(x0, y1, z1, ch) + dr * c111;
    else if (db > dr) v = (1 - dg) * c000 + (dg - db) * c(x0, y1, z0, ch) + (db - dr) * c(x0, y1, z1, ch) + dr * c111;
    else v = (1 - dg) * c000 + (dg - dr) * c(x0, y1, z0, ch) + (dr - db) * c(x1, y1, z0, ch) + db * c111;
    out[ch] = v;
  }
  return out;
}

// Colours between the lattice points (and the extremes) for the check.
function probeColors(n = 65536) {
  const colors = new Uint8Array(n * 3);
  let seed = 0x2f6b1d;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
  for (let i = 0; i < n * 3; i++) colors[i] = next();
  const corners = [0, 255];
  let i = 0;
  for (const r of corners) for (const g of corners) for (const b of corners) { colors.set([r, g, b], i * 3); i++; }
  return colors;
}

// The difference between the LUT and the exact shader on the probe colours.
export function lutError(table, size, colors, exact) {
  const errors = new Float32Array(colors.length / 3);
  let max = 0;
  for (let i = 0; i < errors.length; i++) {
    const v = applyLut(table, size, colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
    const e = Math.max(...v.map((x, ch) => Math.abs(Math.round(x) - exact[i * 3 + ch])));
    errors[i] = e; if (e > max) max = e;
  }
  const sorted = errors.slice().sort();
  return { max, p999: sorted[Math.floor(sorted.length * 0.999)], mean: errors.reduce((a, b) => a + b, 0) / errors.length };
}

const tables = new Map();
const lutTokens = new WeakMap();
let lutCount = 0;
const lutToken = (lut) => { if (!lutTokens.has(lut)) lutTokens.set(lut, ++lutCount); return lutTokens.get(lut); };
// Bakes the passes into a size³ RGB table (red fastest), checked against the
// exact shader. Returns { table, size, error } or null when the LUT would differ.
export function bakeColorLut(gl, passes, size = LUT_SIZE) {
  if (!colorOnlyPasses(passes)) return null;
  // Every LUT object of the pass list is part of the key (a LUT's name or size says nothing
  // about its contents): two lists that agree on their first LUT but differ later, or a LUT
  // reloaded with other contents, never share a table.
  const key = JSON.stringify(passes.map((p) => (p.lut ? { lut: lutToken(p.lut), K: p.K } : p.expr)));
  const memo = tables.get(key);
  if (memo) return memo.result;
  const step = 255 / (size - 1), lattice = new Uint8Array(size ** 3 * 3);
  for (let b = 0, i = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++, i += 3) {
    lattice[i] = Math.round(r * step); lattice[i + 1] = Math.round(g * step); lattice[i + 2] = Math.round(b * step);
  }
  const table = shade(gl, lattice, passes);
  const colors = probeColors();
  const error = lutError(table, size, colors, shade(gl, colors, passes));
  const result = error.p999 <= LUT_TOLERANCE.p999 && error.max <= LUT_TOLERANCE.max ? { table, size, error } : null;
  tables.set(key, { result });
  if (tables.size > 8) tables.delete(tables.keys().next().value);
  return result;
}
