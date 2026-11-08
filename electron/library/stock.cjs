// Stock photos and videos from Pixabay (https://pixabay.com/api/docs/). Needs the user's own free API key,
// which only this process sees. Following Pixabay's rules: search results are cached for 24 hours, files are
// downloaded (never hotlinked) when the user adds them, and the UI says where the media comes from.
// The key is part of request URLs, so error messages never include a URL.
// Pure module: the caller passes `fetch` (Electron's net.fetch in the app, a mock in tests).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// UI tests point this at a local mock server.
const API = process.env.FVE_SMOKE && process.env.FVE_PIXABAY_API ? process.env.FVE_PIXABAY_API : 'https://pixabay.com/api/';
const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = { photo: 40 * 1024 * 1024, video: 400 * 1024 * 1024 };

function hostOk(url) {
  try {
    const u = new URL(url);
    if (process.env.FVE_SMOKE && process.env.FVE_PIXABAY_API && u.hostname === '127.0.0.1') return true;
    return u.protocol === 'https:' && (u.hostname === 'pixabay.com' || u.hostname.endsWith('.pixabay.com'));
  } catch {
    return false;
  }
}

const CATEGORIES = ['backgrounds', 'fashion', 'nature', 'science', 'education', 'feelings', 'health', 'people', 'religion', 'places',
  'animals', 'industry', 'computer', 'food', 'sports', 'transportation', 'travel', 'buildings', 'business', 'music'];

function mapHit(kind, h) {
  if (kind === 'video') {
    const v = h.videos || {};
    // 1080p when it exists (always for new videos), the 720p rendition otherwise.
    const file = (v.medium && v.medium.url) ? v.medium : v.small || v.tiny || {};
    return {
      id: String(h.id), kind, tags: h.tags || '', user: h.user || 'Pixabay', pageURL: h.pageURL, duration: h.duration || 0,
      thumb: (v.small && v.small.thumbnail) || (v.tiny && v.tiny.thumbnail) || '',
      width: file.width || 0, height: file.height || 0, url: file.url || '', size: file.size || 0,
    };
  }
  return {
    id: String(h.id), kind, tags: h.tags || '', user: h.user || 'Pixabay', pageURL: h.pageURL,
    thumb: h.webformatURL || h.previewURL || '', width: h.imageWidth || 0, height: h.imageHeight || 0,
    url: h.largeImageURL || h.webformatURL || '', size: h.imageSize || 0,
  };
}

const cache = new Map(); // request (without the key) -> { at, data }

// kind: 'photo' | 'video'. opts: { q, category, orientation, order, page }.
async function search(fetchImpl, key, { kind = 'photo', q = '', category = '', orientation = '', order = 'popular', page = 1 } = {}) {
  if (!key) throw new Error('Add your free Pixabay API key in Settings to search stock photos and videos.');
  const params = new URLSearchParams({ safesearch: 'true', per_page: '30', page: String(Math.max(1, Math.min(50, page | 0))), order: order === 'latest' ? 'latest' : 'popular' });
  const query = String(q || '').trim().slice(0, 100);
  if (query) params.set('q', query);
  if (CATEGORIES.includes(category)) params.set('category', category);
  if (kind === 'photo') {
    params.set('image_type', 'photo');
    if (['horizontal', 'vertical'].includes(orientation)) params.set('orientation', orientation);
  }
  const cacheKey = `${kind}?${params}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < DAY) return hit.data;

  let res;
  try {
    res = await fetchImpl(`${kind === 'video' ? `${API}videos/` : API}?key=${encodeURIComponent(key)}&${params}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('No internet connection.');
  }
  if (res.status === 429) throw new Error('Too many searches. Pixabay allows 100 per minute; wait a moment.');
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    if (/key/i.test(text) || res.status === 401 || res.status === 403) throw new Error('Pixabay refused the API key. Check it in Settings.');
    throw new Error(`Pixabay answered ${res.status}.`);
  }
  const d = await res.json();
  const results = (d.hits || []).map((h) => mapHit(kind, h)).filter((r) => hostOk(r.url) && (!r.thumb || hostOk(r.thumb)));
  const data = { results, total: d.totalHits || 0, page, pages: Math.max(1, Math.ceil((d.totalHits || 0) / 30)) };
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function fetchFile(fetchImpl, url, out, max) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  if (res.url && !hostOk(res.url)) throw new Error('The download was redirected to an unknown site.');
  if (Number(res.headers.get('content-length') || 0) > max) throw new Error('The file is too large.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max || buf.length < 100) throw new Error('The downloaded file is not valid.');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}

// Thumbnail of a search result, cached on disk (the page shows local files only).
async function thumbnail(fetchImpl, dir, url) {
  if (!hostOk(url)) throw new Error('Unknown thumbnail address.');
  const ext = /\.png(\?|$)/i.test(url) ? 'png' : 'jpg';
  const out = path.join(dir, 'thumbs', `${crypto.createHash('sha1').update(url).digest('hex')}.${ext}`);
  if (fs.existsSync(out)) return out;
  return fetchFile(fetchImpl, url, out, 5 * 1024 * 1024);
}

// Downloads (once) a photo or video from search() into dir/pixabay; returns the file path.
async function download(fetchImpl, dir, item) {
  if (!item || !['photo', 'video'].includes(item.kind) || !/^\d{1,12}$/.test(String(item.id)) || !hostOk(item.url)) {
    throw new Error('This file cannot be downloaded.');
  }
  const ext = item.kind === 'video' ? 'mp4' : /\.png(\?|$)/i.test(item.url) ? 'png' : 'jpg';
  const out = path.join(dir, 'pixabay', `pixabay-${item.kind}-${item.id}.${ext}`);
  if (fs.existsSync(out)) return out;
  return fetchFile(fetchImpl, item.url, out, MAX_BYTES[item.kind]);
}

const creditLine = (item) => `${item.kind === 'video' ? 'Video' : 'Photo'} by ${item.user} on Pixabay: ${item.pageURL}`;

module.exports = { search, thumbnail, download, creditLine, hostOk, CATEGORIES, _cache: cache };
