// Motion graphics service: validates a graphic job, renders it once (electron/graphics/render.cjs)
// and keeps the result by content, so the same code, inputs, fonts and size never render twice.
// Each graphic is a folder under user data:
//   graphic.mov   transparent lossless video (QuickTime RLE): what the export composites;
//   preview.webm  transparent VP9 copy: what the preview plays (Chromium cannot play RLE, and
//                 FFmpeg's own VP9 decoder drops alpha, so each format has its one job);
//   meta.json     size, frame rate, frame count and render timings.
// Graphics referenced by saved projects live here, so nothing is evicted automatically.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { GraphicImages, validateImages } = require('./images.cjs');

const VERSION = 'graphics-1';
const LIMITS = { code: 200000, inputs: 2 * 1024 * 1024, fonts: 3 * 1024 * 1024, seconds: 60, side: 4096 };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const run = (file, args, signal) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer', windowsHide: true }, (error, stdout, stderr) => error ? reject(Object.assign(Error(String(stderr || error.message).trim().split('\n').pop()), { name: signal?.aborted ? 'AbortError' : 'Error' })) : resolve(stdout));
  signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
});

// Throws a message the agent can act on, or returns the normalized job.
function validate(job) {
  const { code, inputs = {}, fonts = [], images = [], width, height, fps = 30, duration_sec } = job || {};
  if (typeof code !== 'string' || !code.trim()) throw Error('code must be the graphic component source.');
  if (code.length > LIMITS.code) throw Error(`The graphic code is too long (${code.length} characters; at most ${LIMITS.code}).`);
  if (!/export\s+default/.test(code)) throw Error('The graphic must `export default function render({ frame, fps, width, height, inputs, kit })`.');
  const inputText = JSON.stringify(inputs ?? {});
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) throw Error('inputs must be an object.');
  if (inputText.length > LIMITS.inputs) throw Error('inputs are too large (at most 2 MB).');
  if (!Array.isArray(fonts) || fonts.some((f) => !f || typeof f.family !== 'string' || typeof f.data !== 'string')) throw Error('Invalid fonts.');
  if (fonts.reduce((n, f) => n + f.data.length, 0) > LIMITS.fonts) throw Error('Too much font data: use fewer font families or weights.');
  if (![width, height].every((n) => Number.isInteger(n) && n >= 16 && n <= LIMITS.side)) throw Error('width and height must be whole pixels from 16 to 4096.');
  if (!(Number.isFinite(fps) && fps >= 1 && fps <= 60)) throw Error('fps must be from 1 to 60.');
  if (!(Number.isFinite(duration_sec) && duration_sec >= 0.2 && duration_sec <= LIMITS.seconds)) throw Error(`duration_sec must be from 0.2 to ${LIMITS.seconds} seconds.`);
  // Even sizes keep the VP9 preview's 4:2:0 alpha exact.
  return { code, inputs, fonts, images: validateImages(images), width: width + (width % 2), height: height + (height % 2), fps, frames: Math.max(1, Math.round(duration_sec * fps)) };
}

// The cache keeps at most this much; least recently used graphics go first. Graphics an open project
// uses and anything used in the last few minutes are never removed; a removed graphic is drawn
// again when a project that uses it opens (src/app/App.jsx).
const CACHE_MAX_BYTES = 4 * 1024 ** 3, RECENT_MS = 10 * 60 * 1000;
const dirSize = (dir) => { let n = 0; for (const f of fs.readdirSync(dir)) { try { n += fs.statSync(path.join(dir, f)).size; } catch {} } return n; };

class GraphicsService {
  constructor({ root, ffmpegPath, probe, renderGraphic, maxBytes = CACHE_MAX_BYTES, now = Date.now }) {
    Object.assign(this, { root, ffmpegPath, probe, renderGraphic, maxBytes, now }); this.inUse = new Map();
    this.images = new GraphicImages({ ffmpegPath, probe });
  }

  // The library pictures a request names ([{ id, path }]) become data for the sandbox, shrunk to
  // the canvas. Already prepared pictures pass through. Resolves the request ready for validate().
  async prepare(request, { signal } = {}) {
    const refs = request?.images;
    if (!refs?.length || refs.every((i) => i && typeof i.data === 'string')) return request;
    const side = Math.max(Number(request.width) || 0, Number(request.height) || 0);
    return { ...request, images: await this.images.prepare(refs, { side, signal }) };
  }

  // Keys an open project uses, per owner (a window); they survive pruning and clearing.
  setInUse(owner, keys) { if (keys?.length) this.inUse.set(owner, new Set(keys.map(String))); else this.inUse.delete(owner); }
  protectedKeys() { return new Set([...this.inUse.values()].flatMap((set) => [...set])); }

  // Cached graphics, least recently used first: [{ key, dir, bytes, used }].
  entries() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter((name) => !name.includes('.part-')).map((key) => {
      const dir = path.join(this.root, key);
      try { const meta = path.join(dir, 'meta.json'); return { key, dir, bytes: dirSize(dir), used: fs.existsSync(meta) ? fs.statSync(meta).mtimeMs : 0 }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.used - b.used);
  }
  usage() { const all = this.entries(); return { entries: all.length, bytes: all.reduce((n, e) => n + e.bytes, 0) }; }

  // Remove least recently used graphics until the cache fits (or all removable ones, for Clear).
  prune({ all = false, keep = [] } = {}) {
    const keepSet = new Set([...this.protectedKeys(), ...keep]), list = this.entries();
    let bytes = list.reduce((n, e) => n + e.bytes, 0), removed = 0;
    for (const e of list) {
      if (!all && bytes <= this.maxBytes) break;
      if (keepSet.has(e.key) || (!all && this.now() - e.used < RECENT_MS)) continue;
      fs.rmSync(e.dir, { recursive: true, force: true }); bytes -= e.bytes; removed++;
    }
    return { removed, ...this.usage() };
  }
  clear() { return this.prune({ all: true }); }

  key(job) {
    return sha(JSON.stringify([VERSION, job.code, job.inputs, job.fonts.map((f) => [f.family, f.weight, f.style, f.unicodeRange, sha(f.data)]), job.width, job.height, job.fps, job.frames,
      ...(job.images.length ? [job.images.map((i) => [i.id, i.type, i.width, i.height, sha(i.data)])] : [])])); // no pictures: the key graphics had before pictures existed
  }

  // Resolves with { key, file, preview, media (probe of the graphic), width, height, fps, frames,
  // duration_sec, cached, stats, samples: [{ time_sec, bytes (JPEG), width, height }] }.
  // samples false: no sample frames (the editor re-rendering a graphic needs none).
  async render(request, { signal, onProgress, sampleTimes, samples: wantSamples = true } = {}) {
    const job = validate(await this.prepare(request, { signal })), key = this.key(job), dir = path.join(this.root, key);
    const file = path.join(dir, 'graphic.mov'), preview = path.join(dir, 'preview.webm'), metaFile = path.join(dir, 'meta.json');
    let cached = fs.existsSync(file) && fs.existsSync(preview) && fs.existsSync(metaFile), stats;
    if (cached) {
      stats = JSON.parse(fs.readFileSync(metaFile, 'utf8')).stats;
      try { const t = new Date(this.now()); fs.utimesSync(metaFile, t, t); } catch {} // marks it recently used
    } else {
      const work = `${dir}.part-${crypto.randomBytes(4).toString('hex')}`;
      try {
        const out = await this.renderGraphic({ ffmpegPath: this.ffmpegPath, ...job, dir: work, signal, onProgress });
        stats = out.stats;
        const t = Date.now();
        await run(this.ffmpegPath, ['-v', 'error', '-y', '-i', out.file, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30',
          '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0', path.join(work, 'preview.webm')], signal);
        stats.preview_ms = Date.now() - t;
        fs.writeFileSync(path.join(work, 'meta.json'), JSON.stringify({ version: VERSION, width: job.width, height: job.height, fps: job.fps, frames: job.frames, stats }));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(work, dir);
      } catch (error) { fs.rmSync(work, { recursive: true, force: true }); throw error; }
      try { this.prune({ keep: [key] }); } catch {} // a full cache never fails a render
    }
    const duration = job.frames / job.fps;
    // Sample frames for the agent, over neutral grey (grey = transparent), at most 1024 px.
    const times = (sampleTimes?.length ? sampleTimes : [0.12, 0.3, 0.5, 0.7, 0.88, 1].map((f) => f * duration)).slice(0, 6)
      .map((t) => Math.min(job.frames - 1, Math.max(0, Math.round(t * job.fps))));
    const scale = Math.min(1, 1024 / Math.max(job.width, job.height)), w = Math.max(2, Math.round(job.width * scale / 2) * 2), h = Math.max(2, Math.round(job.height * scale / 2) * 2);
    const samples = [];
    for (const n of wantSamples ? [...new Set(times)] : []) {
      const bytes = await run(this.ffmpegPath, ['-v', 'error', '-i', file, '-f', 'lavfi', '-i', `color=c=0x3a3a3a:s=${job.width}x${job.height}`,
        '-filter_complex', `[0:v]select=eq(n\\,${n}),format=rgba[g];[1:v][g]overlay=format=auto:shortest=1,scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', '-q:v', '3', '-f', 'mjpeg', 'pipe:1'], signal);
      samples.push({ time_sec: Math.round(n / job.fps * 1000) / 1000, bytes, width: w, height: h });
    }
    const media = await this.probe(file);
    return { key, file, preview, media, width: job.width, height: job.height, fps: job.fps, frames: job.frames, duration_sec: duration, cached, stats, schema: stats?.schema ?? null, samples };
  }
}

module.exports = { CACHE_MAX_BYTES, GraphicsService, validate, VERSION };
