// Playback quality (store.js model + electron/quality.cjs generator math) and the player view zoom.
// Run: node scripts/test-playback-quality.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  FIT_VIEW, applyZoomChoice, clampPan, getPlaybackQuality, levelCopyState, previewPath, previewPathFor,
  qualityTargetSize as storeTargetSize, setPlaybackQuality, zoomByFactor, zoomTransform,
} from '../src/store.js';

const require = createRequire(import.meta.url);
const { qualityFromStored, qualityScaleFilter, qualityTargetSize: mainTargetSize } = require('../electron/quality.cjs');

// ---- Level -> scale math: renderer and generator implementations must agree, incl. no-upscale.
const cases = [
  // [w, h, quality, expected]
  [1920, 1080, 'high', { width: 1280, height: 720 }],
  [1920, 1080, 'medium', { width: 960, height: 540 }],
  [1920, 1080, 'low', { width: 640, height: 360 }],
  [1080, 1920, 'high', { width: 720, height: 1280 }], // portrait: longest side capped
  [1080, 1920, 'medium', { width: 540, height: 960 }],
  [1080, 1920, 'low', { width: 360, height: 640 }],
  [3840, 2160, 'low', { width: 640, height: 360 }],
  [1280, 720, 'high', null], // already fits High: no copy, never upscale
  [720, 1280, 'high', null],
  [640, 360, 'low', null],
  [1280, 720, 'medium', { width: 960, height: 540 }],
  [854, 480, 'low', { width: 640, height: 360 }],
  [1920, 1080, 'full', null],
  [0, 1080, 'low', null], // unknown dimensions: no math, generator probes first
  [undefined, undefined, 'low', null],
];
for (const [w, h, q, want] of cases) {
  assert.deepEqual(storeTargetSize(w, h, q), want, `store target ${w}x${h} @ ${q}`);
  assert.deepEqual(mainTargetSize(w, h, q), want, `main target ${w}x${h} @ ${q}`);
}
// Odd sizes stay even in both implementations.
for (const [w, h, q] of [[1919, 1079, 'high'], [1079, 1919, 'medium'], [1000, 563, 'low']]) {
  const a = storeTargetSize(w, h, q);
  assert.deepEqual(a, mainTargetSize(w, h, q), `odd-size agreement ${w}x${h} @ ${q}`);
  assert.equal(a.width % 2, 0, 'even width');
  assert.equal(a.height % 2, 0, 'even height');
  assert.ok(Math.max(a.width, a.height) <= { high: 1280, medium: 960, low: 640 }[q], 'longest side capped');
}
// The ffmpeg scale expression caps the longest side and lets ffmpeg round to even (-2).
for (const [q, max] of [['high', 1280], ['medium', 960], ['low', 640]]) {
  const f = qualityScaleFilter(q);
  assert.ok(f.includes(String(max)) && f.includes('-2'), `scale filter ${q}: ${f}`);
}

// ---- Settings migration: legacy boolean proxy -> quality level.
assert.equal(qualityFromStored({}), 'full');
assert.equal(qualityFromStored({ proxy: false }), 'full');
assert.equal(qualityFromStored({ proxy: true }), 'medium'); // old "Proxy on" meant light copies
assert.equal(qualityFromStored({ quality: 'low', proxy: false }), 'low'); // stored quality wins
assert.equal(qualityFromStored({ quality: 'bogus', proxy: true }), 'medium');
assert.equal(qualityFromStored(null), 'full');

// ---- previewPath selection per level, with fallbacks and the legacy light copy.
const m = {
  type: 'video', path: '/orig.mp4', proxy: '/prev.mp4', lightProxy: '/light.mp4',
  width: 1920, height: 1080, proxies: { high: '/qh.mp4', medium: null, low: '/ql.mp4' },
};
assert.equal(previewPathFor(m, 'full'), '/prev.mp4', 'full plays the preview-proxy chain');
assert.equal(previewPathFor(m, 'high'), '/qh.mp4', 'high plays its own copy');
assert.equal(previewPathFor(m, 'medium'), '/light.mp4', 'medium missing: light copy is the closest smaller fallback');
assert.equal(previewPathFor(m, 'low'), '/ql.mp4', 'low plays its own copy');

const bare = { type: 'video', path: '/orig.mp4', proxy: null, lightProxy: '/light.mp4', width: 1920, height: 1080 };
assert.equal(previewPathFor(bare, 'high'), '/light.mp4', 'no level copies yet: light copy plays');
assert.equal(previewPathFor(bare, 'low'), '/light.mp4');
assert.equal(previewPathFor({ ...bare, lightProxy: null }, 'low'), '/orig.mp4', 'nothing made yet: the original plays');
assert.equal(previewPathFor({ ...bare, lightProxy: null, proxy: '/prev.mp4' }, 'medium'), '/prev.mp4', 'then the preview proxy');

const failed = { ...bare, lightProxy: null, proxies: { medium: false } };
assert.equal(previewPathFor(failed, 'medium'), '/orig.mp4', 'a failed copy (false) is never played');

const small = { type: 'video', path: '/orig.mp4', proxy: '/prev.mp4', width: 720, height: 1280, proxies: { high: '/qh.mp4' } };
assert.equal(previewPathFor(small, 'high'), '/prev.mp4', 'source fits High: full chain, no scaled copy involved');
const legacy = { type: 'video', path: '/orig.mp4', lightProxy: '/light.mp4' }; // no dims, no proxies map
assert.equal(previewPathFor(legacy, 'low'), '/light.mp4', 'legacy item: light copy serves until the level copy exists');
assert.equal(previewPathFor({ type: 'image', path: '/pic.jpg' }, 'low'), '/pic.jpg', 'images are never proxied');

// Module-level preference drives previewPath (what the player calls).
setPlaybackQuality('low');
assert.equal(getPlaybackQuality(), 'low');
assert.equal(previewPath(m), '/ql.mp4');
setPlaybackQuality('bogus');
assert.equal(getPlaybackQuality(), 'full', 'unknown levels fall back to Full');
assert.equal(previewPath(m), '/prev.mp4');
setPlaybackQuality('full');

// ---- levelCopyState drives generation requests.
assert.equal(levelCopyState(m, 'high'), 'ready');
assert.equal(levelCopyState(m, 'medium'), 'fallback');
assert.equal(levelCopyState(m, 'full'), 'na');
assert.equal(levelCopyState(failed, 'medium'), 'failed');
assert.equal(levelCopyState(small, 'high'), 'ready', 'level resolved (main points it at the full chain when the source fits)');
assert.equal(levelCopyState({ ...small, proxies: {} }, 'high'), 'na', 'source fits and nothing stored: nothing to generate');
assert.equal(levelCopyState(legacy, 'low'), 'fallback', 'unknown dims: main probes and settles it');
assert.equal(levelCopyState({ type: 'audio', path: '/a.mp3' }, 'low'), 'na');

// ---- Zoom: menu choices, wheel math, pan clamping, Fit reset, stage transform string.
assert.equal(zoomTransform(FIT_VIEW), undefined, 'Fit applies no transform');
const z200 = applyZoomChoice(FIT_VIEW, 200, 800, 450);
assert.deepEqual(z200, { z: 2, x: 0, y: 0, fit: false });
assert.equal(zoomTransform(z200), 'translate(0px, 0px) scale(2)', 'stage transform matches the 200% choice');
assert.deepEqual(applyZoomChoice(z200, 'fit', 800, 450), { ...FIT_VIEW }, 'Fit resets scale and pan');
assert.deepEqual(applyZoomChoice(FIT_VIEW, 50, 800, 450), { z: 0.5, x: 0, y: 0, fit: false });
assert.equal(zoomTransform(applyZoomChoice(FIT_VIEW, 150, 800, 450)), 'translate(0px, 0px) scale(1.5)');
assert.deepEqual(zoomByFactor(FIT_VIEW, 2, 800, 450), { z: 2, x: 0, y: 0, fit: false }, 'wheel x2 from Fit');
assert.deepEqual(zoomByFactor(z200, 0.4, 800, 450), { ...FIT_VIEW }, 'wheeling back to <=100% returns to Fit');
assert.equal(zoomByFactor({ z: 3.9, x: 0, y: 0, fit: false }, 2, 800, 450).z, 4, 'zoom clamps at 400%');
const clamped = clampPan({ z: 2, x: 9999, y: -9999, fit: false }, 800, 450);
assert.deepEqual([clamped.x, clamped.y], [460, -285], 'pan clamped to the zoomed stage + margin');
const panned = { z: 2, x: 120, y: -40, fit: false };
assert.equal(zoomTransform(panned), 'translate(120px, -40px) scale(2)');

// ---- Export must stay originals-only: its argument builder never sees proxy state.
const ffmpegSrc = fs.readFileSync(new URL('../electron/ffmpeg.cjs', import.meta.url), 'utf8');
const exportFn = ffmpegSrc.slice(ffmpegSrc.indexOf('function buildExportArgs'), ffmpegSrc.indexOf('function buildAudioExportArgs'));
assert.ok(!/proxies|lightProxy|previewPath|makeQualityProxy/.test(exportFn), 'buildExportArgs is proxy-free');
const storeSrc = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
assert.ok(!/export/i.test(zoomTransform(z200) || ''), 'zoom transform carries no export meaning');

console.log('playback-quality ok (scale math, migration, preview selection, level states, zoom)');
