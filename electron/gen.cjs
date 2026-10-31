// AI generation of video clips, photos and talking avatars. One engine for now: ElevenLabs, with the user's own key
// (its image and video API needs a Pro plan or higher; lower plans get a 402 "paid_plan_required"). Free engines can
// be added next to it later. Pure module: the caller passes `fetch` and the output folder.
// Models and their options follow https://elevenlabs.io/docs/api-reference/flows (video/create, image/create).
const fs = require('fs');
const path = require('path');

const EL = 'https://api.elevenlabs.io/v1';

const SEEDANCE_RATIOS = ['auto', '9:16', '16:9', '1:1', '3:4', '4:3', '21:9'];
// Seedance (ByteDance) models must be enabled for the account by ElevenLabs and are not offered in the US.
const SEEDANCE_NOTE = 'ElevenLabs enables Seedance on request, and it is not available in the US.';
const VIDEO_MODELS = {
  'veo-3.1-fast-generate-001': { name: 'Veo 3.1 Fast', family: 'veo', ratios: ['9:16', '16:9'], durations: [4, 6, 8], resolutions: ['720p', '1080p', '4K'], refs: 3, refRoles: true },
  'veo-3.1-generate-001': { name: 'Veo 3.1', family: 'veo', ratios: ['9:16', '16:9'], durations: [4, 6, 8], resolutions: ['720p', '1080p', '4K'], refs: 3, refRoles: true },
  'bytedance-seedance-v2.5': { name: 'Seedance 2.5', family: 'seedance', ratios: SEEDANCE_RATIOS, range: [4, 30], resolutions: ['480p', '720p', '1080p'], refs: 30, videoRefs: 10, note: SEEDANCE_NOTE },
  'bytedance-seedance-v2': { name: 'Seedance 2.0', family: 'seedance', ratios: SEEDANCE_RATIOS, range: [4, 15], resolutions: ['480p', '720p', '1080p', '4k'], refs: 9, videoRefs: 3, note: SEEDANCE_NOTE },
  'bytedance-seedance-v2-fast': { name: 'Seedance 2.0 Fast', family: 'seedance', ratios: SEEDANCE_RATIOS, range: [4, 15], resolutions: ['480p', '720p'], refs: 9, videoRefs: 3, note: SEEDANCE_NOTE },
  'bytedance-seedance-v2-mini': { name: 'Seedance 2.0 Mini', family: 'seedance', ratios: SEEDANCE_RATIOS, range: [4, 15], resolutions: ['480p', '720p'], refs: 9, videoRefs: 3, note: SEEDANCE_NOTE },
};
const GEMINI_RATIOS = ['auto', '1:1', '9:16', '16:9', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '21:9'];
const GPT2_RATIOS = ['auto', '1:1', '9:16', '16:9', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '1:2', '2:1', '21:9', '1:3', '3:1'];
const IMAGE_MODELS = {
  'gemini-3.1-flash-image': { name: 'Nano Banana 2', family: 'Nano Banana', ratios: [...GEMINI_RATIOS, '1:4', '4:1', '1:8', '8:1'], resolutions: ['512', '1K', '2K', '4K'], refs: 14 },
  'gemini-3-pro-image': { name: 'Nano Banana Pro', family: 'Nano Banana', ratios: GEMINI_RATIOS, resolutions: ['1K', '2K', '4K'], refs: 10 },
  'gemini-3.1-flash-lite-image': { name: 'Nano Banana 2 Lite', family: 'Nano Banana', ratios: GEMINI_RATIOS, refs: 14 },
  'gemini-2.5-flash-image': { name: 'Nano Banana', family: 'Nano Banana', ratios: GEMINI_RATIOS, refs: 5 },
  'gpt-image-2.5-sunburst': { name: 'GPT Image 2.5 Sunburst', family: 'GPT Image', ratios: GPT2_RATIOS, resolutions: ['1K', '2K', '4K'], refs: 10, quality: ['low', 'medium', 'high', 'xhigh', 'max'], defaultQuality: 'high' },
  'gpt-image-2.5-flare': { name: 'GPT Image 2.5 Flare (faster)', family: 'GPT Image', ratios: GPT2_RATIOS, resolutions: ['1K', '2K', '4K'], refs: 10, quality: ['low', 'medium', 'high', 'xhigh', 'max'], defaultQuality: 'high' },
  'gpt-image-2': { name: 'GPT Image 2', family: 'GPT Image', ratios: GPT2_RATIOS, resolutions: ['1K', '2K', '4K'], refs: 10, quality: ['low', 'medium', 'high'] },
  'gpt-image-1.5': { name: 'GPT Image 1.5', family: 'GPT Image', ratios: ['1:1', '3:2', '2:3'], refs: 5, quality: ['low', 'medium', 'high'], background: true },
  'gpt-image-1': { name: 'GPT Image 1', family: 'GPT Image', ratios: ['1:1', '3:2', '2:3'], refs: 5, quality: ['low', 'medium', 'high'], background: true },
  'bytedance-seedream-5-pro': { name: 'Seedream 5 Pro', family: 'Seedream', ratios: ['auto', '1:1', '9:16', '16:9', '3:4', '4:3'], resolutions: ['1K', '2K'], refs: 10, note: 'ElevenLabs enables Seedream on request, and it is not available in the US.' },
  'bytedance-seedream-5-lite': { name: 'Seedream 5 Lite', family: 'Seedream', ratios: ['auto', '1:1', '9:16', '16:9', '3:4', '4:3'], resolutions: ['2K', '3K'], refs: 10, note: 'ElevenLabs enables Seedream on request, and it is not available in the US.' },
};
// Talking avatar: a photo + speech -> a lip-synced video.
const AVATAR_MODEL = 'creatify-aurora';
const AVATAR_RESOLUTIONS = ['480p', '720p'];

// Plans whose key cannot use the image and video API.
const NOT_PRO = new Set(['free', 'starter', 'creator']);
const PRO_URL = 'https://elevenlabs.io/pricing';
const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const MAX_INLINE = 25 * 1024 * 1024; // ElevenLabs' limit for inline files
const MAX_OUT = 300 * 1024 * 1024;

class GenError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 'pro_required' | 'no_key' | 'stopped' | ...
  }
}

const isPro = (tier) => (tier ? !NOT_PRO.has(String(tier).toLowerCase()) : null);

async function call(fetchImpl, url, opts) {
  try {
    return await fetchImpl(url, opts);
  } catch {
    throw new GenError('No internet connection.');
  }
}

async function elError(res) {
  let d = null;
  try {
    d = await res.json();
  } catch {
    // no body
  }
  const detail = d && d.detail;
  const code = detail && (detail.code || detail.status);
  const msg = Array.isArray(detail) ? detail.map((x) => x.msg).join('; ') : (detail && (detail.message || detail.status)) || '';
  if (res.status === 402 || code === 'paid_plan_required') {
    return new GenError('Video and photo generation needs an ElevenLabs Pro plan or higher.', 'pro_required');
  }
  if (res.status === 401) return new GenError('ElevenLabs refused the API key. Check it in Settings.');
  if (/quota|credits/i.test(String(msg))) return new GenError('Your ElevenLabs credits are used up for this month.');
  if (res.status === 429) return new GenError('ElevenLabs is busy or your plan limit was reached. Try again in a moment.');
  if (res.status === 403) return new GenError(`ElevenLabs has not enabled this model for your account${msg ? `: ${String(msg).slice(0, 200)}` : '.'}`);
  return new GenError(`ElevenLabs answered ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}.`);
}

// A file from disk as an inline reference.
function inline(file, types, what) {
  const type = types[path.extname(String(file || '')).toLowerCase()];
  if (!type) throw new GenError(`This ${what} type is not supported (${Object.keys(types).join(', ')}).`);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new GenError(`A ${what} was moved or deleted.`);
  }
  if (st.size > MAX_INLINE) throw new GenError(`The ${what} is larger than 25 MB.`);
  return { type: 'inline_base64', content_base64: fs.readFileSync(file).toString('base64'), mime_type: type };
}
const photo = (f) => inline(f, PHOTO_TYPES, 'photo');

function checkPrompt(o) {
  const prompt = String(o.prompt || '').trim();
  if (!prompt) throw new GenError('Describe what to generate first.');
  if (prompt.length > 2000) throw new GenError('The description is too long (2000 characters at most).');
  return prompt;
}
const pick = (list, v, fallback) => (list && list.includes(v) ? v : fallback);

// Checks the options and builds the API request body.
// video: { model, prompt, ratio, duration, resolution, audio, negative, start, end, refs: [{ path, role }], videoRefs: [path] }
// image: { model, prompt, ratio, resolution, quality, background, refs: [path] }
// avatar: { photo, audio (mp3/wav path), resolution }
function buildRequest(kind, o = {}) {
  if (kind === 'video') {
    const m = VIDEO_MODELS[o.model];
    if (!m) throw new GenError('Unknown video model.');
    const prompt = checkPrompt(o);
    const refs = (o.refs || []).filter((r) => r && r.path);
    const videoRefs = (o.videoRefs || []).filter(Boolean);
    const frames = !!(o.start || o.end);
    if (frames && (refs.length || videoRefs.length)) throw new GenError('Use start/end photos or reference photos, not both.');
    if (refs.length > m.refs) throw new GenError(`${m.name} takes ${m.refs} reference photos at most.`);
    if (videoRefs.length && !m.videoRefs) throw new GenError(`${m.name} does not take reference videos.`);
    if (videoRefs.length > (m.videoRefs || 0)) throw new GenError(`${m.name} takes ${m.videoRefs} reference videos at most.`);
    let duration = Number(o.duration);
    duration = m.durations ? pick(m.durations, duration, 8) : Math.round(Math.min(m.range[1], Math.max(m.range[0], duration || 5)));
    // Veo needs 8 seconds with reference photos; Seedance 2.5 picks the format itself from frames.
    if (m.family === 'veo' && refs.length) duration = 8;
    const body = {
      model_id: o.model,
      prompt,
      aspect_ratio: o.model === 'bytedance-seedance-v2.5' && frames ? 'auto' : pick(m.ratios, o.ratio, m.ratios[0]),
      duration_secs: duration,
      resolution: pick(m.resolutions, o.resolution, '720p'),
      generate_audio: o.audio !== false,
    };
    if (o.start) body.start_frame = photo(o.start);
    if (o.end) body.end_frame = photo(o.end);
    if (refs.length) {
      body.images = m.refRoles
        ? refs.map((r) => ({ image: photo(r.path), role: r.role === 'style' ? 'style' : 'subject' }))
        : refs.map((r) => photo(r.path));
    }
    if (videoRefs.length) body.videos = videoRefs.map((f) => inline(f, VIDEO_TYPES, 'video'));
    if (m.family === 'veo' && String(o.negative || '').trim()) body.negative_prompt = String(o.negative).trim().slice(0, 1000);
    return body;
  }
  if (kind === 'image') {
    const m = IMAGE_MODELS[o.model];
    if (!m) throw new GenError('Unknown photo model.');
    const prompt = checkPrompt(o);
    const refs = (o.refs || []).filter(Boolean);
    if (refs.length > m.refs) throw new GenError(`${m.name} takes ${m.refs} reference photos at most.`);
    const body = { model_id: o.model, prompt, aspect_ratio: pick(m.ratios, o.ratio, m.ratios.includes('1:1') ? '1:1' : m.ratios[0]) };
    if (m.resolutions) body.resolution = pick(m.resolutions, o.resolution, m.resolutions.includes('1K') ? '1K' : m.resolutions[0]);
    if (m.quality) body.quality = pick(m.quality, o.quality, m.defaultQuality || 'medium');
    if (m.background) body.background = pick(['auto', 'transparent', 'opaque'], o.background, 'auto');
    if (refs.length) body.images = refs.map(photo);
    return body;
  }
  if (kind === 'avatar') {
    if (!o.photo) throw new GenError('Pick the photo of the person first.');
    if (!o.audio) throw new GenError('Add what the person says first.');
    return { model_id: AVATAR_MODEL, image: photo(o.photo), audio: inline(o.audio, AUDIO_TYPES, 'audio'), resolution: pick(AVATAR_RESOLUTIONS, o.resolution, '720p') };
  }
  throw new GenError('Unknown kind.');
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// Downloads the finished file. The key is sent only to ElevenLabs itself, never to the storage host.
async function save(fetchImpl, key, url, mime, outDir, base) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new GenError('ElevenLabs sent an invalid download link.');
  }
  if (u.protocol !== 'https:') throw new GenError('ElevenLabs sent an insecure download link.');
  const res = await call(fetchImpl, u.toString(), u.hostname === 'api.elevenlabs.io' ? { headers: { 'xi-api-key': key } } : {});
  if (!res.ok) throw new GenError(`Download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.length > MAX_OUT) throw new GenError('The generated file is not valid.');
  const ext = /mp4/.test(mime) ? '.mp4' : /webp/.test(mime) ? '.webp' : /jpe?g/.test(mime) ? '.jpg' : /png/.test(mime) ? '.png' : (/^video/.test(mime) ? '.mp4' : '.png');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${base}${ext}`);
  fs.writeFileSync(`${file}.part`, buf);
  fs.renameSync(`${file}.part`, file);
  return file;
}

// Generates one video, photo or talking avatar and saves it in outDir.
// onStatus('sending' | 'pending' | 'generating' | 'saving'). Returns { path, kind, prompt, model, ... }.
async function run(fetchImpl, key, outDir, kind, opts, { onStatus, signal, pollMs } = {}) {
  if (!key) throw new GenError('Add your ElevenLabs API key in Settings.', 'no_key');
  const body = buildRequest(kind, opts);
  const flow = kind === 'image' ? 'image' : 'video';
  onStatus?.('sending');
  const res = await call(fetchImpl, `${EL}/flows/${flow}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await elError(res);
  const { id } = await res.json();
  if (!/^[\w-]{4,80}$/.test(String(id))) throw new GenError('ElevenLabs did not start the generation.');
  onStatus?.('pending');
  // Videos are polled every 10 s, photos every 2 s growing to 10 s, as ElevenLabs asks; 30 minutes at most.
  let wait = pollMs ?? (flow === 'video' ? 10000 : 2000);
  for (let waited = 0; waited < 30 * 60000; waited += wait) {
    await sleep(wait, signal);
    if (signal?.aborted) throw new GenError('Stopped. A generation that already started may still use credits.', 'stopped');
    const g = await call(fetchImpl, `${EL}/flows/${flow}/${id}`, { headers: { 'xi-api-key': key, Accept: 'application/json' } });
    if (!g.ok) throw await elError(g);
    const d = await g.json();
    if (d.status === 'completed') {
      onStatus?.('saving');
      const file = await save(fetchImpl, key, d.content_url, String(d.content_mime_type || ''), outDir, `${kind}-${Date.now()}`);
      const meta = { kind, prompt: body.prompt || opts.label || 'Talking avatar', model: body.model_id, engine: 'elevenlabs', createdAt: Date.now() };
      fs.writeFileSync(`${file}.json`, JSON.stringify(meta), 'utf8');
      return { path: file, ...meta };
    }
    if (d.status === 'failed') {
      if (d.failure_reason === 'moderated') throw new GenError('ElevenLabs declined this request. Try rewording it or another photo. Failed generations are not charged.');
      throw new GenError(`The generation failed${d.error_message ? `: ${String(d.error_message).slice(0, 200)}` : ''}. Failed generations are not charged.`);
    }
    onStatus?.(d.status === 'generating' ? 'generating' : 'pending');
    if (flow !== 'video' && pollMs == null) wait = Math.min(wait * 2, 10000);
  }
  throw new GenError('The generation is taking too long. Try again later.');
}

// Earlier generations in outDir, newest first: [{ path, kind, prompt, model, createdAt }].
function list(outDir) {
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir)
    .filter((f) => /\.(mp4|png|jpg|webp)$/.test(f) && fs.existsSync(path.join(outDir, `${f}.json`)))
    .map((f) => {
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(outDir, `${f}.json`), 'utf8'));
      } catch {
        // keep the file even when its description is unreadable
      }
      const kind = meta.kind || (f.endsWith('.mp4') ? 'video' : 'image');
      return { path: path.join(outDir, f), kind, prompt: meta.prompt || '', model: meta.model || '', createdAt: meta.createdAt || 0 };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ---- My avatars: photos of people kept in their own folder to reuse in every project. ----
function avatarList(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => PHOTO_TYPES[path.extname(f).toLowerCase()])
    .map((f) => ({ path: path.join(dir, f), name: path.basename(f, path.extname(f)).replace(/-\d{13}$/, ''), createdAt: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function avatarAdd(dir, file, name) {
  const ext = path.extname(String(file)).toLowerCase();
  if (!PHOTO_TYPES[ext]) throw new GenError('Pick a JPG, PNG or WEBP photo.');
  if (fs.statSync(file).size > MAX_INLINE) throw new GenError('The photo is larger than 25 MB.');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name || path.basename(file, ext)).replace(/[^\w -]+/g, '').trim().slice(0, 40) || 'Avatar';
  const out = path.join(dir, `${safe}-${Date.now()}${ext}`);
  fs.copyFileSync(file, out);
  return out;
}

function avatarRemove(dir, file) {
  const full = path.resolve(file);
  if (path.dirname(full) !== path.resolve(dir)) throw new GenError('Not an avatar.');
  fs.rmSync(full, { force: true });
}

// What the UI needs to build its forms.
const catalog = () => ({ video: VIDEO_MODELS, image: IMAGE_MODELS, avatar: { model: AVATAR_MODEL, resolutions: AVATAR_RESOLUTIONS }, proUrl: PRO_URL });

module.exports = {
  VIDEO_MODELS, IMAGE_MODELS, AVATAR_MODEL, AUDIO_TYPES, PRO_URL, GenError,
  isPro, buildRequest, run, list, avatarList, avatarAdd, avatarRemove, catalog,
};
