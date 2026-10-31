// Animated stickers (electron/stickers.cjs) with a mock server: the list (sorted, categories, emoji characters),
// the weekly cache and offline fallback, a sticker downloaded once as a GIF, bad ids and non-GIF answers refused.
// With --online, also the real Noto list and one real sticker.
// Usage: node scripts/test-stickers.cjs [--online]
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stickers = require('../electron/stickers.cjs');

const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
const LIST = { icons: [
  { codepoint: '1f600', popularity: 5, categories: ['Smileys and emotions'], tags: [':grinning:'] },
  { codepoint: '1f44b_1f3fd', popularity: 9, categories: ['People'], tags: [':waving-hand:'] },
  { codepoint: '../evil', popularity: 99, categories: ['Bad'], tags: [] },
] };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-stickers-'));
  let calls = 0;
  let online = true;
  const mock = async (url) => {
    calls++;
    if (!online) throw new Error('offline');
    if (url.endsWith('api.json')) return { ok: true, json: async () => LIST };
    if (url.includes('/1f600/')) return { ok: true, arrayBuffer: async () => GIF };
    return { ok: true, arrayBuffer: async () => Buffer.from('<html>not a gif</html>') };
  };

  const items = await stickers.list(mock, dir);
  assert.deepEqual(items.map((s) => s.id), ['1f44b_1f3fd', '1f600'], 'sorted by popularity, bad ids dropped');
  assert.equal(items[0].char, '👋🏽');
  assert.equal(items[1].name, 'grinning');
  assert.equal(items[0].category, 'People');
  const before = calls;
  await stickers.list(mock, dir);
  assert.equal(calls, before, 'the list comes from the cache');
  online = false;
  assert.equal((await stickers.list(mock, dir)).length, 2, 'offline: the cached list');
  online = true;

  const s = await stickers.get(mock, dir, '1f600', 'grinning');
  assert.ok(fs.existsSync(s.path) && s.path.endsWith('noto-1f600.gif'));
  assert.equal(s.credit.license, 'CC BY 4.0');
  const again = calls;
  await stickers.get(mock, dir, '1f600');
  assert.equal(calls, again, 'downloaded once');
  assert.deepEqual(stickers.downloaded(dir), ['1f600']);
  await assert.rejects(stickers.get(mock, dir, '../evil'), /Unknown sticker/);
  await assert.rejects(stickers.get(mock, dir, '2764'), /not a GIF/);
  assert.ok(!fs.existsSync(stickers.fileOf(dir, '2764')), 'nothing kept from a bad download');
  console.log('mock ok');

  if (process.argv.includes('--online')) {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-stickers-real-'));
    const all = await stickers.list(fetch, real);
    assert.ok(all.length > 500, `real list: ${all.length}`);
    const g = await stickers.get(fetch, real, all[0].id, all[0].name);
    assert.ok(fs.statSync(g.path).size > 1000);
    console.log(`online ok: ${all.length} stickers, first "${all[0].name}" ${all[0].char}`);
    fs.rmSync(real, { recursive: true, force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('STICKERS OK');
})().catch((e) => { console.error(e); process.exit(1); });
