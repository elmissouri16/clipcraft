// Transition packs: the five packs (Seamless, Mask & Reveal, Light & Glow, Distortion, Cinematic) are
// real engine transitions — every pack name resolves to an entry in PACK_TRANSITIONS (the same list the
// WebGL preview and the export's effects pass render), never to an adapted stand-in.
// Usage: node scripts/test-transition-packs.mjs
import assert from 'node:assert/strict';
import { FX_TRANSITIONS, PACK_TRANSITIONS, fxTransition } from '../src/fx/catalog.js';
import { PACKS, COLLECTION_ITEMS, packItems, directionGroupFor } from '../src/fx/collections.js';
import { catalog135BySlug } from '../src/fx/catalog135.js';
import { TRANSITIONS } from '../src/effects.js';
import { parse } from '../src/fx/expr.js';
import { shaderSource } from '../src/fx/gl.js';
import { runTransition } from '../src/fx/run.js';

// ---- Pack membership: exact expected counts per pack.
const EXPECTED = {
  seamless: ['fx_whipleft', 'fx_whipright', 'fx_whipup', 'fx_whipdown', 'fx_zoomblur', 'fx_spinblur', 'fx_warppush', 'fx_warpsmoothl', 'fx_warpsmoothr'],
  reveal: ['fx_blinds', 'fx_gridreveal', 'fx_barndoors', 'fx_chevron', 'fx_irisout', 'fx_irisin', 'fx_diamondreveal', 'fx_rects', 'fx_circlecorner', 'fx_diagstripes'],
  glowpack: ['fx_glowdissolve', 'fx_flaresweep', 'fx_lightburn', 'fx_flashframe', 'fx_prismleak'],
  distortion: ['fx_ripplewave', 'fx_impactshake', 'fx_rgbslidel', 'fx_rgbslider', 'fx_pixelstretch', 'fx_stretchwarp'],
  cinematic: ['fx_filmroll', 'fx_projector', 'fx_letterbox', 'fx_dipcolor', 'fx_freezepush'],
};
assert.deepEqual(PACKS.map((p) => p.id), Object.keys(EXPECTED), 'the five packs, in order');
assert.equal(PACK_TRANSITIONS.length, 35, 'pack engine transitions');
assert.equal(new Set(PACK_TRANSITIONS.map((t) => t.id)).size, 35, 'pack ids are unique');
const engineIds = new Set(TRANSITIONS.map((t) => t.id));
for (const [pack, ids] of Object.entries(EXPECTED)) {
  const inPack = PACK_TRANSITIONS.filter((t) => t.pack === pack).map((t) => t.id);
  assert.deepEqual([...inPack].sort(), [...ids].sort(), `${pack} membership`);
  const items = packItems(pack);
  assert.equal(items.length, ids.length, `${pack} tile count`);
  for (const item of items) {
    assert.equal(item.status, 'implemented', `${item.slug} is a true implementation, not adapted`);
    assert.ok(ids.includes(item.engineId), `${item.slug} runs a ${pack} engine transition`);
  }
}

// ---- Every pack transition is a real engine transition in both registries:
// FX_TRANSITIONS (preview FxGL + export fx pass read this list) and TRANSITIONS (fx: true).
for (const t of PACK_TRANSITIONS) {
  assert.ok(fxTransition(t.id) === t, `${t.id} resolves in the FX registry`);
  const reg = TRANSITIONS.find((x) => x.id === t.id);
  assert.ok(reg && reg.fx === true, `${t.id} is an fx transition in TRANSITIONS`);
  assert.ok(engineIds.has(t.id), `${t.id} in engine id list`);
  parse(t.expr);
  assert.match(shaderSource(t.expr, 'transition'), /void main/, `${t.id} builds a shader`);
  assert.ok(t.duration > 0 && t.duration <= 2, `${t.id} default length`);
}
// Pack transitions are part of FX_TRANSITIONS (so previews and exports pick them up).
for (const t of PACK_TRANSITIONS) assert.ok(FX_TRANSITIONS.includes(t), `${t.id} in FX_TRANSITIONS`);
// No pack item anywhere in the collection layer is badged adapted.
for (const e of COLLECTION_ITEMS.filter((x) => x.pack)) assert.equal(e.status, 'implemented', `${e.slug} not adapted`);

// ---- Direction control: whip / smooth warp / RGB slide resolve to their groups both ways.
assert.equal(directionGroupFor('fx_whipleft').group.name, 'Whip Pan');
assert.equal(directionGroupFor('fx_whipdown').dir, 'down');
assert.equal(directionGroupFor('fx_warpsmoothr').group.name, 'Smooth Warp');
assert.equal(directionGroupFor('fx_rgbslidel').group.name, 'RGB Slide');
assert.equal(directionGroupFor('fx_rgbslider').dir, 'right');

// ---- Catalog upgrades: names that gained a true engine are 'implemented' now, badge removed.
const UPGRADES = {
  'barn-doors': 'fx_barndoors', 'venetian-blinds-louver': 'fx_blinds', 'checkerboard-wipe': 'fx_gridreveal',
  'whip-pan': 'fx_whipleft', 'wave-warp': 'fx_ripplewave', 'stretch': 'fx_stretchwarp', 'film-roll': 'fx_filmroll',
  'zoom-blur': 'fx_zoomblur',
  'earthquake-shake': 'fx_impactshake', 'stripe-band-wipe': 'fx_diagstripes',
};
for (const [slug, engineId] of Object.entries(UPGRADES)) {
  const e = catalog135BySlug(slug);
  assert.equal(e.engineId, engineId, `${slug} now runs ${engineId}`);
  assert.equal(e.status, 'implemented', `${slug} upgraded to implemented`);
}
// Adapted entries re-pointed at closer true engines stay adapted (honest badges kept).
assert.equal(catalog135BySlug('whip-pan-match-cut').engineId, 'fx_whipleft');
assert.equal(catalog135BySlug('whip-pan-match-cut').status, 'adapted');
assert.equal(catalog135BySlug('glow').engineId, 'fx_glowdissolve');

// ---- CPU reference: one transition per pack starts on A, ends on B, moves in between;
// the whip pan's mid frame is genuinely blurred (lower horizontal gradient energy than the source).
const W = 96;
const H = 54;
const pic = (k) => new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : ((i * k) % 251)));
const A = pic(7);
const B = pic(13);
const same = (x, y) => x.every((v, i) => v === y[i]);
const close = (x, y) => { let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / x.length < 2; };
const hGrad = (buf) => {
  let s = 0;
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) { s += Math.abs(buf[(y * W + x) * 4] - buf[(y * W + x - 1) * 4]); n++; }
  return s / n;
};
for (const id of ['fx_whipleft', 'fx_gridreveal', 'fx_glowdissolve', 'fx_pixelstretch', 'fx_letterbox']) {
  const t = fxTransition(id);
  const start = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 0, t.expr);
  const mid = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 0.5, t.expr);
  const end = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 1, t.expr);
  assert.ok(close(start, A), `${id} starts on A`);
  assert.ok(close(end, B), `${id} ends on B`);
  assert.ok(!same(mid, A) && !same(mid, B), `${id} moves in between`);
}
const whip = fxTransition('fx_whipleft');
const whipMid = runTransition(A, B, new Uint8ClampedArray(A.length), W, H, 0.5, whip.expr);
assert.ok(hGrad(whipMid) < hGrad(A) * 0.6, `whip mid frame is motion-blurred (grad ${hGrad(whipMid).toFixed(1)} vs source ${hGrad(A).toFixed(1)})`);

console.log(`transition packs OK: 5 packs, 35 real engine transitions, ${Object.keys(UPGRADES).length} catalog upgrades, direction groups wired`);
