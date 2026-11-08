// Colour-only looks as a 3D LUT for the export: which looks qualify, the
// interpolation matches FFmpeg's lut3d, and the .cube file the main process writes.
// Usage: node tests/unit/export/test-color-lut.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { colorOnlyExpr, colorOnlyPasses, applyLut, lutError, LUT_SIZE } from '../../../src/features/export/colorLut.js';
import { FILTER_LOOKS as FILTERS, filterExpr } from '../../../src/features/effects/filters.js';
import { gradeExpr } from '../../../src/features/effects/grade.js';

const require = createRequire(import.meta.url);
const { FxJobs } = require('../../../electron/export/fxjobs.cjs');
const { ffmpegPath } = require('../../../electron/media/ffmpeg.cjs');
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

check('colour-only expressions: samples at (X, Y) only, no position, time or noise', () => {
  assert.ok(colorOnlyExpr('S(X,Y) * 1.2'));
  assert.ok(colorOnlyExpr('st(1, L(X,Y)); clip(S(X,Y) + (C(ld(1), ld(1), ld(1)) - S(X,Y)) * 0.5, 0, 255)'));
  assert.ok(colorOnlyExpr('PR(X, Y) + PG(X,Y) * PI'));
  assert.ok(!colorOnlyExpr('S(X+1,Y)'), 'a neighbour sample is spatial');
  assert.ok(!colorOnlyExpr('S(X,Y) * X / W'), 'position');
  assert.ok(!colorOnlyExpr('S(X,Y) + T'), 'time');
  assert.ok(!colorOnlyExpr('S(X,Y) + hash(3)'), 'noise');
  assert.ok(!colorOnlyExpr('S(W-1-X,Y)'), 'mirror');
  assert.ok(!colorOnlyExpr('S(X,Y'), 'unparsable');
});

check('Adjust: tone, colour, HSL and curves qualify; sharpen, clarity, vignette and grain do not', () => {
  assert.ok(colorOnlyExpr(gradeExpr({ exposure: 20, contrast: 30, saturation: -10, temp: 15, highlight: -20, fade: 20,
    hsl: { red: { h: 20, s: 30, l: 0 } }, curves: { master: [[0, 0], [0.4, 0.3], [1, 1]] } })));
  for (const spatial of [{ sharpen: 40 }, { clarity: 40 }, { vignette: 40 }, { particles: 40 }]) assert.ok(!colorOnlyExpr(gradeExpr(spatial)), JSON.stringify(spatial));
});

check('a filter qualifies unless its look is spatial (vignette, clarity, sharpen, grain, edges)', () => {
  const looks = FILTERS.filter((f) => f.id !== 'none');
  const spatial = (f) => !!(f.grade && ['vignette', 'clarity', 'sharpen', 'particles'].some((k) => f.grade[k])) || f.id === 'sketch';
  for (const f of looks) assert.equal(colorOnlyExpr(filterExpr({ filter: f.id })), !spatial(f), f.id);
  assert.ok(looks.filter((f) => !spatial(f)).length >= 38, 'most filters take the LUT path');
  assert.ok(colorOnlyPasses([{ expr: filterExpr({ filter: 'vivid' }), T: 0 }, { lut: { size: 2, data: new Uint8Array(32) }, K: 1 }]));
  assert.ok(!colorOnlyPasses([]) && !colorOnlyPasses([{ key: { on: true } }]));
});

// A look written as a table, applied by FFmpeg's lut3d and by applyLut, must agree.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-color-lut-'));
try {
  const size = 17, table = new Uint8Array(size ** 3 * 3);
  const look = (r, g, b) => [Math.min(255, r * 0.8 + g * 0.3), (g * g) / 255, 255 - b * 0.7]; // non-linear on purpose
  for (let b = 0, i = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++, i += 3) {
    const v = look(r * 255 / (size - 1), g * 255 / (size - 1), b * 255 / (size - 1));
    table[i] = Math.round(v[0]); table[i + 1] = Math.round(v[1]); table[i + 2] = Math.round(v[2]);
  }
  const jobs = new FxJobs();
  const { id } = jobs.lut(size, table);
  const cube = jobs.jobs.get(id).file;
  check('the main process writes a .cube of size³ lines, red fastest, and reuses an identical table', () => {
    const lines = fs.readFileSync(cube, 'utf8').trim().split('\n');
    assert.equal(lines[1], `LUT_3D_SIZE ${size}`); assert.equal(lines.length, 2 + size ** 3);
    assert.equal(lines[3], `${(table[3] / 255).toFixed(5)} ${(table[4] / 255).toFixed(5)} ${(table[5] / 255).toFixed(5)}`);
    assert.equal(jobs.lut(size, table).id, id);
    assert.throws(() => jobs.lut(size, table.subarray(1)), /does not match/);
    assert.throws(() => jobs.lut(1000, table), /Invalid/);
  });
  check('applyLut (tetrahedral) matches FFmpeg lut3d on every colour of a test image', () => {
    const W = 256, H = 64, src = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) { src[i * 3] = i % 256; src[i * 3 + 1] = (i * 7) % 256; src[i * 3 + 2] = (i * 13 + (i >> 8) * 31) % 256; }
    const input = path.join(dir, 'in.rgb');
    fs.writeFileSync(input, src);
    const esc = cube.replace(/\\/g, '/').replace(/:/g, '\\:');
    const out = execFileSync(ffmpegPath, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', input,
      '-vf', `format=rgba,lut3d=file='${esc}':interp=tetrahedral,format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let max = 0;
    for (let i = 0; i < W * H; i++) {
      const v = applyLut(table, size, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
      for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(Math.round(v[c]) - out[i * 3 + c]));
    }
    assert.ok(max <= 1, `max difference ${max}`);
  });
  check('the bake check accepts a smooth look and rejects hard steps', () => {
    const lattice = (fn, n = LUT_SIZE) => { const t = new Uint8Array(n ** 3 * 3); for (let b = 0, i = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, i += 3) { const v = [r, g, b].map((k) => fn(Math.round(k * 255 / (n - 1)))); t.set(v, i); } return t; };
    const colors = new Uint8Array(3 * 4096).map((_, i) => (i * 97 + (i >> 3) * 13) % 256);
    const exact = (fn) => colors.map(fn);
    const smooth = (v) => Math.round(255 * (v / 255) ** 0.8), steps = (v) => Math.round(v / 51) * 51;
    assert.ok(lutError(lattice(smooth), LUT_SIZE, colors, exact(smooth)).max <= 2);
    assert.ok(lutError(lattice(steps), LUT_SIZE, colors, exact(steps)).max > 6, 'posterize keeps the frame-by-frame path');
  });
  jobs.clear();
  console.log(`${checks.length} colour LUT checks passed`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
