// Forge (electron/forge.cjs): request builders, the job lifecycle with a STUBBED fetch (no
// network), key-missing paths, provider-error surfacing, cancel, and the library persistence
// round-trip. A final LIVE section tries the real providers through the same module and
// reports honestly: Pollinations must produce a real photo when the network allows, and a
// fake Gemini key must be rejected by Google itself (400/401/403) — if the sandbox has no
// route to a provider, that check logs SKIP instead of failing.
// Usage: node scripts/test-forge.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const forge = require('../electron/forge.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
const waitFor = async (id, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const job = forge.listJobs().find((j) => j.id === id);
    if (job && job.status !== 'running') return job;
    if (Date.now() - t0 > ms) throw new Error(`job ${id} still running after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const okJson = (obj, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => obj, arrayBuffer: async () => new ArrayBuffer(0) });

(async () => {
  // ---- Catalog + request builders ----
  const cat = forge.catalog();
  assert.equal(cat.photoModels[0].id, 'pollinations');
  assert.equal(cat.photoModels.filter((m) => m.provider === 'gemini').length, 2, 'two Gemini photo models');
  assert.equal(cat.videoModels.length, 2, 'two Veo models');
  assert.ok(cat.videoModels.every((m) => m.needsKey), 'video always needs the key');

  const pr = forge.buildPhotoRequest({ model: cat.photoModels[0], prompt: 'a red barn & sun', ratio: '9:16' });
  assert.match(pr.url, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20red%20barn%20%26%20sun\?width=768&height=1344&nologo=true$/);
  const gr = forge.buildPhotoRequest({ model: cat.photoModels[1], prompt: 'x', ratio: '16:9' });
  assert.match(gr.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-image:generateContent$/);
  assert.equal(gr.body.generationConfig.imageConfig.aspectRatio, '16:9');
  const vr = forge.buildVideoRequest({ model: cat.videoModels[0], prompt: 'waves', ratio: '9:16', duration: 8 });
  assert.match(vr.url, /models\/veo-3\.1-fast-generate-001:predictLongRunning$/);
  assert.deepEqual(vr.body.parameters, { aspectRatio: '9:16', durationSeconds: 8 });
  const vrImg = forge.buildVideoRequest({ model: cat.videoModels[0], prompt: 'waves', ratio: '16:9', duration: 5, image: { data: 'QUJD', mimeType: 'image/png' } });
  assert.equal(vrImg.body.instances[0].image.bytesBase64Encoded, 'QUJD', 'start frame rides the request');

  // ---- Pollinations job, stubbed fetch ----
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const fetchPng = async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.length) });
  const j1 = forge.start({ fetchImpl: fetchPng, dir, getKey: () => '' }, { kind: 'photo', prompt: 'a lighthouse', modelId: 'pollinations', ratio: '9:16' });
  const done1 = await waitFor(j1.id);
  assert.equal(done1.status, 'done');
  assert.equal(done1.entry.prompt, 'a lighthouse');
  assert.ok(fs.existsSync(path.join(dir, done1.entry.file)), 'photo written to the forge dir');
  assert.equal(forge.list(dir).length, 1, 'library lists the entry');
  assert.deepEqual(forge.remove(dir, done1.entry.id), { removed: true });
  assert.equal(forge.list(dir).length, 0, 'library round-trip: entry removed');
  assert.ok(!fs.existsSync(path.join(dir, done1.entry.file)), 'file removed with the entry');

  // ---- Gemini photo job: key header + inlineData path ----
  let seenKey = '';
  const fetchGeminiPhoto = async (url, opts) => { seenKey = opts.headers['x-goog-api-key']; return okJson({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pngBytes.toString('base64') } }] } }] }); };
  const j2 = forge.start({ fetchImpl: fetchGeminiPhoto, dir, getKey: () => 'test-key-123' }, { kind: 'photo', prompt: 'a castle', modelId: 'gemini-2.5-flash-image', ratio: '1:1' });
  const done2 = await waitFor(j2.id);
  assert.equal(done2.status, 'done');
  assert.equal(seenKey, 'test-key-123', 'the saved Gemini key rides the request');

  // ---- Key-missing paths fail with the exact guidance, before any fetch ----
  let fetched = false;
  const fetchSpy = async () => { fetched = true; return okJson({}); };
  const j3 = forge.start({ fetchImpl: fetchSpy, dir, getKey: () => '' }, { kind: 'photo', prompt: 'x', modelId: 'gemini-2.5-flash-image', ratio: '1:1' });
  assert.equal((await waitFor(j3.id)).error, forge.NO_KEY_MESSAGE);
  const j4 = forge.start({ fetchImpl: fetchSpy, dir, getKey: () => '' }, { kind: 'video', prompt: 'x', modelId: 'veo-3.1-fast-generate-001', ratio: '9:16', duration: 5 });
  assert.equal((await waitFor(j4.id)).error, forge.NO_KEY_MESSAGE);
  assert.equal(fetched, false, 'no provider call happens without a key');

  // ---- Provider errors surface verbatim ----
  const fetch400 = async () => ({ ok: false, status: 400, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }) });
  const j5 = forge.start({ fetchImpl: fetch400, dir, getKey: () => 'bad' }, { kind: 'photo', prompt: 'x', modelId: 'gemini-2.5-flash-image', ratio: '1:1' });
  const err5 = await waitFor(j5.id);
  assert.equal(err5.status, 'error');
  assert.match(err5.error, /Provider answered 400: API key not valid/, 'provider message is verbatim');

  // ---- Gemini video job: predict → poll → download ----
  const calls = [];
  const fetchVideo = async (url, opts = {}) => {
    calls.push(url);
    if (url.includes(':predictLongRunning')) return okJson({ name: 'operations/abc123' });
    if (url.includes('/operations/abc123') && !url.includes('alt=media')) {
      const polls = calls.filter((u) => u.includes('/operations/abc123')).length;
      return polls < 2 ? okJson({ done: false }) : okJson({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media' } }] } } });
    }
    return { ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new Uint8Array([0, 0, 0, 24, 1, 2]).buffer };
  };
  const j6 = forge.start({ fetchImpl: fetchVideo, dir, getKey: () => 'k', pollMs: 5 }, { kind: 'video', prompt: 'waves at dusk', modelId: 'veo-3.1-fast-generate-001', ratio: '9:16', duration: 5 });
  const done6 = await waitFor(j6.id);
  assert.equal(done6.status, 'done');
  assert.equal(done6.entry.kind, 'video');
  assert.ok(done6.entry.file.endsWith('.mp4'), 'video saved as mp4');

  // ---- Cancel a running video job: predict resolves, polls never settle until abort ----
  const fetchHang2 = (url, opts = {}) => {
    if (url.includes(':predictLongRunning')) return Promise.resolve(okJson({ name: 'operations/slow' }));
    return new Promise((_, reject) => { opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  };
  const j7 = forge.start({ fetchImpl: fetchHang2, dir, getKey: () => 'k', pollMs: 5 }, { kind: 'video', prompt: 'slow render', modelId: 'veo-3.1-fast-generate-001', ratio: '16:9', duration: 8 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(forge.cancel(j7.id), true);
  assert.equal((await waitFor(j7.id)).status, 'cancelled');

  console.log('FORGE OK — builders, stubbed photo/video lifecycles, key-missing, verbatim errors, cancel, library round-trip');

  // ---- LIVE (best effort; reports, never silently passes) ----
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-live-'));
  try {
    const jl = forge.start({ fetchImpl: globalThis.fetch, dir: liveDir, getKey: () => '' }, { kind: 'photo', prompt: 'a small lighthouse on a rocky coast at dusk, cinematic', modelId: 'pollinations', ratio: '1:1' });
    const doneL = await waitFor(jl.id, 90000);
    if (doneL.status === 'done') {
      const size = fs.statSync(path.join(liveDir, doneL.entry.file)).size;
      console.log(`LIVE POLLINATIONS: real photo generated (${size} bytes, ${doneL.entry.file})`);
      fs.writeFileSync(path.join(os.tmpdir(), 'forge-live-photo.json'), JSON.stringify({ dir: liveDir, file: doneL.entry.file, path: path.join(liveDir, doneL.entry.file) }));
    } else {
      console.log(`LIVE POLLINATIONS: BLOCKED — ${doneL.error}`);
    }
  } catch (e) {
    console.log(`LIVE POLLINATIONS: BLOCKED — ${e.message}`);
  }
  for (const [label, make] of [
    ['photo', () => forge.buildPhotoRequest({ model: forge.PHOTO_MODELS[1], prompt: 'test', ratio: '1:1' })],
    ['video', () => forge.buildVideoRequest({ model: forge.VIDEO_MODELS[0], prompt: 'test', ratio: '9:16', duration: 5 })],
  ]) {
    try {
      const req = make();
      const res = await globalThis.fetch(req.url, { method: req.method, headers: { ...req.headers, 'x-goog-api-key': 'forge-invalid-test-key' }, body: req.body ? JSON.stringify(req.body) : undefined });
      let msg = '';
      try { msg = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
      console.log(`LIVE GEMINI ${label}: HTTP ${res.status}${msg ? ` — ${msg.slice(0, 90)}` : ''}`);
      assert.ok([400, 401, 403].includes(res.status), `fake key rejected by Google itself (${res.status})`);
    } catch (e) {
      if (e.code === 'ERR_ASSERTION') throw e;
      console.log(`LIVE GEMINI ${label}: UNREACHABLE — ${e.message} (sandbox network)`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
