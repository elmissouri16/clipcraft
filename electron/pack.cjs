// The free Creator Pack: an OPTIONAL content pack (music, sound effects, assets) that is
// never bundled into the app. On first run the app offers it; if the user says yes, the app
// itself downloads per-category ZIP archives from the pack feed, verifies each one against
// the feed's SHA-256, and merges it into the folder-backed assets library
// (electron/assets.cjs). Declining costs nothing: the same offer lives on in the panels'
// empty states, installable per category whenever the user wants it.
//
// The feed is a small JSON file (pack.json) published next to the future ClipCraft site —
// the same pattern as the update feed (electron/updates.cjs): the renderer never supplies
// URLs, hosts are gated, and nothing here runs without an explicit user action.
//
// pack.json schema:
//   { "version": "1.0.0",
//     "categories": {
//       "music":  { "url": "https://…/music.zip",  "size": 123, "sha256": "…" },
//       "sfx":    { "url": "https://…/sfx.zip",    "size": 123, "sha256": "…" },
//       "assets": { "url": "https://…/assets.zip", "size": 123, "sha256": "…" } } }
// Each category archive holds its media in library layout (<Group>/<Sub>/<file>) plus a
// library-fragment.json ({ items: [...] }) at its root, which is merged into the assets
// folder's library.json (dedupe by item file path — existing items are never clobbered).
let net;
try {
  ({ net } = require('electron'));
} catch {
  // Plain-Node fallback so the pack logic can be unit-tested outside Electron.
  net = { fetch: (...args) => fetch(...args) };
}

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');

// PLACEHOLDER: the standalone ClipCraft site does not exist yet. Until it does, this URL
// simply 404s and the app shows its honest "pack unavailable" state. Development and tests
// point CLIPCRAFT_PACK_URL at a local fixture server instead.
const SITE = 'https://hamzaabika.com';
const ENDPOINT = process.env.CLIPCRAFT_PACK_URL || `${SITE}/clipcraft/pack.json`;
const FEED_HOSTS = ['hamzaabika.com', 'www.hamzaabika.com'];
if (process.env.CLIPCRAFT_PACK_URL) FEED_HOSTS.push('127.0.0.1', 'localhost');

const CATEGORIES = ['music', 'sfx', 'assets'];
const CATEGORY_LABELS = { music: 'Music', sfx: 'Sound FX', assets: 'Assets' };

const safeUrl = (url) => {
  try {
    const u = new URL(url);
    const protoOk = u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
    return protoOk && FEED_HOSTS.includes(u.hostname) ? u.toString() : '';
  } catch {
    return '';
  }
};

// Validates a parsed pack.json. Returns { version, categories } keeping only well-formed
// categories (gated URL, positive size, 64-hex sha256), or { error } when none survive.
// A manifest whose categories object is explicitly EMPTY is the published "no pack yet"
// state (the public feed serves exactly that until a pack is released): report it as
// { none: true } — the calm unavailable state — not as a malformed feed.
function parseManifest(json) {
  if (!json || typeof json !== 'object') return { error: 'The pack feed did not contain a valid pack description.' };
  if (json.categories && typeof json.categories === 'object' && !Object.keys(json.categories).length) return { none: true };
  const cats = {};
  for (const id of CATEGORIES) {
    const c = json.categories && json.categories[id];
    if (!c) continue;
    const url = typeof c.url === 'string' ? safeUrl(c.url) : '';
    const size = Number(c.size) || 0;
    const sha256 = typeof c.sha256 === 'string' ? c.sha256.toLowerCase() : '';
    if (url && size > 0 && /^[0-9a-f]{64}$/.test(sha256)) cats[id] = { url, size, sha256 };
  }
  if (!Object.keys(cats).length) return { error: 'The pack feed did not contain a valid pack description.' };
  return { version: typeof json.version === 'string' ? json.version : '', categories: cats };
}

// { version, categories } or { none: true } when no pack is published yet (404 / not JSON),
// or { error } when the feed cannot be reached at all.
async function fetchManifest(fetchImpl = net.fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetchImpl(ENDPOINT, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (res.status === 404) return { none: true };
    if (!res.ok) return { error: `The pack server answered ${res.status}.` };
    let json;
    try { json = await res.json(); } catch { return { none: true }; } // an HTML page = nothing published yet
    return parseManifest(json);
  } catch {
    return { error: 'No internet connection, or the pack server could not be reached.' };
  } finally {
    clearTimeout(timer);
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// ---- ZIP extraction (bundled; no dependency) ----
// Why not a library: adm-zip & friends exist in node_modules only as transitive dev
// dependencies of the packaging tooling — the shipped app cannot rely on them. Why not the
// system unzip: Windows has none on PATH. So the extractor is bundled here: ZIP local +
// central headers, stored and deflate entries (node:zlib), a zip-slip guard on every
// entry, and zip64 extra fields honoured for large archives. Data integrity of the archive
// as a whole is already covered by the feed's SHA-256 before extraction starts.
async function extractZip(zipPath, destDir) {
  const fd = await fs.promises.open(zipPath, 'r');
  try {
    const { size: fileSize } = await fd.stat();
    if (fileSize < 22) throw new Error('The archive is too small to be a zip file.');
    // End Of Central Directory: scan the tail (comment may add up to 64 KB).
    const tailLen = Math.min(fileSize, 65558);
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, fileSize - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('The archive is not a valid zip file.');
    let cdCount = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || cdCount === 0xffff) {
      // ZIP64 EOCD: locator sits 20 bytes before the EOCD.
      const locAt = fileSize - tailLen + eocd - 20;
      const loc = Buffer.alloc(20);
      await fd.read(loc, 0, 20, locAt);
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new Error('The archive is not a valid zip file.');
      const z64At = Number(loc.readBigUInt64LE(8));
      const rec = Buffer.alloc(56);
      await fd.read(rec, 0, 56, z64At);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('The archive is not a valid zip file.');
      cdCount = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fd.read(cd, 0, cdSize, cdOffset);
    const destRoot = path.resolve(destDir);
    const written = [];
    let p = 0;
    for (let n = 0; n < cdCount; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error('The archive directory is damaged.');
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let rawSize = cd.readUInt32LE(p + 24);
      let localAt = cd.readUInt32LE(p + 42);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // ZIP64 extra field (0x0001): values appear in the order raw, compressed, offset —
      // only for the fields whose 32-bit slot holds 0xffffffff.
      let xp = p + 46 + nameLen;
      const xEnd = xp + extraLen;
      while (xp + 4 <= xEnd) {
        const tag = cd.readUInt16LE(xp);
        const len = cd.readUInt16LE(xp + 2);
        if (tag === 0x0001) {
          let q = xp + 4;
          if (rawSize === 0xffffffff) { rawSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localAt === 0xffffffff) { localAt = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        xp += 4 + len;
      }
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue; // directory entry
      const rel = name.replace(/\\/g, '/').replace(/^\/+/, '');
      const target = path.resolve(destRoot, rel);
      if (!rel || target !== destRoot && !target.startsWith(destRoot + path.sep)) {
        throw new Error('The archive contains a file outside its folder.'); // zip-slip guard
      }
      // Local header: skip to the entry data.
      const lh = Buffer.alloc(30);
      await fd.read(lh, 0, 30, localAt);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('The archive is damaged.');
      const dataAt = localAt + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      if (compSize === 0) {
        // A zero-length entry (the packs contain genuinely empty files): a read stream
        // with start > end would throw, so write the empty file directly.
        await fs.promises.writeFile(target, Buffer.alloc(0));
      } else {
        const src = fs.createReadStream(zipPath, { start: dataAt, end: dataAt + compSize - 1 });
        const out = fs.createWriteStream(target);
        if (method === 0) await pipeline(src, out);
        else if (method === 8) await pipeline(src, zlib.createInflateRaw(), out);
        else throw new Error(`The archive uses an unsupported compression (${method}).`);
      }
      const st = await fs.promises.stat(target);
      if (st.size !== rawSize) throw new Error('The archive is damaged (a file came out the wrong size).');
      written.push(rel);
    }
    return written;
  } finally {
    await fd.close();
  }
}

// ---- Library merge ----
// A fragment item is only believable with a relative, non-escaping file path (same rule
// readLibrary applies when serving the manifest).
const cleanItem = (it) => {
  if (!it || typeof it.file !== 'string' || !it.file) return null;
  const rel = it.file.replace(/\\/g, '/');
  if (rel.startsWith('/') || rel.split('/').includes('..')) return null;
  const clean = { ...it, file: rel };
  if (typeof clean.poster === 'string') {
    const pr = clean.poster.replace(/\\/g, '/');
    clean.poster = pr.startsWith('/') || pr.split('/').includes('..') ? undefined : pr;
    if (clean.poster === undefined) delete clean.poster;
  }
  return clean;
};

function readLibraryFile(root) {
  const file = path.join(root, 'library.json');
  if (!fs.existsSync(file)) return { items: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('The existing library.json in the assets folder is not valid JSON.');
  }
  const list = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
  return { items: list.map(cleanItem).filter(Boolean) };
}

// Merges fragment items into <root>/library.json. Dedupe is by file path: an item already
// present is kept as-is (never clobbered) and reported as skipped. The write is atomic
// (temp file + rename) so a crash mid-merge cannot truncate the library.
function mergeLibrary(root, fragmentItems) {
  const lib = readLibraryFile(root);
  const have = new Set(lib.items.map((i) => i.file));
  let added = 0;
  let skipped = 0;
  for (const raw of Array.isArray(fragmentItems) ? fragmentItems : []) {
    const it = cleanItem(raw);
    if (!it) continue;
    if (have.has(it.file)) { skipped++; continue; }
    have.add(it.file);
    lib.items.push(it);
    added++;
  }
  const tmp = path.join(root, `.library-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ items: lib.items }, null, 1), 'utf8');
  fs.renameSync(tmp, path.join(root, 'library.json'));
  return { added, skipped, total: lib.items.length };
}

// Installs one already-downloaded, already-verified category archive into the assets
// folder: extract to a staging dir, copy every fragment file into place, then merge the
// fragment into library.json. Files are copied BEFORE the merge, so an interrupted install
// can leave orphan files on disk but never a manifest entry pointing at nothing — and
// orphan files are invisible to the app (readLibrary serves only manifest entries).
async function installFromZip(root, zipPath) {
  const stage = path.join(root, `.pack-stage-${process.pid}-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    await extractZip(zipPath, stage);
    const fragPath = path.join(stage, 'library-fragment.json');
    if (!fs.existsSync(fragPath)) throw new Error('The archive does not contain a pack description.');
    let frag;
    try { frag = JSON.parse(fs.readFileSync(fragPath, 'utf8')); } catch { throw new Error('The archive pack description is not valid JSON.'); }
    const items = (Array.isArray(frag) ? frag : (Array.isArray(frag.items) ? frag.items : [])).map(cleanItem).filter(Boolean);
    if (!items.length) throw new Error('The archive pack description lists no files.');
    for (const it of items) {
      for (const rel of [it.file, it.poster].filter(Boolean)) {
        const from = path.join(stage, rel);
        if (!fs.existsSync(from)) throw new Error(`The archive is missing a file it lists (${rel}).`);
        const to = path.join(root, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        await pipeline(fs.createReadStream(from), fs.createWriteStream(to));
      }
    }
    return mergeLibrary(root, items);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// ---- Download + install orchestration (one run at a time) ----
let current = null; // { cats: [...], ctrl } while an install runs

function cancelInstall() {
  if (!current) return false;
  current.ctrl.abort();
  return true;
}

const isRunning = () => !!current;

// Downloads and installs the given categories in order. Per-category failures are
// reported in the result (never thrown) so the categories that succeeded stay installed.
// onProgress receives { category, phase, received, total } with phase one of
// 'downloading' | 'verifying' | 'installing' | 'done' | 'error'.
async function startInstall({ categories, root, fetchImpl = net.fetch, manifest, onProgress } = {}) {
  if (current) return { error: 'A pack download is already running.' };
  const wanted = CATEGORIES.filter((c) => Array.isArray(categories) && categories.includes(c));
  if (!wanted.length) return { error: 'No pack categories were chosen.' };
  if (!root) return { error: 'No assets folder available.' };
  const man = manifest || (await fetchManifest(fetchImpl));
  if (man.error) return { error: man.error };
  if (man.none || !man.categories) return { error: 'The Creator Pack is not available yet.' };
  const ctrl = new AbortController();
  current = { cats: wanted, ctrl };
  const results = {};
  const tmpDir = path.join(root, '.pack-downloads');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const cat of wanted) {
      const spec = man.categories[cat];
      const label = CATEGORY_LABELS[cat];
      if (!spec) { results[cat] = { ok: false, error: `${label} is not part of this pack.` }; continue; }
      const part = path.join(tmpDir, `${cat}.zip.part`);
      const zip = path.join(tmpDir, `${cat}.zip`);
      try {
        // ---- download (streamed; abort = cancel) ----
        const res = await fetchImpl(spec.url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
        if (!res.ok) throw new Error(`The pack server answered ${res.status}.`);
        const total = Number(res.headers?.get?.('content-length') || 0) || spec.size;
        let received = 0;
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            received += chunk.length;
            onProgress?.({ category: cat, phase: 'downloading', received, total });
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
        fs.renameSync(part, zip);
        // ---- verify ----
        onProgress?.({ category: cat, phase: 'verifying', received, total });
        const got = fs.statSync(zip).size;
        if (got !== spec.size) throw new Error(`${label} arrived incomplete (${got} of ${spec.size} bytes). Nothing was installed — try again.`);
        const sha = await sha256File(zip);
        if (sha !== spec.sha256) throw new Error(`${label} did not pass its integrity check. Nothing was installed — try again.`);
        // ---- install ----
        onProgress?.({ category: cat, phase: 'installing', received, total });
        const merged = await installFromZip(root, zip);
        results[cat] = { ok: true, added: merged.added, skipped: merged.skipped };
        onProgress?.({ category: cat, phase: 'done', received, total });
      } catch (err) {
        const aborted = ctrl.signal.aborted || err?.name === 'AbortError';
        results[cat] = { ok: false, canceled: aborted || undefined, error: aborted ? 'Canceled.' : (err?.message || 'The download failed.') };
        onProgress?.({ category: cat, phase: 'error', received: 0, total: spec.size });
        if (aborted) {
          for (const rest of wanted.slice(wanted.indexOf(cat) + 1)) results[rest] = { ok: false, canceled: true, error: 'Canceled.' };
          break;
        }
      } finally {
        fs.rmSync(part, { force: true });
        fs.rmSync(zip, { force: true });
      }
    }
  } finally {
    current = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { results };
}

module.exports = {
  ENDPOINT, CATEGORIES, CATEGORY_LABELS,
  parseManifest, fetchManifest, sha256File, extractZip, mergeLibrary, installFromZip,
  startInstall, cancelInstall, isRunning,
};
