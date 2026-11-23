// Openverse metadata is a discovery aid, not independent verification of the source's rights.
// Anonymous, bounded searches; originals are downloaded only when previewed or imported.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const API = process.env.FVE_SMOKE && process.env.FVE_OPENVERSE_API || 'https://api.openverse.org/v1/';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HOSTS = ['api.openverse.org', 'staticflickr.com', 'wikimedia.org', 'freesound.org', 'jamendo.com', 'metmuseum.org', 'rawpixel.com', 'images.nasa.gov'];
const cache = new Map();
let retryAt = 0;

function hostOk(value) {
  try {
    const u = new URL(value);
    if (process.env.FVE_SMOKE && process.env.FVE_OPENVERSE_API && u.origin === new URL(API).origin) return true;
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}
const webLink = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const permits = (license, selection) => license === 'cc0' || (selection === 'attribution' && license === 'by');
const collection = kind => kind === 'photo' ? 'images' : 'audio';

function mapResult(r, kind, licenses) {
  if (!ID.test(r.id) || !permits(r.license, licenses) || !hostOk(r.url) || r.mature) return null;
  const licenseUrl = webLink(r.license_url);
  if (!licenseUrl || new URL(licenseUrl).hostname !== 'creativecommons.org') return null;
  const licensePath = new URL(licenseUrl).pathname;
  if (r.license === 'cc0' ? !/^\/publicdomain\/zero\/1\.0(?:\/|$)/.test(licensePath)
    : !/^\/licenses\/by\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/|$)/.test(licensePath)) return null;
  const title = String(r.title || 'Untitled').slice(0, 500), creator = String(r.creator || 'Unknown').slice(0, 300);
  return {
    id: `openverse-${r.id}`, openverseId: r.id, origin: 'openverse', kind, licenses,
    title, tags: title, creator, user: creator, creatorUrl: webLink(r.creator_url),
    license: r.license, licenseVersion: r.license_version || '',
    licenseName: r.license === 'cc0' ? 'CC0' : `CC BY ${r.license_version || ''}`.trim(),
    licenseUrl, landing: webLink(r.foreign_landing_url), pageURL: webLink(r.foreign_landing_url),
    attribution: String(r.attribution || '').slice(0, 4000),
    provider: r.source || r.provider, providerName: r.source || r.provider || 'Openverse',
    url: r.url, thumb: hostOk(r.thumbnail) ? r.thumbnail : '',
    width: r.width || 0, height: r.height || 0, duration: (r.duration || 0) / 1000,
  };
}

async function json(fetchImpl, url) {
  if (Date.now() < retryAt) throw Error('Openverse is busy. Please wait before searching again.');
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) {
    const raw = res.headers.get('retry-after');
    const delay = Number(raw) * 1000 || Date.parse(raw) - Date.now() || 60000;
    retryAt = Date.now() + Math.max(1000, delay);
    throw Error('Openverse is busy. Please wait before searching again.');
  }
  if (!res.ok) throw Error(`Openverse answered ${res.status}. Try again later.`);
  return res.json();
}

async function search(fetchImpl, { kind = 'photo', q = '', category = '', orientation = '', page = 1, licenses = 'cc0' } = {}) {
  const n = Math.max(1, Math.min(20, page | 0));
  const params = new URLSearchParams({ q: String(q || category || (kind === 'music' ? 'background music' : kind === 'photo' ? 'nature' : 'sound effect')).slice(0, 200),
    license: licenses === 'attribution' ? 'cc0,by' : 'cc0', page_size: '20', page: String(n), mature: 'false', filter_dead: 'true' });
  if (kind === 'photo' && ['horizontal', 'vertical'].includes(orientation)) params.set('aspect_ratio', orientation === 'horizontal' ? 'wide' : 'tall');
  if (kind !== 'photo') {
    params.set('source', kind === 'music' ? 'jamendo' : 'freesound');
    // Freesound records often lack category metadata; the source already scopes this to SFX.
    if (kind === 'music') params.set('category', 'music');
  }
  const url = `${API}${collection(kind)}/?${params}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.data;
  const d = await json(fetchImpl, url);
  const data = { results: (d.results || []).map(r => mapResult(r, kind, licenses)).filter(Boolean),
    total: d.result_count || 0, page: n, pages: Math.min(20, d.page_count || 1) };
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(url, { at: Date.now(), data });
  return data;
}

// Never trust a renderer/favorite's URL or licence when importing. Re-read the record by UUID.
async function resolve(fetchImpl, item) {
  const id = String(item?.openverseId || String(item?.id || '').replace(/^openverse-/, ''));
  if (!ID.test(id) || !['photo', 'music', 'sfx'].includes(item.kind)) throw Error('Invalid Openverse item. Search again.');
  const r = await json(fetchImpl, `${API}${collection(item.kind)}/${id}/`);
  const out = mapResult(r, item.kind, item.licenses === 'attribution' ? 'attribution' : 'cc0');
  if (!out || out.openverseId !== id) throw Error('This item is no longer available under the selected licences. Search again.');
  return out;
}

async function file(fetchImpl, url, outBase, kind, max) {
  if (!hostOk(url)) throw Error('Unsupported Openverse file host. Open the source to check availability.');
  let current = url, res;
  // Validate each redirect before requesting it, including thumbnail redirects.
  for (let i = 0; i < 6; i++) {
    res = await fetchImpl(current, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      current = new URL(res.headers.get('location'), current).href;
      if (!hostOk(current)) throw Error('The download redirects to an unsupported site.');
    } else break;
  }
  if (!res.ok) throw Error(`Openverse file download failed (${res.status}).`);
  if (res.url && !hostOk(res.url)) throw Error('Unsupported download destination.');
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const formats = kind === 'image' ? { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
    : { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac' };
  const ext = formats[mime];
  if (!ext) throw Error('The source did not send a supported media file.');
  if (Number(res.headers.get('content-length')) > max) throw Error('The Openverse file is too large.');
  const chunks = []; let size = 0;
  if (!res.body?.[Symbol.asyncIterator]) throw Error('The source did not send a downloadable file.');
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) { await res.body.cancel?.().catch(() => {}); throw Error('The Openverse file is too large.'); }
    chunks.push(Buffer.from(chunk));
  }
  if (size < 100) throw Error('The downloaded file is empty or invalid.');
  const out = `${outBase}.${ext}`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const part = `${out}.${crypto.randomUUID()}.part`;
  try { fs.writeFileSync(part, Buffer.concat(chunks)); fs.renameSync(part, out); }
  finally { fs.rmSync(part, { force: true }); }
  return out;
}

function credit(item) {
  const attribution = item.attribution || `"${item.title}" by ${item.creator}, ${item.licenseName} ${item.licenseUrl} - ${item.landing}`;
  const links = [item.creatorUrl, item.licenseUrl, item.landing].filter(url => url && !attribution.includes(url));
  return { title: item.title, creator: item.creator, creatorUrl: item.creatorUrl, license: item.license,
    licenseName: item.licenseName, licenseVersion: item.licenseVersion, licenseUrl: item.licenseUrl,
    landing: item.landing, providerName: item.providerName, origin: 'openverse', openverseId: item.openverseId,
    attribution, sourceVerified: false, line: `${attribution}${links.length ? `\n${links.join('\n')}` : ''}\nAdapted for use in this video.` };
}

async function download(fetchImpl, dir, item) {
  const canonical = await resolve(fetchImpl, item);
  const base = path.join(dir, 'openverse', `${collection(canonical.kind)}-${canonical.openverseId}`);
  const old = ['jpg','png','webp','gif','mp3','wav','flac','ogg','m4a','aac'].map(ext => `${base}.${ext}`).find(f => fs.existsSync(f));
  const dest = old || await file(fetchImpl, canonical.url, base, canonical.kind === 'photo' ? 'image' : 'audio', canonical.kind === 'photo' ? 40 * 1024 * 1024 : 60 * 1024 * 1024);
  return { path: dest, item: canonical, credit: credit(canonical) };
}
async function thumbnail(fetchImpl, dir, url) {
  const base = path.join(dir, 'openverse-thumbs', crypto.createHash('sha256').update(String(url)).digest('hex'));
  const old = ['jpg','png','webp','gif'].map(ext => `${base}.${ext}`).find(f => fs.existsSync(f));
  return old || file(fetchImpl, url, base, 'image', 5 * 1024 * 1024);
}
module.exports = { search, resolve, download, thumbnail, credit, hostOk };
