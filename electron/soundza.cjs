// Sound effects from Soundza (https://soundza.com/developers): a free catalog of music, sound
// effects and ambience behind a REST API. Needs the user's own free API key, which only this
// process sees (Authorization: Bearer). Their model: search the catalog, fetch a result's
// download_url when the user adds the sound to a project, save the file once and reuse it by
// the sound's id (a sound's file never changes). Sounds come under the Soundza Standard
// License: royalty-free for personal and commercial work, no attribution required; the UI
// still shows their "Powered by soundza" credit line, as they ask.
// Pure module: the caller passes `fetch` (Electron's net.fetch in the app, a stub in tests).
const fs = require('fs');
const path = require('path');

// Dev/test override (same pattern as CLIPCRAFT_PACK_URL / CLIPCRAFT_UPDATE_URL): point the
// client at a local fixture server. Localhost is trusted only while the override is set.
const API = process.env.CLIPCRAFT_SOUNDZA_URL || 'https://api.soundza.com/v1';
const OVERRIDE = !!process.env.CLIPCRAFT_SOUNDZA_URL;
const MAX_BYTES = 60 * 1024 * 1024;
const PER_PAGE = 20;

function hostOk(url) {
  try {
    const u = new URL(url);
    if (OVERRIDE && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u.protocol === 'http:' || u.protocol === 'https:';
    return u.protocol === 'https:' && u.hostname === 'api.soundza.com';
  } catch {
    return false;
  }
}

const GOOD_FOR = ['transition', 'reveal', 'build_up', 'impact_on_beat', 'title_or_logo', 'notification', 'ui_click', 'menu', 'game_pickup', 'game_hit', 'game_power_up', 'footsteps', 'background_bed', 'intro', 'outro'];
const TYPES = ['sound_effect', 'music', 'ambience'];
const STYLES = ['retro', 'cartoon'];

// Bounded retry on the transient answers (429 rate limit, 503 busy), honouring Retry-After —
// the same policy as the Forge fix: a capacity blip must not become a user-visible failure,
// but the wait stays short enough for an interactive picker.
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(fetchImpl, url, opts) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, opts);
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw new Error('No internet connection.');
      await sleep(1200 * attempt);
      continue;
    }
    if (res.ok || (res.status !== 429 && res.status !== 503) || attempt === MAX_ATTEMPTS) return res;
    const ra = Number.parseInt(res.headers?.get?.('retry-after'), 10);
    const wait = Number.isFinite(ra) && ra >= 0 ? Math.min(ra, 15) * 1000 : Math.min(6000, 1500 * 2 ** (attempt - 1));
    if (wait > 0) await sleep(wait);
  }
  throw new Error('Soundza did not answer.');
}

// Their error bodies are JSON: { error: { code, message } }. Turn them into plain words.
async function apiError(res) {
  let code = '';
  let message = '';
  try {
    const d = await res.json();
    code = d?.error?.code || '';
    message = d?.error?.message || '';
  } catch { /* unreadable body: fall through to the status */ }
  if (res.status === 401) {
    if (code === 'revoked_key') return new Error('The Soundza API key was revoked. Get a new free key in Settings.');
    if (code === 'key_required') return new Error('Soundza needs a free API key for this. Add yours in Settings.');
    return new Error('Soundza refused the API key. Check it in Settings.');
  }
  if (res.status === 429) return new Error('Soundza is busy right now (rate limit). Try again in a minute.');
  if (res.status === 404) return new Error('That sound is no longer on Soundza.');
  if (res.status === 400 && message) return new Error(`Soundza could not run that search: ${message}`);
  if (res.status >= 500) return new Error('Soundza had a problem on its side. Try again shortly.');
  return new Error(message ? `Soundza answered ${res.status}: ${message}` : `Soundza answered ${res.status}.`);
}

function mapSound(s) {
  const previews = Array.isArray(s.preview_files) ? s.preview_files : [];
  const preview = previews.find((p) => p && p.link && /mp3/i.test(p.type || '')) || previews.find((p) => p && p.link);
  const ext = /^[a-z0-9]{2,5}$/.test(String(s.file_extension || '').toLowerCase()) ? String(s.file_extension).toLowerCase() : 'wav';
  return {
    id: `soundza-${s.id}`,
    rawId: String(s.id),
    title: s.title || 'Untitled',
    creator: (s.creator && s.creator.name) || 'Soundza',
    duration: Number(s.duration) || 0,
    license: 'soundza',
    licenseName: (s.license && s.license.name) || 'Soundza Standard License',
    licenseUrl: (s.license && s.license.url) || 'https://soundza.com/license',
    landing: s.url || '',
    tags: Array.isArray(s.tags) ? s.tags.map(String).slice(0, 8) : [],
    category: (s.category && s.category.label) || '',
    packName: (s.pack && s.pack.name) || '',
    previewUrl: preview ? String(preview.link) : '',
    downloadUrl: s.download_url || '',
    fileExt: ext,
    attribution: s.attribution || '',
    provider: 'soundza',
    providerName: 'Soundza',
  };
}

// opts: { q, goodFor, category, style, type, page }. Returns { results, total, page, pages }.
async function search(fetchImpl, key, { q = '', goodFor = '', category = '', style = '', type = 'sound_effect', page = 1 } = {}) {
  if (!key) throw new Error('Add your free Soundza API key in Settings to search sound effects.');
  const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(Math.max(1, Math.min(25, page | 0))) });
  params.set('type', TYPES.includes(type) ? type : 'sound_effect');
  const query = String(q || '').trim().slice(0, 100);
  if (query) params.set('q', query);
  if (GOOD_FOR.includes(goodFor)) params.set('good_for', goodFor);
  if (/^[A-Za-z][A-Za-z ]{1,40}$/.test(String(category || ''))) params.set('category', String(category));
  if (STYLES.includes(style)) params.set('style', style);
  if (!query && !params.has('good_for') && !params.has('category') && !params.has('style')) params.set('q', 'whoosh');
  const res = await fetchRetry(fetchImpl, `${API}/sounds/search?${params}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'User-Agent': 'ClipCraft' },
  });
  if (!res.ok) throw await apiError(res);
  const d = await res.json().catch(() => null);
  if (!d || !Array.isArray(d.sounds)) throw new Error('Soundza sent an answer ClipCraft could not read.');
  const results = d.sounds.filter((s) => s && s.id && /^[\w-]{1,100}$/.test(String(s.id))).map(mapSound);
  const p = Number(d.page) || page;
  // next_page is a full URL on every page but the last: pages = "one more" while it is set,
  // the same convention the MyInstants search uses.
  return { results, total: Number(d.total_results) || results.length, page: p, pages: d.next_page ? p + 1 : p };
}

// Downloads (once) a search result into dir/soundza, keyed by the sound's id: later adds of
// the same sound reuse the file without another request, as Soundza's guidelines ask.
async function download(fetchImpl, dir, item, key) {
  if (!key) throw new Error('Add your free Soundza API key in Settings to download sounds.');
  const rawId = String(item?.rawId || String(item?.id || '').replace(/^soundza-/, ''));
  if (!/^[\w-]{1,100}$/.test(rawId)) throw new Error('This sound cannot be downloaded.');
  const ext = /^[a-z0-9]{2,5}$/.test(String(item?.fileExt || '').toLowerCase()) ? String(item.fileExt).toLowerCase() : 'wav';
  const out = path.join(dir, 'soundza', `${rawId}.${ext}`);
  if (fs.existsSync(out)) return out;
  if (!item.downloadUrl || !hostOk(item.downloadUrl)) throw new Error('This sound cannot be downloaded.');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // The download_url answers with a redirect to a short-lived signed link; fetch follows it.
  // The signed target is deliberately not host-pinned: it is a one-off link Soundza itself
  // issued for this sound, fetched with the user's key, and its host is theirs to choose.
  const res = await fetchRetry(fetchImpl, item.downloadUrl, {
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ClipCraft' },
  });
  if (!res.ok) throw await apiError(res);
  const type = res.headers.get('content-type') || '';
  if (!/^audio\/|octet-stream/.test(type)) throw new Error('The server did not send an audio file.');
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('The file is too large.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES || buf.length < 100) throw new Error('The downloaded file is not valid.');
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}

// Fetches (once) a result's preview MP3 into dir/previews, keyed by the sound's id. The
// renderer may only play local media (the app's content policy), so previews cannot stream
// straight from Soundza; the main process fetches the small preview encode instead. Preview
// links need no key and do not count toward the download limits.
async function preview(fetchImpl, dir, item) {
  const rawId = String(item?.rawId || String(item?.id || '').replace(/^soundza-/, ''));
  if (!/^[\w-]{1,100}$/.test(rawId)) throw new Error('This sound has no preview.');
  const link = String(item?.previewUrl || '');
  let ok = false;
  try {
    const u = new URL(link);
    ok = (u.protocol === 'https:' && u.hostname === 'media.soundza.com')
      || (OVERRIDE && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && /^https?:$/.test(u.protocol));
  } catch { /* not a URL */ }
  if (!ok) throw new Error('This sound has no preview.');
  const out = path.join(dir, 'previews', `${rawId}.mp3`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = await fetchRetry(fetchImpl, link, { headers: { 'User-Agent': 'ClipCraft' } });
  if (!res.ok) throw await apiError(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024 || buf.length < 100) throw new Error('The preview file is not valid.');
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}

// The credit line Soundza prepares for each sound; used in the media item's credit record.
function creditLine(item) {
  return item.attribution || `"${item.title}" on Soundza${item.landing ? ` (${item.landing})` : ''}`;
}

module.exports = { search, download, preview, creditLine, hostOk, API, GOOD_FOR };
