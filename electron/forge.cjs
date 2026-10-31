// Forge — ClipCraft's own AI generation for photos and short videos. Two providers behind one
// interface, both running on the USER's accounts (nothing is generated locally and Forge never
// implies otherwise):
//   · Pollinations (photo only) — free, no key: the out-of-the-box path.
//   · Gemini — the same encrypted key the AI assistant (CraftAI) already uses, read through
//     settings.getActive('gemini'); Forge adds NO second key field. Photo via the image models'
//     generateContent, video via Veo long-running predict + polling.
// Results land in <userData>/forge/ with a forge-library.json index (prompt, model, kind,
// createdAt). Jobs live in this module's store, so they survive panel switches; cancel works
// through an AbortController per job. Provider errors are surfaced verbatim.
// Pure module: the caller passes `fetch`, the output dir, and a key getter.
const fs = require('fs');
const path = require('path');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const POLLINATIONS_BASE = 'https://image.pollinations.ai';

const PHOTO_MODELS = [
  { id: 'pollinations', name: 'Pollinations — free, no key', provider: 'pollinations', needsKey: false },
  { id: 'gemini-2.5-flash-image', name: 'Nano Banana (Gemini)', provider: 'gemini', needsKey: true },
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2 (Gemini)', provider: 'gemini', needsKey: true },
];
const VIDEO_MODELS = [
  { id: 'veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast (Gemini)', provider: 'gemini', needsKey: true },
  { id: 'veo-3.1-generate-001', name: 'Veo 3.1 (Gemini)', provider: 'gemini', needsKey: true },
];
const PHOTO_RATIOS = ['9:16', '16:9', '1:1'];
const VIDEO_RATIOS = ['9:16', '16:9'];
const VIDEO_DURATIONS = [5, 8];
const PHOTO_SIZES = { '9:16': [768, 1344], '16:9': [1344, 768], '1:1': [1024, 1024] };

const NO_KEY_MESSAGE = 'No Gemini key saved. Add your Gemini key in Settings → AI assistant — Forge uses the same key as CraftAI. (Photos still work without a key via the free Pollinations provider.)';

const catalog = () => ({ photoModels: PHOTO_MODELS, videoModels: VIDEO_MODELS, photoRatios: PHOTO_RATIOS, videoRatios: VIDEO_RATIOS, videoDurations: VIDEO_DURATIONS });

// ---- Library (forge-library.json in the forge dir) ----
const libFile = (dir) => path.join(dir, 'forge-library.json');
function list(dir) {
  try {
    const entries = JSON.parse(fs.readFileSync(libFile(dir), 'utf8'));
    if (!Array.isArray(entries)) return [];
    return entries.filter((e) => e && e.id && e.file && fs.existsSync(path.join(dir, e.file)));
  } catch {
    return [];
  }
}
function saveEntry(dir, entry) {
  const entries = list(dir);
  entries.unshift(entry);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(libFile(dir), JSON.stringify(entries, null, 2), 'utf8');
  return entry;
}
function remove(dir, id) {
  const entries = list(dir);
  const hit = entries.find((e) => e.id === id);
  if (!hit) return { removed: false };
  try { fs.rmSync(path.join(dir, hit.file), { force: true }); } catch { /* already gone */ }
  fs.writeFileSync(libFile(dir), JSON.stringify(entries.filter((e) => e.id !== id), null, 2), 'utf8');
  return { removed: true };
}

// ---- Request builders (exported for tests) ----
function buildPhotoRequest({ model, prompt, ratio }) {
  if (model.provider === 'pollinations') {
    const [w, h] = PHOTO_SIZES[ratio] || PHOTO_SIZES['1:1'];
    return { method: 'GET', url: `${POLLINATIONS_BASE}/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true`, headers: {} };
  }
  return {
    method: 'POST',
    url: `${GEMINI_BASE}/v1beta/models/${model.id}:generateContent`,
    headers: { 'Content-Type': 'application/json' }, // the key header is added by the caller
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } },
    },
  };
}
function buildVideoRequest({ model, prompt, ratio, duration, image }) {
  const instance = { prompt };
  if (image) instance.image = { bytesBase64Encoded: image.data, mimeType: image.mimeType };
  return {
    method: 'POST',
    url: `${GEMINI_BASE}/v1beta/models/${model.id}:predictLongRunning`,
    headers: { 'Content-Type': 'application/json' },
    body: { instances: [instance], parameters: { aspectRatio: ratio, durationSeconds: duration } },
  };
}
const operationUrl = (name) => `${GEMINI_BASE}/v1beta/${name}`;

// Google error bodies are { error: { message, status } } — surface the message verbatim.
async function providerError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || j?.message || '';
  } catch { /* non-JSON error body */ }
  return new Error(detail ? `Provider answered ${res.status}: ${detail}` : `Provider answered ${res.status}.`);
}

// ---- Jobs ----
const jobs = new Map();
let jobSeq = 0;
const snapshot = (j) => ({ id: j.id, kind: j.kind, model: j.modelName, prompt: j.prompt, ratio: j.ratio, status: j.status, progress: j.progress, error: j.error || '', entry: j.entry || null, createdAt: j.createdAt });
const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(snapshot);

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };
function writeResult(dir, kind, mimeType, buf) {
  const ext = EXT_BY_MIME[mimeType] || (kind === 'video' ? 'mp4' : 'png');
  const file = `forge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}

async function runPhoto(job, deps) {
  const { fetchImpl, dir, getKey } = deps;
  const model = PHOTO_MODELS.find((m) => m.id === job.modelId);
  if (!model) throw new Error(`Unknown photo model: ${job.modelId}`);
  const req = buildPhotoRequest({ model, prompt: job.prompt, ratio: job.ratio });
  const headers = { ...req.headers };
  if (model.provider === 'gemini') {
    const key = getKey();
    if (!key) throw new Error(NO_KEY_MESSAGE);
    headers['x-goog-api-key'] = key;
  }
  const res = await fetchImpl(req.url, { method: req.method, headers, body: req.body ? JSON.stringify(req.body) : undefined, signal: job.ctl.signal });
  if (!res.ok) throw await providerError(res);
  if (model.provider === 'pollinations') {
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Pollinations answered with an empty image.');
    return writeResult(dir, 'photo', mime, buf);
  }
  const j = await res.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error('Gemini answered without an image. The model may have refused the prompt.');
  return writeResult(dir, 'photo', img.inlineData.mimeType || 'image/png', Buffer.from(img.inlineData.data, 'base64'));
}

async function runVideo(job, deps) {
  const { fetchImpl, dir, getKey } = deps;
  const model = VIDEO_MODELS.find((m) => m.id === job.modelId);
  if (!model) throw new Error(`Unknown video model: ${job.modelId}`);
  const key = getKey();
  if (!key) throw new Error(NO_KEY_MESSAGE);
  let image;
  if (job.startImagePath) {
    const data = fs.readFileSync(job.startImagePath);
    const ext = path.extname(job.startImagePath).toLowerCase();
    image = { data: data.toString('base64'), mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png' };
  }
  const req = buildVideoRequest({ model, prompt: job.prompt, ratio: job.ratio, duration: job.duration, image });
  const headers = { ...req.headers, 'x-goog-api-key': key };
  const res = await fetchImpl(req.url, { method: 'POST', headers, body: JSON.stringify(req.body), signal: job.ctl.signal });
  if (!res.ok) throw await providerError(res);
  const op = await res.json();
  if (!op?.name) throw new Error('Gemini did not return a video operation.');
  // Poll with backoff until the operation completes (Veo renders take minutes).
  // deps.pollMs overrides the first delay (tests/smoke); production starts at 5s.
  let delay = deps.pollMs ?? 5000;
  const deadline = Date.now() + 12 * 60 * 1000;
  for (;;) {
    if (job.ctl.signal.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
    if (Date.now() > deadline) throw new Error('The video is taking unusually long (over 12 minutes) — the job was stopped. Check your provider account for the result.');
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(15000, Math.round(delay * 1.4));
    const poll = await fetchImpl(operationUrl(op.name), { headers: { 'x-goog-api-key': key }, signal: job.ctl.signal });
    if (!poll.ok) throw await providerError(poll);
    const state = await poll.json();
    if (state.error) throw new Error(`Provider answered: ${state.error.message || JSON.stringify(state.error)}`);
    if (!state.done) continue;
    const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error('The video finished but no download link came back.');
    const dl = await fetchImpl(uri, { headers: { 'x-goog-api-key': key }, signal: job.ctl.signal });
    if (!dl.ok) throw await providerError(dl);
    const buf = Buffer.from(await dl.arrayBuffer());
    if (!buf.length) throw new Error('The finished video downloaded empty.');
    return writeResult(dir, 'video', 'video/mp4', buf);
  }
}

// deps: { fetchImpl, dir, getKey } — getKey() returns the decrypted Gemini key or ''.
function start(deps, { kind, prompt, modelId, ratio, duration, startImagePath } = {}) {
  const clean = String(prompt || '').trim();
  if (!clean) throw new Error('Write a prompt first.');
  const models = kind === 'video' ? VIDEO_MODELS : PHOTO_MODELS;
  const model = models.find((m) => m.id === modelId) || models[0];
  const job = {
    id: `fj${++jobSeq}-${Date.now().toString(36)}`,
    kind: kind === 'video' ? 'video' : 'photo',
    modelId: model.id, modelName: model.name,
    prompt: clean,
    ratio: (kind === 'video' ? VIDEO_RATIOS : PHOTO_RATIOS).includes(ratio) ? ratio : '9:16',
    duration: VIDEO_DURATIONS.includes(duration) ? duration : 5,
    startImagePath: startImagePath || '',
    status: 'running', progress: null, error: '', entry: null,
    createdAt: Date.now(),
    ctl: new AbortController(),
  };
  jobs.set(job.id, job);
  (async () => {
    try {
      const file = await (job.kind === 'video' ? runVideo(job, deps) : runPhoto(job, deps));
      const entry = saveEntry(deps.dir, { id: job.id, kind: job.kind, file, prompt: job.prompt, model: job.modelId, ratio: job.ratio, createdAt: new Date(job.createdAt).toISOString() });
      job.entry = entry;
      job.status = 'done';
      job.progress = 1;
    } catch (e) {
      if (e?.name === 'AbortError' || job.ctl.signal.aborted) { job.status = 'cancelled'; job.error = ''; }
      else { job.status = 'error'; job.error = e?.message || String(e); }
    }
  })();
  return snapshot(job);
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.ctl.abort();
  job.status = 'cancelled';
  return true;
}

module.exports = { catalog, list, remove, start, cancel, listJobs, buildPhotoRequest, buildVideoRequest, operationUrl, PHOTO_MODELS, VIDEO_MODELS, NO_KEY_MESSAGE };
