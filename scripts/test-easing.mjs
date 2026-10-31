// Easing engine: solver correctness, preset behaviour, and the keyframe integration in anim.js
// (new bezier presets + custom objects on keyframes; legacy ids and missing e render as before).
import assert from 'node:assert';
import { EASE_PRESETS, bezierSolver, easeValue, isCustomEase, ptsOf } from '../src/fx/easing.js';
import { stateAt, motionCurves } from '../src/anim.js';

// Solver: endpoints exact for every preset; linear is the identity.
for (const p of EASE_PRESETS) {
  const f = bezierSolver(...p.pts);
  assert.strictEqual(f(0), 0, `${p.id} starts at 0`);
  assert.strictEqual(f(1), 1, `${p.id} ends at 1`);
  assert.strictEqual(easeValue(p.id, 0), 0);
  assert.strictEqual(easeValue(p.id, 1), 1);
}
for (const t of [0.13, 0.37, 0.5, 0.82]) assert.ok(Math.abs(easeValue('linear', t) - t) < 1e-9, 'linear identity');
assert.strictEqual(easeValue(undefined, 0.3), 0.3, 'missing ease is linear (old projects)');
assert.strictEqual(easeValue(null, 0.7), 0.7);

// Monotonic progress for every preset except Overshoot (which passes 1 and settles back).
for (const p of EASE_PRESETS.filter((x) => x.id !== 'overshoot')) {
  let prev = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const v = easeValue(p.id, i / 40);
    assert.ok(v >= prev - 1e-9, `${p.id} monotonic at ${i / 40}: ${prev} -> ${v}`);
    prev = v;
  }
}
const over = Array.from({ length: 41 }, (_, i) => easeValue('overshoot', i / 40));
assert.ok(Math.max(...over) > 1.05, `overshoot exceeds 1 (max ${Math.max(...over).toFixed(3)})`);
assert.strictEqual(over[40], 1, 'overshoot settles exactly on 1');
// Smooth is symmetric: half time = half progress.
assert.ok(Math.abs(easeValue('smooth', 0.5) - 0.5) < 1e-6, 'smooth midpoint');
// Ease In lags, Ease Out leads, Snap In leads hard at the start.
assert.ok(easeValue('easeIn', 0.5) < 0.4, 'easeIn below linear at mid');
assert.ok(easeValue('easeOut', 0.5) > 0.6, 'easeOut above linear at mid');
assert.ok(easeValue('snapIn', 0.25) > 0.7, 'snapIn fast start');

// Custom objects round-trip through ptsOf and match the direct solver.
const custom = { p1x: 0.2, p1y: 0.9, p2x: 0.3, p2y: 0.1 };
assert.ok(isCustomEase(custom));
assert.deepStrictEqual(ptsOf(custom), [0.2, 0.9, 0.3, 0.1]);
const direct = bezierSolver(0.2, 0.9, 0.3, 0.1);
for (const t of [0.1, 0.45, 0.9]) assert.ok(Math.abs(easeValue(custom, t) - direct(t)) < 1e-9, 'custom round-trip');

// Keyframes: a bezier preset on the arrival keyframe bends the segment; ends stay exact; the export
// curves (motionCurves, sampled from the same stateAt) follow the same bend.
const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 1, x: 0, y: 0, rot: 0 } };
const seg = (e) => ({ ...base, keyframes: { scale: [{ t: 0, v: 1 }, { t: 2, v: 3, ...(e ? { e } : {}) }] } });
const mid = (e) => stateAt(seg(e), 1, 4).transform.scale;
assert.ok(Math.abs(mid(undefined) - 2) < 1e-9, 'no e: linear midpoint 2');
assert.ok(Math.abs(mid('smooth') - 2) < 1e-6, 'smooth midpoint still 2 (symmetric)');
assert.ok(mid('easeIn') < 1.8, `easeIn segment lags (${mid('easeIn').toFixed(3)})`);
assert.ok(mid('overshoot') !== 2 && stateAt(seg('overshoot'), 2, 4).transform.scale === 3, 'overshoot ends exact');
assert.ok(Math.abs(mid(custom) - (1 + 2 * direct(0.5))) < 1e-6, 'custom object on a keyframe');
assert.ok(Math.abs(mid('out') - (1 + 2 * (1 - 0.5 ** 3))) < 1e-9, "legacy 'out' unchanged");
const curve = motionCurves(seg('easeIn'), 2, 30).s;
const atHalf = curve.reduce((b, p) => (Math.abs(p[0] - 1) < Math.abs(b[0] - 1) ? p : b));
assert.ok(Math.abs(atHalf[1] - mid('easeIn')) < 0.02, 'export curve follows the bezier segment');

console.log('EASING OK — solver endpoints/monotonic/overshoot/custom + keyframe integration (legacy intact)');
