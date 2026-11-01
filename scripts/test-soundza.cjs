// Soundza client (electron/soundza.cjs) against a local stub of the documented API
// (scripts/soundza-stub.cjs): search parsing, filters, download-once caching, and the error
// mapping (no key / 401 / 429 with Retry-After). The sandbox cannot reach api.soundza.com from
// Electron, and unit-level the real service needs a real key, so the documented shapes are
// served locally; the real endpoint shapes were probed separately from plain Node fetch.
// Usage: node scripts/test-soundza.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const stub = require('./soundza-stub.cjs');

(async () => {
  const { server, port, hits } = await stub.start(0);
  process.env.CLIPCRAFT_SOUNDZA_URL = `http://127.0.0.1:${port}/v1`;
  const soundza = require('../electron/soundza.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-soundza-'));
  try {
    // Host rules: the real host is allowed; lookalikes are not. Localhost only via the override.
    if (!soundza.hostOk('https://api.soundza.com/v1/sounds/search')) throw new Error('real host refused');
    if (soundza.hostOk('https://api.soundza.com.evil.example/v1')) throw new Error('lookalike host allowed');
    if (!soundza.hostOk(`http://127.0.0.1:${port}/v1/sounds/search`)) throw new Error('fixture host refused');

    // No key: a plain instruction, before any request is made.
    await soundza.search(fetch, '', { q: 'whoosh' }).then(
      () => { throw new Error('search without a key succeeded'); },
      (e) => { if (!/Add your free Soundza API key in Settings/.test(e.message)) throw new Error(`no-key message: ${e.message}`); });
    if (hits.search !== 0) throw new Error('a keyless search reached the server');

    // Search: fields map to the library item the UI consumes.
    const r = await soundza.search(fetch, stub.KEY, { q: 'whoosh' });
    if (r.results.length !== 3 || r.total !== 3 || r.page !== 1 || r.pages !== 1) throw new Error(`search shape ${JSON.stringify({ n: r.results.length, total: r.total, page: r.page, pages: r.pages })}`);
    const [a, b, c] = r.results;
    if (a.id !== 'soundza-stubwhoosh1' || a.provider !== 'soundza' || a.title !== 'Stub Whoosh One') throw new Error(`first result ${JSON.stringify(a)}`);
    if (a.creator !== 'Stub Creator' || a.category !== 'Transitions' || a.packName !== 'Stub Pack') throw new Error('creator/category/pack mapping');
    if (a.license !== 'soundza' || a.licenseName !== 'Soundza Standard License' || !a.previewUrl.includes('/preview/stubwhoosh1.mp3')) throw new Error('license/preview mapping');
    if (!a.downloadUrl.includes('/v1/sounds/stubwhoosh1/download') || a.fileExt !== 'wav' || a.duration !== 1.2) throw new Error('download/ext/duration mapping');
    if (!a.attribution.includes('Stub Whoosh One')) throw new Error('attribution mapping');
    if (b.category !== 'User Interface' || c.category !== '' || c.fileExt !== 'mp3') throw new Error('null category / mp3 mapping');
    if (soundza.creditLine(a) !== a.attribution) throw new Error('creditLine');

    // Filters reach the API as documented parameters.
    await soundza.search(fetch, stub.KEY, { goodFor: 'ui_click', style: 'cartoon', page: 2 });
    if (hits.lastQuery.good_for !== 'ui_click' || hits.lastQuery.style !== 'cartoon' || hits.lastQuery.page !== '2' || hits.lastQuery.type !== 'sound_effect') {
      throw new Error(`filter params ${JSON.stringify(hits.lastQuery)}`);
    }

    // Download once: the file lands under dir/soundza keyed by id; a second add reuses it
    // (the stub's file endpoint must see exactly one request).
    const file = await soundza.download(fetch, dir, a, stub.KEY);
    if (file !== path.join(dir, 'soundza', 'stubwhoosh1.wav') || !fs.existsSync(file)) throw new Error(`download path ${file}`);
    if (fs.statSync(file).size < 1000) throw new Error('downloaded file too small');
    const again = await soundza.download(fetch, dir, a, stub.KEY);
    if (again !== file || hits.downloads.stubwhoosh1 !== 1) throw new Error(`download-once broken (hits=${hits.downloads.stubwhoosh1})`);

    // Preview: fetched once into dir/previews; the second play is served from disk.
    const pv = await soundza.preview(fetch, dir, a);
    if (pv !== path.join(dir, 'previews', 'stubwhoosh1.mp3') || !fs.existsSync(pv)) throw new Error(`preview path ${pv}`);
    await soundza.preview(fetch, dir, a);
    if (hits.previews.stubwhoosh1 !== 1) throw new Error(`preview-once broken (hits=${hits.previews.stubwhoosh1})`);
    // A preview link to any other host is refused.
    await soundza.preview(fetch, dir, { ...a, previewUrl: 'https://evil.example/x.mp3' }).then(
      () => { throw new Error('foreign preview link accepted'); }, () => {});

    // A bad id is refused before any request.
    await soundza.download(fetch, dir, { id: 'soundza-../etc', rawId: '../etc', downloadUrl: a.downloadUrl, fileExt: 'wav' }, stub.KEY).then(
      () => { throw new Error('path-escape id accepted'); }, () => {});

    // 401 maps to the "refused key" guidance.
    await soundza.search(fetch, 'sz_live_garbage', { q: 'whoosh' }).then(
      () => { throw new Error('garbage key accepted'); },
      (e) => { if (!/Soundza refused the API key/.test(e.message)) throw new Error(`401 message: ${e.message}`); });

    // 429 with Retry-After: 0 is retried once and then succeeds (two search hits for it).
    const before = hits.search;
    const rl = await soundza.search(fetch, stub.KEY, { q: 'ratelimit' });
    if (rl.results.length !== 3) throw new Error('rate-limited search did not recover');
    if (hits.search - before !== 2) throw new Error(`429 retry hits=${hits.search - before}`);

    console.log(`SOUNDZA OK — search parse, filters, download-once (1 HTTP hit for 2 adds), 401 + 429 mapping; fixture dir ${dir}`);
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
