// Audio library: built-in sound effects (made here with FFmpeg, no license needed) and free music / sound effects
// found through the Openverse API (Jamendo music, Freesound effects). Only licenses that allow use in any video
// are requested: CC0, Public Domain Mark and CC BY (BY needs a credit line, which the app collects).
// SFXMint (https://sfxmint.com/api/docs) adds CC0 sound effects with no key; files may be downloaded and kept.
// Pure module: the caller passes `fetch` (Electron's net.fetch in the app, the global fetch in tests).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath } = require('./ffmpeg.cjs');

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

// ---- Built-in sound effects: FFmpeg lavfi recipes (sample rate 44.1 kHz). ----
const fadeOut = (st, d) => `afade=t=out:st=${st}:d=${d}:curve=exp`;
const BUILTIN = [
  { id: 'whoosh', name: 'Whoosh', cat: 'Transition', src: "anoisesrc=d=0.9:c=pink:a=0.8:r=44100,highpass=f=250,lowpass=f=2800,afade=t=in:d=0.5:curve=qsin,afade=t=out:st=0.5:d=0.4:curve=qsin" },
  { id: 'swoosh', name: 'Fast swoosh', cat: 'Transition', src: "anoisesrc=d=0.4:c=white:a=0.6:r=44100,bandpass=f=2500:w=1800,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.22" },
  { id: 'riser', name: 'Riser', cat: 'Transition', src: "aevalsrc='0.35*sin(2*PI*(150*t+220*t*t))+0.15*(random(0)*2-1)*t/2.5':d=2.5:s=44100,afade=t=in:d=2:curve=exp,afade=t=out:st=2.4:d=0.1" },
  { id: 'drop', name: 'Bass drop', cat: 'Transition', src: `aevalsrc='0.9*sin(2*PI*(120*t-40*t*t))':d=1.4:s=44100,${fadeOut(0.1, 1.3)}` },
  { id: 'impact', name: 'Impact boom', cat: 'Hit', src: `aevalsrc='0.9*sin(2*PI*55*t)*exp(-3*t)+0.5*(random(0)*2-1)*exp(-14*t)':d=1.5:s=44100,lowpass=f=900` },
  { id: 'pop', name: 'Pop', cat: 'UI', src: "aevalsrc='0.8*sin(2*PI*(500*t+4000*t*t))*exp(-30*t)':d=0.15:s=44100" },
  { id: 'click', name: 'Click', cat: 'UI', src: "aevalsrc='(random(0)*2-1)*exp(-250*t)':d=0.05:s=44100,highpass=f=1500" },
  { id: 'ding', name: 'Ding', cat: 'UI', src: "aevalsrc='0.5*sin(2*PI*1318*t)*exp(-3*t)+0.25*sin(2*PI*2637*t)*exp(-5*t)':d=1.5:s=44100" },
  { id: 'notify', name: 'Notification', cat: 'UI', src: "aevalsrc='0.45*sin(2*PI*if(lt(t,0.14),880,1320)*t)*exp(-8*mod(t,0.14))':d=0.5:s=44100" },
  { id: 'success', name: 'Success chime', cat: 'UI', src: "aevalsrc='0.4*sin(2*PI*if(lt(t,0.12),523,if(lt(t,0.24),659,784))*t)*exp(-4*mod(t,0.12+0.88*gte(t,0.24)))':d=1.1:s=44100" },
  { id: 'error', name: 'Error buzz', cat: 'UI', src: "aevalsrc='0.25*sgn(sin(2*PI*150*t))*lt(mod(t,0.2),0.15)':d=0.4:s=44100,lowpass=f=2500" },
  { id: 'beep', name: 'Censor beep', cat: 'Funny', src: "sine=f=1000:d=0.8:r=44100,volume=0.4,afade=t=in:d=0.01,afade=t=out:st=0.78:d=0.02" },
  { id: 'boing', name: 'Cartoon boing', cat: 'Funny', src: "aevalsrc='0.6*sin(2*PI*(220*t+30*sin(2*PI*14*t)/(2*PI*14)*exp(-2*t)*40))*exp(-2.5*t)':d=1.2:s=44100" },
  { id: 'fall', name: 'Falling', cat: 'Funny', src: `aevalsrc='0.45*sin(2*PI*(1400*t-500*t*t))':d=1.2:s=44100,${fadeOut(0.9, 0.3)}` },
  { id: 'tick', name: 'Clock ticking', cat: 'Ambience', src: "aevalsrc='0.8*sin(2*PI*if(lt(mod(t,1),0.5),3000,2400)*t)*exp(-180*mod(t,0.5))':d=4:s=44100" },
  { id: 'heartbeat', name: 'Heartbeat', cat: 'Ambience', src: "aevalsrc='0.9*sin(2*PI*50*t)*(exp(-25*mod(t,0.9))+0.7*exp(-25*abs(mod(t,0.9)-0.25))*gte(mod(t,0.9),0.25))':d=3.6:s=44100" },
  { id: 'typing', name: 'Keyboard typing', cat: 'Ambience', src: "aevalsrc='(random(0)*2-1)*exp(-400*mod(t+0.03*sin(7*t),0.13))':d=3:s=44100,highpass=f=1200" },
  { id: 'shutter', name: 'Camera shutter', cat: 'Hit', src: "aevalsrc='(random(0)*2-1)*(exp(-120*t)+0.8*exp(-120*abs(t-0.09))*gte(t,0.09))':d=0.35:s=44100,highpass=f=900" },
  { id: 'glitch', name: 'Glitch', cat: 'Transition', src: "aevalsrc='0.5*sgn(sin(2*PI*(80+800*random(1))*t))*lt(mod(t,0.07),0.04)':d=0.6:s=44100,lowpass=f=5000" },
  { id: 'rain', name: 'Rain', cat: 'Ambience', src: "anoisesrc=d=6:c=pink:a=0.35:r=44100,lowpass=f=6000,highpass=f=400,afade=t=in:d=0.8,afade=t=out:st=5.2:d=0.8" },
];

function builtinList() {
  return BUILTIN.map(({ id, name, cat }) => ({ id: `builtin-${id}`, title: name, category: cat, creator: 'ClipCraft', license: 'builtin', provider: 'builtin' }));
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-1500)))));
  });
}

// Peak level of a file in dB (FFmpeg volumedetect).
function maxVolume(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', () => {
      const m = err.match(/max_volume: (-?[\d.]+|-inf) dB/);
      resolve(m && m[1] !== '-inf' ? Number(m[1]) : -3);
    });
  });
}

// Path of a built-in effect, made on first use.
async function builtinFile(dir, id) {
  const fx = BUILTIN.find((b) => `builtin-${b.id}` === id);
  if (!fx) throw new Error('Unknown sound');
  const out = path.join(dir, 'builtin', `${fx.id}.mp3`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Render, measure the peak, then encode with every effect peaking at -3 dB.
  const wav = `${out}.part.wav`;
  const tmp = `${out}.part.mp3`;
  await run(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', fx.src, '-af', 'aformat=channel_layouts=stereo', wav]);
  const peak = await maxVolume(wav);
  const gain = Math.max(-20, Math.min(40, -3 - peak));
  await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-af', `volume=${gain.toFixed(1)}dB,alimiter=limit=0.95`, '-c:a', 'libmp3lame', '-b:a', '192k', tmp]);
  fs.rmSync(wav, { force: true });
  fs.renameSync(tmp, out);
  return out;
}

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
    throw new Error('No internet connection. Offline sound effects still work.');
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
    throw new Error('No internet connection. Offline sound effects still work.');
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

module.exports = { BUILTIN, builtinList, builtinFile, search, download, creditLine, hostOk, parseMyinstants };
