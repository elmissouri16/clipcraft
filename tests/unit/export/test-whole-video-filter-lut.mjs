// Routing in the export's effects pass: a "Whole video" filter layer (filter:<look> on the Effects track, no region,
// covering the clip) is baked into the clip's colour LUT with the clip's own look, so no frame goes through the
// frame-by-frame shader path. A layer that covers only part of a clip, or has a region, still takes the shader path.
// WebGL is a stand-in here (routing only; the bake's own accuracy check runs in the app with real shaders).
// Usage: node tests/unit/export/test-whole-video-filter-lut.mjs
import assert from 'node:assert/strict';

const fakeGl = new Proxy({}, { get: (_, key) => {
  if (key === 'getParameter') return () => 4096;
  if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
  if (key === 'isContextLost') return () => false;
  if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return 1;
  if (typeof key === 'string' && key.startsWith('create')) return () => ({});
  return () => {};
} });
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeGl, addEventListener() {} }) };
let begins = [], luts = 0;
globalThis.api = {
  fxBegin: async (_project, spec) => { begins.push(spec); return { ok: true, value: { id: `job${begins.length}`, cached: true, frames: 0, width: 64, height: 36, fps: 30, len: spec.to - spec.from } }; },
  fxEnd: async () => ({ ok: true }),
  fxLut: async () => { luts++; return { ok: true, value: { id: `lut${luts}` } }; },
};
const { renderFxPass } = await import('../../../src/features/export/fxExport.js');
const { FILTER_LOOKS } = await import('../../../shared/filterCatalog.mjs');
const look = FILTER_LOOKS.find((f) => f.id !== 'none').id;
const base = { id: 'p', width: 64, height: 36, fps: 30, media: [{ id: 'm', type: 'video', duration: 20, width: 64, height: 36 }],
  videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 10 }, { id: 'b', mediaId: 'm', in: 10, out: 20 }], overlayClips: [], textClips: [], audioClips: [] };
const run = async (effectClips) => {
  begins = []; luts = 0;
  const out = await renderFxPass({ ...base, effectClips }, () => {}, () => false);
  return { out, shader: begins.map((b) => b.clipId), luts };
};

const whole = await run([{ id: 'e', fx: `filter:${look}`, start: 0, duration: 20 }]);
assert.deepEqual(whole.shader, [], 'no clip goes through the shader pass');
assert.equal(whole.luts, 2, 'both clips get a baked LUT');
assert.ok(whole.out.videoClips.every((c) => c.colorLut?.job), 'each clip carries its LUT');
assert.deepEqual(whole.out.effectClips, [], 'the layer now lives inside the clip LUTs');

const partial = await run([{ id: 'e', fx: `filter:${look}`, start: 2, duration: 18 }]);
assert.deepEqual(partial.shader, ['a'], 'a layer starting inside clip a renders a frame by frame');
assert.equal(partial.luts, 1, 'clip b, fully covered, is still baked');

const region = await run([{ id: 'e', fx: `filter:${look}`, start: 0, duration: 20, region: { shape: 'rect', x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }]);
assert.deepEqual(region.shader, ['a', 'b'], 'a filter inside a region is not a colour-only look');
console.log('whole-video filter layers are baked into the clip LUTs');
