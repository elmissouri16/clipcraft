const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ov = require('../../../electron/library/openverse.cjs');
const lib = require('../../../electron/library/library.cjs');
const id = '98a11e0c-7e10-4610-9402-f3969126455a';
const record = { id, title: 'Forest', creator: 'Artist', creator_url: 'https://example.org/artist', source: 'flickr',
  license: 'cc0', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  foreign_landing_url: 'https://www.flickr.com/photos/artist/123', url: 'https://live.staticflickr.com/forest.jpg',
  thumbnail: 'https://api.openverse.org/v1/images/' + id + '/thumb/', attribution: 'Forest by Artist, CC0', width: 900, height: 600 };
const response = body => ({ ok: true, status: 200, json: async () => body });
(async () => {
  const calls = [];
  const search = async url => { calls.push(new URL(url)); return response({ page_count: 4, result_count: 70, results: [record,
    { ...record, license: 'by', license_url: 'https://creativecommons.org/licenses/by/4.0/' }, { ...record, license: 'pdm' }, { ...record, license: 'by-nc' },
    { ...record, license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    { ...record, url: 'https://127.0.0.1/file' }, { ...record, mature: true }] }); };
  const a = await ov.search(search, { kind: 'photo', q: 'forest', orientation: 'vertical' });
  assert.equal(a.results.length, 1); assert.equal(a.results[0].origin, 'openverse');
  assert.equal(calls[0].searchParams.get('license'), 'cc0'); assert.equal(calls[0].searchParams.get('aspect_ratio'), 'tall');
  await ov.search(search, { kind: 'photo', q: 'forest', orientation: 'vertical' }); assert.equal(calls.length, 1, 'cached browse');
  const b = await ov.search(search, { kind: 'photo', q: 'forest', licenses: 'attribution' });
  assert.deepEqual(b.results.map(r => r.license), ['cc0', 'by']);
  await lib.search(search, { kind: 'sfx', q: 'whoosh' });
  assert.equal(calls.at(-1).pathname, '/v1/audio/'); assert.equal(calls.at(-1).searchParams.get('source'), 'freesound');
  assert.equal(calls.at(-1).searchParams.get('license'), 'cc0');
  const musicCalls = [], musicSearch = async url => {
    const query = new URL(url); musicCalls.push(query);
    return response({ result_count: 1, page_count: 1, results: query.searchParams.get('license') === 'cc0' ? [] : [
      { ...record, source: 'jamendo', url: 'https://prod-1.storage.jamendo.com/track.mp3', license: 'by', license_url: 'https://creativecommons.org/licenses/by/4.0/' },
      { ...record, license: 'by-nc' }] });
  };
  assert.equal((await lib.search(musicSearch, { kind: 'music', q: 'music-license-policy' })).results.length, 0);
  assert.equal(musicCalls.length, 1, 'empty CC0 music never triggers a broader fallback');
  assert.equal(musicCalls[0].searchParams.get('source'), 'jamendo'); assert.equal(musicCalls[0].searchParams.get('category'), 'music');
  assert.equal(musicCalls[0].searchParams.get('license'), 'cc0');
  const creditedMusic = await lib.search(musicSearch, { kind: 'music', q: 'music-license-policy', licenses: 'attribution' });
  assert.deepEqual(creditedMusic.results.map(r => r.license), ['by']); assert.equal(musicCalls.length, 2);
  assert.equal(musicCalls[1].searchParams.get('license'), 'cc0,by');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-openverse-unit-'));
  try {
    let downloads = 0;
    const fetcher = async (url, opts) => {
      if (url.includes('api.openverse.org')) return response(record);
      downloads++; assert.equal(opts.redirect, 'manual');
      return { ok: true, status: 200, url, headers: new Map([['content-type', 'image/jpeg']]), body: (async function* () { yield Buffer.alloc(2000); })() };
    };
    const got = await ov.download(fetcher, dir, { ...a.results[0], url: 'https://evil.example/x', creator: 'Fake' });
    assert.ok(got.path.endsWith('.jpg')); assert.equal(got.credit.creator, 'Artist'); assert.equal(got.credit.sourceVerified, false);
    assert.match(got.credit.line, /Adapted/); assert.ok(got.credit.line.includes(record.license_url) && got.credit.line.includes(record.foreign_landing_url)); assert.ok(fs.existsSync(got.path));
    await ov.download(fetcher, dir, a.results[0]); assert.equal(downloads, 1);
    await assert.rejects(ov.download(async () => response({ ...record, license: 'by-nc' }), dir, a.results[0]), /selected licences/);
    await assert.rejects(ov.download(fetcher, dir, { ...a.results[0], openverseId: '../../escape' }), /Invalid/);
    await assert.rejects(ov.thumbnail(async () => ({ status: 302, headers: new Map([['location', 'http://localhost/private']]) }), dir, record.thumbnail), /redirects/);
    await assert.rejects(ov.thumbnail(async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'text/html']]) }), dir, record.thumbnail), /supported media/);
    await assert.rejects(ov.thumbnail(async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), body: (async function* () { yield Buffer.alloc(6 * 1024 * 1024); })() }), dir, record.thumbnail), /too large/);
    const { projectCredits } = await import('../../../src/features/library/credits.js');
    const project = { media: [{ id: 'p', credit: { license: 'by', line: 'Photo credit' } }, { id: 's', credit: { license: 'by', line: 'Sound credit' } }, { id: 'unused', credit: { license: 'by', line: 'Unused' } }], videoClips: [{ mediaId: 'p' }], overlayClips: [{ mediaId: 'p' }], audioClips: [{ mediaId: 's' }] };
    assert.deepEqual(projectCredits(project), ['Photo credit', 'Sound credit']);
    const { normalizeProject } = await import('../../../src/state/store.js');
    assert.deepEqual(projectCredits(normalizeProject(JSON.parse(JSON.stringify(project)))), ['Photo credit', 'Sound credit']);
    let requests = 0;
    const throttled = async () => { requests++; return { ok: false, status: 429, headers: new Map([['retry-after', '60']]) }; };
    await assert.rejects(ov.search(throttled, { q: 'rate-limit' }), /busy/);
    await assert.rejects(ov.search(throttled, { q: 'rate-limit-2' }), /busy/); assert.equal(requests, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('OPENVERSE OK: licence policy, search/cache, authoritative imports, redirects, formats, credits/persistence, rate limit');
})().catch(e => { console.error(e); process.exitCode = 1; });
