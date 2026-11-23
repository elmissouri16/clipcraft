const fs = require('fs');
const path = require('path');


// Hosts files may come from (after redirects too).
const FILE_HOSTS = ['myinstants.com'];
const MAX_BYTES = 60 * 1024 * 1024;

const hostOk = (url) => {
  try {
    const u = new URL(url);
    if (process.env.FVE_SMOKE && process.env.FVE_MYINSTANTS_URL && u.origin === new URL(MYINSTANTS).origin) return true;
    return u.protocol === 'https:' && FILE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

// ---- MyInstants (the "Trolls" section: meme sounds) ----
// Read from the site's pages (the same thing the myinstants-api project does; its hosted copy sits behind a
// browser check). People upload these sounds and they carry no license, so every one is marked 'unknown'.
const MYINSTANTS = process.env.FVE_SMOKE && process.env.FVE_MYINSTANTS_URL || 'https://www.myinstants.com';
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
  const nextLink = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].some(([tag]) => {
    const rel = /\brel\s*=\s*(['"])([^'"]*)\1/i.exec(tag);
    return rel?.[2].toLowerCase().split(/\s+/).includes('next');
  });
  // Current pages use a loading sentinel and request the next page until 404,
  // without rel=next. Do not advertise more pages for an empty result container.
  const infiniteScroll = /<div\b[^>]*\bid\s*=\s*(['"])loading\1/i.test(html)
    && /<div\b[^>]*\bid\s*=\s*(['"])instants_container\1/i.test(html);
  return { results, hasNext: results.length > 0 && (nextLink || infiniteScroll) };
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
  return { results, total: results.length, page: n, pages: hasNext && n < 50 ? n + 1 : n };
}

// Downloads (once) an item from search() into dir/online; returns the file path.
async function download(fetchImpl, dir, item) {
  if (!item || !/^[\w-]{8,100}$/.test(String(item.id))) throw new Error('This sound cannot be downloaded.');
  const out = path.join(dir, 'online', `${item.id}.mp3`);
  // A file already kept stays usable, including saved sounds from a source that is no longer offered.
  if (fs.existsSync(out)) return out;
  if (!hostOk(item.url)) throw new Error('This sound cannot be downloaded.');
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

module.exports = { search: searchMyinstants, download, creditLine, hostOk, parseMyinstants };
