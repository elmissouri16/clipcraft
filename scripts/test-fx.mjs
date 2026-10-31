// Every animated effect and transition: the expression parses, builds a WebGL shader source, and the CPU
// reference gives sane pictures (finite, changes over time / progress). The GPU side is checked by the
// FVE_SMOKE_MODE=fx UI test. Usage: node scripts/test-fx.mjs
import assert from 'node:assert/strict';
import { FX_TRANSITIONS, OVERLAY_EFFECTS, PIXEL_EFFECTS } from '../src/fx/catalog.js';
import { parse } from '../src/fx/expr.js';
import { shaderSource } from '../src/fx/gl.js';
import { runEffect, runTransition } from '../src/fx/run.js';

const W = 96;
const H = 54;
const pic = (k) => new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : ((i * k) % 251)));
const A = pic(7);
const B = pic(13);
const same = (x, y) => x.every((v, i) => v === y[i]);
const close = (x, y) => { let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / x.length < 2; };

for (const t of FX_TRANSITIONS) {
  parse(t.expr);
  assert.match(shaderSource(t.expr, 'transition'), /void main/);
  const start = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 0, t.expr);
  const mid = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 0.5, t.expr);
  const end = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 1, t.expr);
  assert.ok(close(start, A), `${t.id} starts on the outgoing clip`);
  assert.ok(close(end, B), `${t.id} ends on the incoming clip`);
  assert.ok(!same(mid, A) && !same(mid, B), `${t.id} shows something in between`);
  assert.ok(t.duration > 0 && t.duration <= 2, `${t.id} default length`);
}
for (const e of PIXEL_EFFECTS) {
  assert.match(shaderSource(e.expr, 'effect'), /void main/);
  const frames = [0.05, 0.6, 1.5].map((T) => runEffect(A, new Uint8ClampedArray(A.length), W, H, T, e.expr));
  assert.ok(frames.some((f) => !same(f, A)), `${e.id} changes the picture`);
}
for (const o of OVERLAY_EFFECTS) assert.equal(typeof o.draw, 'function');
console.log('FX OK');
