// Creator Pack install: manifest validation, the bundled ZIP extractor, library merge
// semantics (dedupe, no clobber) and the download→verify→install orchestration
// (electron/pack.cjs). Usage: node scripts/test-packinstall.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const pack = require('../electron/pack.cjs');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pack-'));

// ---- a minimal stored/deflated ZIP writer (the suite must build its own archives) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method = 0 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

(async () => {
  // ---- parseManifest: gating + validation ----
  const good = {
    version: '2.1.0',
    categories: {
      music: { url: 'https://hamzaabika.com/clipcraft/music.zip', size: 100, sha256: 'a'.repeat(64) },
      sfx: { url: 'https://evil.example.com/sfx.zip', size: 100, sha256: 'b'.repeat(64) }, // ungated host
      assets: { url: 'https://hamzaabika.com/clipcraft/assets.zip', size: -5, sha256: 'zz' }, // bad size + sha
    },
  };
  const parsed = pack.parseManifest(good);
  assert.equal(parsed.version, '2.1.0');
  assert.deepEqual(Object.keys(parsed.categories), ['music']); // the other two are refused, not trusted
  assert.equal(pack.parseManifest({ categories: {} }).error.length > 0, true);
  assert.equal(pack.parseManifest(null).error.length > 0, true);
  assert.equal(pack.parseManifest({ categories: { music: { url: 'https://hamzaabika.com/x.zip', size: 1, sha256: 'A'.repeat(64) } } }).categories.music.sha256, 'a'.repeat(64));

  // ---- extractZip: stored + deflated + slip guard ----
  const zdir = tmp();
  const zpath = path.join(zdir, 'a.zip');
  fs.writeFileSync(zpath, zipOf([
    { name: 'Music/Library/song.mp3', data: Buffer.from('AUDIO-BYTES') },
    { name: 'deep/nested/file.bin', data: Buffer.alloc(5000, 7), method: 8 },
    { name: 'plain.txt', data: Buffer.from('hello') },
    { name: 'empty.bin', data: Buffer.alloc(0) }, // zero-length entries must not throw
  ]));
  const out = path.join(zdir, 'out');
  const written = await pack.extractZip(zpath, out);
  assert.equal(written.length, 4);
  assert.equal(fs.statSync(path.join(out, 'empty.bin')).size, 0);
  assert.equal(fs.readFileSync(path.join(out, 'Music/Library/song.mp3'), 'utf8'), 'AUDIO-BYTES');
  assert.equal(fs.readFileSync(path.join(out, 'deep/nested/file.bin')).length, 5000);
  assert.equal(fs.readFileSync(path.join(out, 'plain.txt'), 'utf8'), 'hello');
  const slipPath = path.join(zdir, 'slip.zip');
  fs.writeFileSync(slipPath, zipOf([{ name: '../escape.txt', data: Buffer.from('x') }]));
  await assert.rejects(() => pack.extractZip(slipPath, path.join(zdir, 'out2')), /outside its folder/);
  assert.equal(fs.existsSync(path.join(zdir, 'escape.txt')), false);
  await assert.rejects(() => pack.extractZip(path.join(zdir, 'nope.zip'), out));

  // ---- mergeLibrary: add, dedupe by file, never clobber ----
  const root = tmp();
  const itemA = { name: 'A', file: 'Music/Library/a.mp3', group: 'Music', sub: 'Library', kind: 'audio', duration: 10, size: 3 };
  const itemB = { name: 'B', file: 'Sound FX/UI/b.wav', group: 'Sound FX', sub: 'UI', kind: 'audio', duration: 1, size: 3 };
  let m = pack.mergeLibrary(root, [itemA, itemB]);
  assert.deepEqual([m.added, m.skipped, m.total], [2, 0, 2]);
  m = pack.mergeLibrary(root, [{ ...itemA, name: 'A — renamed copy' }, { name: 'C', file: 'Overlays/Clips/c.mp4', group: 'Overlays', sub: 'Clips', kind: 'video' }]);
  assert.deepEqual([m.added, m.skipped, m.total], [1, 1, 3]);
  const lib = JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));
  assert.equal(lib.items.find((i) => i.file === itemA.file).name, 'A'); // original kept
  m = pack.mergeLibrary(root, [{ name: 'Evil', file: '../evil.mp3', group: 'Music' }, { name: 'NoFile', group: 'Music' }]);
  assert.deepEqual([m.added, m.total], [0, 3]); // escaping / fileless entries are dropped

  // ---- installFromZip: fragment + files + poster, then a no-op re-install ----
  const root2 = tmp();
  const catZip = path.join(zdir, 'cat.zip');
  fs.writeFileSync(catZip, zipOf([
    { name: 'library-fragment.json', data: Buffer.from(JSON.stringify({ items: [itemA, { ...itemB, poster: 'Sound FX/UI/b.webp' }] })) },
    { name: 'Music/Library/a.mp3', data: Buffer.from('aaa') },
    { name: 'Sound FX/UI/b.wav', data: Buffer.from('bbb') },
    { name: 'Sound FX/UI/b.webp', data: Buffer.from('img') },
  ]));
  const ins = await pack.installFromZip(root2, catZip);
  assert.deepEqual([ins.added, ins.skipped], [2, 0]);
  assert.equal(fs.readFileSync(path.join(root2, 'Music/Library/a.mp3'), 'utf8'), 'aaa');
  assert.equal(fs.readFileSync(path.join(root2, 'Sound FX/UI/b.webp'), 'utf8'), 'img');
  const ins2 = await pack.installFromZip(root2, catZip);
  assert.deepEqual([ins2.added, ins2.skipped], [0, 2]); // dedupe on re-install
  const brokenZip = path.join(zdir, 'broken.zip');
  fs.writeFileSync(brokenZip, zipOf([{ name: 'library-fragment.json', data: Buffer.from(JSON.stringify({ items: [itemA] })) }]));
  await assert.rejects(() => pack.installFromZip(tmp(), brokenZip), /missing a file/);

  // ---- fetchManifest over HTTP: ok / 404 / non-JSON ----
  const server = http.createServer((req, res) => {
    if (req.url === '/good.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ version: '1', categories: { music: { url: 'https://hamzaabika.com/m.zip', size: 5, sha256: 'c'.repeat(64) } } })); }
    else if (req.url === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>site</html>'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const withEndpoint = async (url, fn) => {
    // fetchManifest reads the module-level ENDPOINT; test parse + HTTP behaviour via a
    // fresh module instance pointed at the local server.
    const modPath = require.resolve('../electron/pack.cjs');
    delete require.cache[modPath];
    process.env.CLIPCRAFT_PACK_URL = url;
    const fresh = require(modPath);
    try { return await fn(fresh); } finally { delete process.env.CLIPCRAFT_PACK_URL; delete require.cache[modPath]; }
  };
  await withEndpoint(`http://127.0.0.1:${port}/good.json`, async (fresh) => {
    const man = await fresh.fetchManifest();
    assert.equal(man.version, '1');
    assert.equal(man.categories.music.size, 5);
  });
  await withEndpoint(`http://127.0.0.1:${port}/missing.json`, async (fresh) => {
    assert.equal((await fresh.fetchManifest()).none, true);
  });
  await withEndpoint(`http://127.0.0.1:${port}/html`, async (fresh) => {
    assert.equal((await fresh.fetchManifest()).none, true);
  });

  // ---- startInstall: download → verify → install; bad sha installs nothing ----
  const musicZip = zipOf([
    { name: 'library-fragment.json', data: Buffer.from(JSON.stringify({ items: [itemA] })) },
    { name: 'Music/Library/a.mp3', data: Buffer.from('aaa') },
  ]);
  const serving = { music: musicZip };
  const stubFetch = async (url) => {
    const key = Object.keys(serving).find((k) => url.endsWith(`${k}.zip`));
    if (!key) return { ok: false, status: 404, headers: { get: () => null } };
    const buf = serving[key];
    return { ok: true, status: 200, headers: { get: () => String(buf.length) }, body: new Blob([buf]).stream() };
  };
  const manFor = (buf, shaOverride) => ({ version: 't', categories: { music: { url: 'https://hamzaabika.com/music.zip', size: buf.length, sha256: shaOverride || sha(buf) } } });
  const rootOk = tmp();
  const phases = [];
  const r1 = await pack.startInstall({ categories: ['music'], root: rootOk, fetchImpl: stubFetch, manifest: manFor(musicZip), onProgress: (p) => phases.push(p.phase) });
  assert.equal(r1.results.music.ok, true);
  assert.equal(r1.results.music.added, 1);
  assert.deepEqual(phases, ['downloading', 'verifying', 'installing', 'done']);
  assert.equal(fs.existsSync(path.join(rootOk, 'Music/Library/a.mp3')), true);
  const rootBad = tmp();
  const r2 = await pack.startInstall({ categories: ['music'], root: rootBad, fetchImpl: stubFetch, manifest: manFor(musicZip, 'f'.repeat(64)) });
  assert.equal(r2.results.music.ok, false);
  assert.match(r2.results.music.error, /integrity check/);
  assert.equal(fs.existsSync(path.join(rootBad, 'library.json')), false); // nothing half-installed
  assert.equal(fs.existsSync(path.join(rootBad, 'Music/Library/a.mp3')), false);
  const r3 = await pack.startInstall({ categories: ['sfx'], root: tmp(), fetchImpl: stubFetch, manifest: manFor(musicZip) });
  assert.equal(r3.results.sfx.ok, false); // category absent from this manifest
  assert.match(r3.results.sfx.error, /not part of this pack/);

  // ---- cancel: a slow server + cancelInstall aborts cleanly, nothing installs ----
  const slow = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(musicZip.length) });
    res.write(musicZip.subarray(0, 64));
    const t = setInterval(() => { res.write(musicZip.subarray(64, 128)); }, 5000);
    req.on('close', () => clearInterval(t));
  });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  const slowUrl = `http://127.0.0.1:${slow.address().port}/music.zip`;
  const rootCancel = tmp();
  const pending = pack.startInstall({
    categories: ['music'], root: rootCancel,
    manifest: { version: 't', categories: { music: { url: slowUrl, size: musicZip.length, sha256: sha(musicZip) } } },
  });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(pack.isRunning(), true);
  assert.equal(pack.cancelInstall(), true);
  const r4 = await pending;
  assert.equal(r4.results.music.ok, false);
  assert.equal(r4.results.music.canceled, true);
  assert.equal(fs.existsSync(path.join(rootCancel, 'library.json')), false);
  assert.equal(fs.existsSync(path.join(rootCancel, '.pack-downloads')), false); // temp cleaned
  slow.close();
  server.close();

  console.log('PACKINSTALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
