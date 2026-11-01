// Templates: ClipCraft projects whose marked clips ("replaceable", clip.slot) people swap for their own videos.
// They are published on Hamza's site (hamzaabika.com/clipcraft) and listed in the Templates tab.
//   pack()     writes the folder the admin uploads: template.json, the media it uses and thumb.jpg.
//   list() / detail() / download() / thumb() / preview() / use()  talk to the store's /api/v1/templates.
// Pure module: the caller passes `fetch` and the folders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BASE = (process.env.FVE_TEMPLATES_URL || 'https://hamzaabika.com/clipcraft').replace(/\/+$/, '');
const API = `${BASE}/api/v1/templates`;
const SLUG = /^[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Cache fields of a media item (made again on the PC that opens the template).
const GENERATED = ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH', 'wave', 'proxy', 'optimizing'];
const LIST_KEYS = ['q', 'category', 'ratio', 'clips', 'length', 'sort', 'page'];
const MAX_FILE = 1024 * 1024 * 1024;

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Template';

// Media ids the timeline uses (unused imports stay out of the package).
function usedMedia(p) {
  const ids = new Set();
  for (const key of ['videoClips', 'overlayClips', 'audioClips']) {
    for (const c of p[key] || []) if (c.mediaId && !c.gap) ids.add(c.mediaId);
  }
  return (p.media || []).filter((m) => ids.has(m.id));
}

function ffmpegFrame(ffmpegPath, file, at, out) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...(at > 0 ? ['-ss', String(at)] : []), '-i', file,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out], { windowsHide: true }, (e) => resolve(!e && fs.existsSync(out)));
  });
}

// Writes <parentDir>/<project name>/ with template.json, m0.mp4, m1.mp3, … and thumb.jpg. meta: { ratio, width,
// height, duration, slots } worked out by the interface. Returns { dir, files }.
async function pack(project, meta, parentDir, { ffmpegPath } = {}) {
  if (!meta || !(meta.slots >= 1)) throw new Error('Mark at least one clip as replaceable first (right-click a clip > Make replaceable).');
  let dir = path.join(parentDir, safeName(project.name));
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(parentDir, `${safeName(project.name)} ${n}`);
  fs.mkdirSync(dir, { recursive: true });
  const media = [];
  usedMedia(project).forEach((m, i) => {
    if (!m.path || !fs.existsSync(m.path)) throw new Error(`“${m.name}” was moved or deleted. Put it back or remove it from the timeline.`);
    const ext = (path.extname(m.path).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.bin'])[0];
    const name = `m${i}${ext}`;
    fs.copyFileSync(m.path, path.join(dir, name));
    const clean = { ...m, path: name };
    GENERATED.forEach((k) => delete clean[k]);
    media.push(clean);
  });
  // The format string is a data-format identifier, not branding. Packages written before the rename
  // carry the legacy v1 format id; the readers accept both ids (see the read checks), so every package
  // already in the wild keeps working.
  const doc = { format: 'clipcraft-template', version: 1, meta, project: { ...project, media } };
  fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify(doc, null, 1), 'utf8');
  // Cover picture: the first replaceable clip at its start.
  const first = [...(project.videoClips || []), ...(project.overlayClips || [])].find((c) => c.slot && !c.gap);
  const fm = first && project.media.find((m) => m.id === first.mediaId);
  if (ffmpegPath && fm && fs.existsSync(fm.path)) await ffmpegFrame(ffmpegPath, fm.path, fm.type === 'video' ? first.in || 0 : 0, path.join(dir, 'thumb.jpg'));
  return { dir, files: fs.readdirSync(dir) };
}

// ---- Site API ----
async function getJson(fetchImpl, url, { allow404 = false } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'ClipCraft' } });
  } catch {
    throw new Error('No internet connection. Templates need the internet.');
  }
  if (res.status === 404) {
    if (allow404) return null; // the store feed is not published yet: an empty store, not an error
    throw new Error('This template is no longer available.');
  }
  if (!res.ok) throw new Error(`The template store answered ${res.status}. Try again later.`);
  try {
    return await res.json();
  } catch {
    throw new Error('The template store sent an unreadable answer.');
  }
}

// Only files of the template store are downloaded.
const storeUrl = (u) => typeof u === 'string' && u.startsWith(`${API}/`);

async function list(fetchImpl, params = {}) {
  const q = new URLSearchParams();
  for (const k of LIST_KEYS) if (params[k] !== undefined && params[k] !== '' && params[k] !== null) q.set(k, String(params[k]).slice(0, 80));
  const d = await getJson(fetchImpl, `${API}${q.toString() ? `?${q}` : ''}`, { allow404: true });
  if (!d) return { templates: [], categories: [], page: 1, pages: 1, total: 0 };
  const templates = (d.templates || []).filter((t) => t && SLUG.test(String(t.id)));
  return { templates, categories: d.categories || [], page: d.page || 1, pages: d.pages || 1, total: d.total || templates.length };
}

async function detail(fetchImpl, id) {
  if (!SLUG.test(String(id))) throw new Error('Unknown template.');
  const d = await getJson(fetchImpl, `${API}/${id}`);
  if (!d.template || d.template.id !== id) throw new Error('The template store sent an unreadable answer.');
  return d.template;
}

// Downloads one file to dest (through a .part file), checking its size and SHA-256 when given.
async function fetchFile(fetchImpl, url, dest, { sha256, size, onBytes } = {}) {
  if (!storeUrl(url)) throw new Error('A template file points outside the template store.');
  if (fs.existsSync(dest) && (!sha256 || crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') === sha256)) {
    onBytes?.(fs.statSync(dest).size);
    return dest;
  }
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 'ClipCraft' } });
  } catch {
    throw new Error('No internet connection. Templates need the internet.');
  }
  if (!res.ok) throw new Error(`A template file could not be downloaded (${res.status}).`);
  const hash = crypto.createHash('sha256');
  const tmp = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.openSync(tmp, 'w');
  let total = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_FILE) throw new Error('A template file is too large.');
      hash.update(value);
      fs.writeSync(out, value);
      onBytes?.(value.length);
    }
  } finally {
    fs.closeSync(out);
  }
  if ((size && total !== size) || (sha256 && hash.digest('hex') !== sha256)) {
    fs.rmSync(tmp, { force: true });
    throw new Error('A template file arrived damaged. Try again.');
  }
  fs.renameSync(tmp, dest);
  return dest;
}

// The cover picture of a listed template, cached. Returns its path, or null.
async function thumb(fetchImpl, cacheDir, t) {
  if (!SLUG.test(String(t?.id)) || !storeUrl(t.thumb)) return null;
  return fetchFile(fetchImpl, t.thumb, path.join(cacheDir, t.id, 'thumb.jpg')).catch(() => null);
}

async function preview(fetchImpl, cacheDir, t) {
  if (!SLUG.test(String(t?.id)) || !storeUrl(t.preview)) throw new Error('This template has no preview.');
  const ext = /\.webm$/.test(t.preview) ? '.webm' : '.mp4';
  return fetchFile(fetchImpl, t.preview, path.join(cacheDir, t.id, `preview${ext}`));
}

// Downloads a template (everything but the preview) into cacheDir/<id>/ and returns the project as JSON text,
// with its media pointing at the downloaded files. onProgress(0..1).
async function download(fetchImpl, cacheDir, id, onProgress) {
  const t = await detail(fetchImpl, id);
  const dir = path.join(cacheDir, id);
  const files = (t.files || []).filter((f) => NAME.test(String(f.name)) && !/^preview\./.test(f.name));
  if (!files.some((f) => f.name === 'template.json')) throw new Error('This template is incomplete.');
  const total = files.reduce((s, f) => s + (Number(f.size) || 0), 0) || 1;
  let done = 0;
  for (const f of files) {
    await fetchFile(fetchImpl, f.url, path.join(dir, f.name), { sha256: f.sha256, size: f.size, onBytes: (n) => { done += n; onProgress?.(Math.min(1, done / total)); } });
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'));
  } catch {
    throw new Error('This template is damaged.');
  }
  // Both format ids are accepted on read — current packages and the legacy v1 format id alike.
  if (!['caprocket-template', 'clipcraft-template'].includes(doc.format) || doc.version !== 1 || !doc.project) throw new Error('This template needs a newer ClipCraft.');
  const media = (doc.project.media || []).map((m) => {
    if (!NAME.test(String(m.path)) || !fs.existsSync(path.join(dir, m.path))) throw new Error('This template is incomplete.');
    return { ...m, path: path.join(dir, m.path) };
  });
  return { template: t, json: JSON.stringify({ ...doc.project, media, template: { id, title: t.title } }) };
}

// Tells the site the template was used (for its "uses" count). Errors are ignored.
async function use(fetchImpl, id) {
  if (!SLUG.test(String(id))) return;
  await fetchImpl(`${API}/${id}/use`, { method: 'POST', headers: { 'User-Agent': 'ClipCraft' } }).catch(() => {});
}

module.exports = { BASE, pack, list, detail, download, thumb, preview, use, usedMedia };
