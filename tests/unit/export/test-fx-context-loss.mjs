// The graphics driver can drop the WebGL context mid-export (GPU reset). A lost context draws and reads nothing,
// so the effects pass must stop with a clear message instead of writing stale pictures and reporting success.
// WebGL is a stand-in that behaves as the spec says a lost context does. Usage: node tests/unit/export/test-fx-context-loss.mjs
import assert from 'node:assert/strict';

const FRAMES = 24, LOSE_AT = 18;
let lost = false, uploaded = 0, drawn = 0, pack = null, contextLost = null;
const stored = new Map();
const K = { PIXEL_PACK_BUFFER: 6, FRAMEBUFFER_COMPLETE: 8, TIMEOUT_EXPIRED: 0x911b, ALREADY_SIGNALED: 0x911a, WAIT_FAILED: 0x911d };
const live = {
  getParameter: () => 1024, checkFramebufferStatus: () => K.FRAMEBUFFER_COMPLETE, getShaderParameter: () => true, getProgramParameter: () => true,
  getUniformLocation: () => ({}), fenceSync: () => ({}), clientWaitSync: () => K.ALREADY_SIGNALED, isContextLost: () => false,
  texImage2D: (...a) => { if (a[8]?.length) uploaded = a[8][0]; },
  drawArrays: () => { drawn = (uploaded + 50) % 256; },
  bindBuffer: (target, buffer) => { if (target === K.PIXEL_PACK_BUFFER) pack = buffer; },
  readPixels: (...a) => { if (pack && a[6] === 0) stored.set(pack, drawn); else a[6]?.fill?.(drawn); },
  getBufferSubData: (_t, _o, out) => out.fill(stored.get(pack)),
};
let ids = 1;
const gl = new Proxy({}, { get: (_, key) => {
  if (key in K) return K[key];
  if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return 1;
  if (lost) return key === 'isContextLost' ? () => true : key === 'clientWaitSync' ? () => K.WAIT_FAILED : () => null;
  if (typeof key === 'string' && key.startsWith('create')) return () => ({ id: ids++ });
  return live[key] || (() => {});
} });
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => gl, addEventListener: (name, fn) => { if (name === 'webglcontextlost') contextLost = fn; } }) };
const written = [];
let next = 0;
globalThis.api = {
  fxBegin: async () => ({ ok: true, value: { id: 'job', width: 32, height: 18, fps: 30, frames: FRAMES, len: FRAMES / 30 } }),
  fxRead: async (_id, count) => {
    const frames = [];
    for (let i = 0; i < count && next < FRAMES; i++) {
      if (next === LOSE_AT) { lost = true; contextLost?.({ preventDefault() {} }); }
      frames.push(new Uint8Array(32 * 18 * 4).fill(next++));
    }
    return { ok: true, value: { frames } };
  },
  fxWrite: async (_id, bytes) => { for (const b of Array.isArray(bytes) ? bytes : [bytes]) written.push(b[0]); return { ok: true }; },
  fxEnd: async () => ({ ok: true }), fxLut: async () => ({ ok: true, value: { id: 'lut' } }),
};
const { renderFxPass } = await import('../../../src/features/export/fxExport.js');
const { fxGL } = await import('../../../src/features/effects/gl.js');
const { t } = await import('../../../src/i18n/index.js');
const project = { id: 'p', width: 32, height: 18, fps: 30, media: [{ id: 'm', type: 'video', duration: 1, width: 32, height: 18 }],
  videoClips: [{ id: 'c', mediaId: 'm', in: 0, out: FRAMES / 30, effects: ['fx_vhs'] }], overlayClips: [], textClips: [], effectClips: [], audioClips: [] };
const first = fxGL();
await assert.rejects(renderFxPass(project, () => {}, () => false), (error) => error.message === t('export.gpu_context_lost'), 'the pass fails with the context-lost message');
assert.ok(written.every((value, i) => value === (i + 50) % 256), `every frame written before the loss is a real drawn frame: ${written}`);
assert.notEqual(fxGL(), first, 'the next export gets a fresh context');
console.log(`WebGL context loss stops the effects pass (${written.length} good frames written before it)`);
