// Audio library: free music / sound effects found through the Openverse API (Jamendo music,
// Freesound effects). Only licenses that allow use in any video are requested: CC0, Public
// Domain Mark and CC BY (BY needs a credit line, which the app collects).
// SFXMint (https://sfxmint.com/api/docs) adds CC0 sound effects with no key; files may be downloaded and kept.
// (The old built-in effects, synthesized here with FFmpeg, were removed on Hamza's call —
// they sounded poor and synthetic next to real recordings.)
// Pure module: the caller passes `fetch` (Electron's net.fetch in the app, the global fetch in tests).
const fs = require('fs');
const path = require('path');

const API = 'https://api.openverse.org/v1/audio/';
const LICENSES = 'cc0,pdm,by';
// Hosts files may come from (after redirects too).
const FILE_HOSTS = ['jamendo.com', 'freesound.org', 'sfxmint.com', 'myinstants.com'];
const SFXMINT = 'https://sfxmint.com/api/v1/search';
const MAX_BYTES = 60 * 1024 * 1024;

const hostOk = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && FILE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

// ---- Openverse search ----
const LICENSE_NAMES = { cc0: 'CC0', pdm: 'Public domain', by: 'CC BY' };

function mapResult(r) {
  return {
    id: r.id,
    title: r.title || 'Untitled',
    creator: r.creator || 'Unknown',
    duration: (r.duration || 0) / 1000,
    license: r.license,
    licenseName: `${LICENSE_NAMES[r.license] || r.license.toUpperCase()}${r.license === 'by' && r.license_version ? ` ${r.license_version}` : ''}`,
    licenseUrl: r.license_url,
    landing: r.foreign_landing_url,
    url: r.url,
    provider: r.source || r.provider,
    providerName: { jamendo: 'Jamendo', freesound: 'Freesound' }[r.source || r.provider] || r.provider,
  };
}

// SFXMint: every library sound is CC0 (no credit needed). Search by words, or browse a category.
async function searchSfxmint(fetchImpl, { q, category }) {
  const params = new URLSearchParams({ limit: '50' });
  const query = String(q || '').trim().slice(0, 100);
  if (query) params.set('q', query);
  else if (/^[a-z-]{2,30}$/.test(String(category || ''))) params.set('category', category);
  else params.set('q', 'whoosh');
  let res;
  try {
    res = await fetchImpl(`${SFXMINT}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'ClipCraft' } });
  } catch {
    throw new Error('No internet connection.');
  }
  if (res.status === 429) throw new Error('The sound library is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`The sound library answered ${res.status}.`);
  const d = await res.json();
  const list = Array.isArray(d) ? d : d.results || [];
  const results = list
    .filter((r) => r && r.slug && /^[a-z0-9-]{1,90}$/.test(r.slug) && String(r.license).toUpperCase() === 'CC0' && hostOk(r.mp3_url))
    .map((r) => ({
      id: `sfxmint-${r.slug}`,
      title: r.title || r.slug,
      creator: 'SFXMint',
      category: r.category,
      duration: (r.duration_ms || 0) / 1000,
      license: 'cc0',
      licenseName: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      landing: r.page_url,
      url: r.mp3_url,
      provider: 'sfxmint',
      providerName: 'SFXMint',
    }));
  return { results, total: results.length, page: 1, pages: 1 };
}

// ---- MyInstants (the "Trolls" section: meme sounds) ----
// Read from the site's pages (the same thing the myinstants-api project does; its hosted copy sits behind a
// browser check). People upload these sounds and they carry no license, so every one is marked 'unknown'.
const MYINSTANTS = 'https://www.myinstants.com';
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescapeHtml = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ENTITIES[e.toLowerCase()] ?? m));

// One page of sounds from a MyInstants list page: [{ id, title, url, landing }], and whether a next page exists.
function parseMyinstants(html) {
  const results = [];
  const seen = new Set();
  const re = /play\('(\/media\/sounds\/[^']+?\.mp3)',\s*'loader-(\d+)',\s*'([\w-]{1,120})'\)[\s\S]{0,600}?class="instant-link[^"]*">([^<]{1,200})</g;
  let m;
  while ((m = re.exec(html))) {
    const [, file, num, slug, title] = m;
    if (seen.has(num)) continue;
    seen.add(num);
    const url = new URL(file, MYINSTANTS).toString();
    if (!hostOk(url)) continue;
    results.push({
      id: `myinstants-${num}`,
      title: unescapeHtml(title).trim() || slug,
      creator: 'MyInstants',
      duration: 0,
      license: 'unknown',
      licenseName: 'License unknown',
      licenseUrl: '',
      landing: `${MYINSTANTS}/en/instant/${slug}/`,
      url,
      provider: 'myinstants',
      providerName: 'MyInstants',
    });
  }
  return { results, hasNext: /rel="next"/.test(html) };
}

// category: 'trending' | 'best' when there are no words. Returns { results, total, page, pages }.
async function searchMyinstants(fetchImpl, { q, category, page = 1 }) {
  const n = Math.max(1, Math.min(50, page | 0));
  const query = String(q || '').trim().slice(0, 100);
  const url = query ? `${MYINSTANTS}/en/search/?${new URLSearchParams({ name: query, page: String(n) })}`
    : `${MYINSTANTS}/en/${category === 'best' ? 'best_of_all_time' : 'index'}/us/?page=${n}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 ClipCraft' } });
  } catch {
    throw new Error('No internet connection.');
  }
  if (res.status === 404) return { results: [], total: 0, page: n, pages: n };
  if (res.status === 429) throw new Error('MyInstants is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`MyInstants answered ${res.status}.`);
  const { results, hasNext } = parseMyinstants(await res.text());
  return { results, total: results.length, page: n, pages: hasNext ? n + 1 : n };
}

// Sound effects from both online sources in one list: SFXMint (category, or the words) on the first page, mixed
// with Freesound (the words), whose further pages follow. One source failing still shows the other.
async function searchAllSfx(fetchImpl, { q, category, page = 1 }) {
  const [mint, fs_] = await Promise.allSettled([
    page > 1 ? Promise.resolve({ results: [] }) : searchSfxmint(fetchImpl, { q: category ? '' : q, category }),
    search(fetchImpl, { kind: 'sfx', q, page }),
  ]);
  if (mint.status === 'rejected' && fs_.status === 'rejected') throw mint.reason;
  const a = mint.status === 'fulfilled' ? mint.value.results : [];
  const b = fs_.status === 'fulfilled' ? fs_.value.results : [];
  const results = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) results.push(a[i]);
    if (b[i]) results.push(b[i]);
  }
  const pages = fs_.status === 'fulfilled' ? fs_.value.pages : 1;
  return { results, total: results.length, page, pages };
}

// kind: 'music' | 'sfx' (Freesound) | 'sfxmint' | 'sfxall' (both) | 'trolls' (MyInstants).
// Returns { results, total, page, pages }.
async function search(fetchImpl, { kind, q, category, page = 1 }) {
  if (kind === 'trolls') return searchMyinstants(fetchImpl, { q, category, page });
  if (kind === 'sfxmint') return searchSfxmint(fetchImpl, { q, category });
  if (kind === 'sfxall') return searchAllSfx(fetchImpl, { q, category, page });
  const params = new URLSearchParams({
    q: String(q || '').slice(0, 200) || (kind === 'music' ? 'background music' : 'sound effect'),
    source: kind === 'music' ? 'jamendo' : 'freesound',
    license: LICENSES,
    page_size: '20',
    page: String(Math.max(1, Math.min(50, page | 0))),
  });
  if (kind === 'sfx') params.set('length', 'shortest,short');
  if (kind === 'music') params.set('category', 'music');
  const res = await fetchImpl(`${API}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': 'ClipCraft' } });
  const lib = kind === 'music' ? 'music' : 'sound';
  if (res.status === 429) throw new Error(`The ${lib} library is busy right now. Try again in a minute.`);
  if (!res.ok) throw new Error(`The ${lib} library answered ${res.status}.`);
  const d = await res.json();
  const results = (d.results || [])
    .filter((r) => ['cc0', 'pdm', 'by'].includes(r.license) && hostOk(r.url))
    .map(mapResult);
  return { results, total: d.result_count || 0, page: d.page || page, pages: d.page_count || 1 };
}

// Downloads (once) an item from search() into dir/online; returns the file path.
async function download(fetchImpl, dir, item) {
  if (!item || !hostOk(item.url) || !/^[\w-]{8,100}$/.test(String(item.id))) throw new Error('This sound cannot be downloaded.');
  const out = path.join(dir, 'online', `${item.id}.mp3`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = await fetchImpl(item.url, { headers: { 'User-Agent': 'ClipCraft' } });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  if (res.url && !hostOk(res.url)) throw new Error('The download was redirected to an unknown site.');
  const type = res.headers.get('content-type') || '';
  if (!/^audio\/|octet-stream/.test(type)) throw new Error('The server did not send an audio file.');
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('The file is too large.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES || buf.length < 1000) throw new Error('The downloaded file is not valid.');
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}

// One credit line, e.g. for a video description: title, author, licence and the sound's page.
function creditLine(c) {
  return `"${c.title}" by ${c.creator}, ${c.licenseName}${c.licenseUrl ? ` ${c.licenseUrl}` : ''}${c.landing ? ` - ${c.landing}` : ''}`;
}

module.exports = { search, download, creditLine, hostOk, parseMyinstants };
