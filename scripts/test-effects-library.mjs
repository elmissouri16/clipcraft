// Effects library proof: the catalogue is big (>=100), every group is deep (>=8), and NO tile is a
// rename of an identical render. Every pixel effect is CPU-rendered on a rich test chart and must
// (a) visibly change the picture and (b) be pairwise-distinct from every other pixel effect by direct
// pixel distance. Every overlay effect is drawn against a recording 2D context and must paint
// real ops with a pairwise-distinct ink signature (spatial histogram + op count + styles used — colour
// IS a visual difference, so the styles an overlay paints with are part of its signature).
// Usage: node scripts/test-effects-library.mjs
import assert from 'node:assert/strict';
import { EFFECTS, EFFECT_GROUPS } from '../src/effects.js';
import { PIXEL_EFFECTS, OVERLAY_EFFECTS } from '../src/fx/catalog.js';
import { runEffect } from '../src/fx/run.js';

// ---- Catalogue size + group depth ----
assert.ok(EFFECTS.length >= 100, `library has ${EFFECTS.length} effects, expected >= 100`);
const byGroup = new Map();
for (const e of EFFECTS) {
  assert.ok(EFFECT_GROUPS.includes(e.group), `${e.id} group '${e.group}' is a real group`);
  byGroup.set(e.group, (byGroup.get(e.group) || 0) + 1);
}
for (const g of EFFECT_GROUPS) assert.ok((byGroup.get(g) || 0) >= 8, `group '${g}' has ${byGroup.get(g) || 0} effects, expected >= 8`);
assert.equal(new Set(EFFECTS.map((e) => e.id)).size, EFFECTS.length, 'effect ids unique');
assert.equal(new Set(EFFECTS.map((e) => e.name)).size, EFFECTS.length, 'effect names unique');

// Every listed effect resolves to a real renderer.
const pixelIds = new Set(PIXEL_EFFECTS.map((e) => e.id));
const overlayIds = new Set(OVERLAY_EFFECTS.map((e) => e.id));
for (const e of EFFECTS) {
  if (e.kind === 'pixel') assert.ok(pixelIds.has(e.id), `${e.id} resolves to a pixel effect`);
  else if (e.kind === 'overlay') assert.ok(overlayIds.has(e.id), `${e.id} resolves to an overlay effect`);
}

// ---- Rich asymmetric source: a test chart, not noise. Smooth correlated regions + sharp edges at
// cell sizes comparable to the effect offsets — on pure noise every small translation is statistically
// identical, which would fake collisions between genuinely different shift strengths. Rendered at
// 192x108: mosaic cell counts are resolution-relative, and at 96 wide the finest mosaic is sub-2px. ----
const W = 192;
const H = 108;
const src = new Uint8ClampedArray(W * H * 4);
const cell = Math.round(W / 16);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  let r = 40 + x * 0.9 + y * 0.35, g = 200 - x * 0.55 + y * 0.45, b = 90 + y * 1.2 - x * 0.25;
  const blob = Math.max(0, 1 - Math.hypot(x - W / 4, y - H * 0.3) / (W / 5)); // soft plate, left
  r += blob * 120; g += blob * 40; b -= blob * 30;
  if (x >= W * 0.58) { const c = ((x - W * 0.58) / cell | 0) + (y / cell | 0); if (c % 2) { r = 235; g = 30; b = 60; } else { r = 25; g = 210; b = 225; } } // checkerboard, right
  if (y >= H * 0.7 && y < H * 0.85) { const s = (x / (W / 24) | 0) % 2; r = s ? 245 : 35; g = s ? 225 : 45; b = s ? 60 : 190; } // stripe band
  src[i] = Math.max(0, Math.min(255, r)); src[i + 1] = Math.max(0, Math.min(255, g)); src[i + 2] = Math.max(0, Math.min(255, b)); src[i + 3] = 255;
}
const meanAbsDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

// ---- Pixel effects: change the picture + pairwise distinct ----
// Sampled at two fixed probe times (0.6s and 1.5s, the test-fx convention); each effect is represented
// by its more active probe — a slow drift or a rolling band is legitimately near-still at some instants.
// Distinctness is a DIRECT pixel distance between renders: block statistics wash out exactly the
// differences that matter here (a 1px channel fringe along an edge is a real, visible difference
// between e.g. horizontal and vertical RGB splits, and it vanishes in block means).
const renders = new Map();
for (const e of PIXEL_EFFECTS) {
  const outs = [0.6, 1.5].map((T) => runEffect(src, new Uint8ClampedArray(src.length), W, H, T, e.expr));
  const changes = outs.map((o) => meanAbsDiff(o, src));
  const best = changes[0] >= changes[1] ? 0 : 1;
  assert.ok(changes[best] > 1.0, `${e.id} barely changes the picture (mean abs diff ${changes[best].toFixed(2)} at its best probe)`);
  renders.set(e.id, outs[best]);
}
let minPair = { d: Infinity, pair: '' };
const ids = [...renders.keys()];
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const d = meanAbsDiff(renders.get(ids[i]), renders.get(ids[j]));
  if (d < minPair.d) minPair = { d, pair: `${ids[i]} vs ${ids[j]}` };
  assert.ok(d > 0.35, `${ids[i]} and ${ids[j]} render near-identically (mean abs diff ${d.toFixed(3)})`);
}

// ---- Overlay effects: real paint ops + pairwise distinct ink ----
function recordingCtx() {
  const ops = [];
  const styles = new Set();
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: { width: W, height: H },
    ops, styles,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo(x, y) { ops.push(['m', x, y]); }, lineTo(x, y) { ops.push(['l', x, y]); },
    quadraticCurveTo() {}, bezierCurveTo() {},
    arc(x, y, r) { ops.push(['a', x, y, r]); }, ellipse(x, y, rx, ry) { ops.push(['a', x, y, Math.max(rx, ry)]); },
    rect(x, y, w, h) { ops.push(['r', x, y, Math.max(w, h)]); },
    fillRect(x, y, w, h) { ops.push(['r', x, y, Math.max(w, h)]); },
    strokeRect(x, y, w, h) { ops.push(['r', x, y, Math.max(w, h)]); },
    clearRect() {}, fill() { ops.push(['f']); }, stroke() { ops.push(['s']); },
    fillText() { ops.push(['t']); },
    translate() {}, rotate() {}, scale() {}, setLineDash() {},
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
  };
  for (const prop of ['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineCap', 'lineJoin', 'shadowBlur', 'shadowColor', 'filter', 'font']) {
    let v;
    Object.defineProperty(ctx, prop, { get: () => v, set: (nv) => { v = nv; if (typeof nv === 'string') styles.add(nv); } });
  }
  return ctx;
}
const inkSignature = (ctx) => {
  const grid = new Array(48).fill(0);
  let shapes = 0;
  for (const op of ctx.ops) {
    if (op[0] === 'a' || op[0] === 'r') {
      shapes++;
      const bx = Math.min(7, Math.max(0, Math.floor((op[1] / W) * 8)));
      const by = Math.min(5, Math.max(0, Math.floor((op[2] / H) * 6)));
      grid[by * 8 + bx] += 1 + Math.min(3, (op[3] || 0) / 6);
    }
  }
  return { grid, shapes, ops: ctx.ops.length, styles: [...ctx.styles].sort().join('|') };
};
const inkDist = (a, b) => {
  let d = 0; for (let i = 0; i < 48; i++) d += Math.abs(a.grid[i] - b.grid[i]);
  return d / 48 + Math.abs(Math.log(1 + a.ops) - Math.log(1 + b.ops)) * 4 + (a.styles === b.styles ? 0 : 6);
};
const inks = new Map();
for (const o of OVERLAY_EFFECTS) {
  const ctx = recordingCtx();
  o.draw(ctx, W, H, 2.3);
  assert.ok(ctx.ops.length > 0, `${o.id} paints nothing`);
  inks.set(o.id, inkSignature(ctx));
}
const oids = [...inks.keys()];
let minInk = { d: Infinity, pair: '' };
for (let i = 0; i < oids.length; i++) for (let j = i + 1; j < oids.length; j++) {
  const d = inkDist(inks.get(oids[i]), inks.get(oids[j]));
  if (d < minInk.d) minInk = { d, pair: `${oids[i]} vs ${oids[j]}` };
  assert.ok(d > 1.2, `${oids[i]} and ${oids[j]} paint near-identically (ink distance ${d.toFixed(2)})`);
}

console.log(`EFFECTS LIBRARY OK — ${EFFECTS.length} effects (${[...byGroup.entries()].map(([g, n]) => `${g} ${n}`).join(' · ')})`);
console.log(`pixel: ${PIXEL_EFFECTS.length} rendered, closest pair ${minPair.pair} at mean abs diff ${minPair.d.toFixed(3)}`);
console.log(`overlay: ${OVERLAY_EFFECTS.length} drawn, closest pair ${minInk.pair} at ink distance ${minInk.d.toFixed(2)}`);
