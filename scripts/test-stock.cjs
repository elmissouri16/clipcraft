// Pixabay stock module against a fake fetch: parameters, mapping, 24 h cache, key never in errors, host checks,
// downloads. Usage: node scripts/test-stock.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stock = require('../electron/stock.cjs');

const KEY = 'test-key-123';
const calls = [];
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map(), url: '' });
const file = (bytes, url) => ({ ok: true, status: 200, url, headers: { get: () => String(bytes.length) }, arrayBuffer: async () => bytes });
const fakeFetch = async (url) => {
  calls.push(url);
  const u = new URL(url);
  if (u.hostname === 'cdn.pixabay.com') return file(Buffer.alloc(2000, 7), url);
  if (u.searchParams.get('key') !== KEY) return json('[ERROR 400] "key" is wrong or missing.', 400);
  if (u.pathname.endsWith('/videos/')) {
    return json({ totalHits: 45, hits: [{ id: 11, pageURL: 'https://pixabay.com/videos/id-11/', duration: 12, user: 'Ann', tags: 'sea',
      videos: { medium: { url: 'https://cdn.pixabay.com/video/11_medium.mp4', width: 1920, height: 1080, size: 9, thumbnail: 'https://cdn.pixabay.com/video/11_m.jpg' },
        small: { url: 'https://cdn.pixabay.com/video/11_small.mp4', width: 1280, height: 720, size: 5, thumbnail: 'https://cdn.pixabay.com/video/11_s.jpg' } } }] });
  }
  return json({ totalHits: 2, hits: [
    { id: 5, pageURL: 'https://pixabay.com/photos/id-5/', user: 'Bob', webformatURL: 'https://pixabay.com/get/5_640.jpg', largeImageURL: 'https://pixabay.com/get/5_1280.jpg', imageWidth: 4000, imageHeight: 3000 },
    { id: 6, pageURL: 'https://pixabay.com/photos/id-6/', user: 'Eve', webformatURL: 'https://evil.example/6.jpg', largeImageURL: 'https://evil.example/6.jpg' },
  ] });
};

(async () => {
  // Photos: parameters, mapping, unknown hosts dropped.
  const photos = await stock.search(fakeFetch, KEY, { kind: 'photo', q: 'mountain lake', category: 'nature', orientation: 'vertical' });
  const u = new URL(calls[0]);
  assert.equal(u.pathname, '/api/');
  assert.equal(u.searchParams.get('q'), 'mountain lake');
  assert.equal(u.searchParams.get('category'), 'nature');
  assert.equal(u.searchParams.get('orientation'), 'vertical');
  assert.equal(u.searchParams.get('image_type'), 'photo');
  assert.equal(u.searchParams.get('safesearch'), 'true');
  assert.deepEqual(photos.results.map((r) => [r.id, r.url, r.user]), [['5', 'https://pixabay.com/get/5_1280.jpg', 'Bob']]);

  // Same search again within 24 h: served from the cache.
  await stock.search(fakeFetch, KEY, { kind: 'photo', q: 'mountain lake', category: 'nature', orientation: 'vertical' });
  assert.equal(calls.length, 1);

  // Videos: the 1080p rendition, the small thumbnail, page count.
  const videos = await stock.search(fakeFetch, KEY, { kind: 'video', q: 'sea', category: 'bogus' });
  assert.equal(new URL(calls[1]).pathname, '/api/videos/');
  assert.equal(new URL(calls[1]).searchParams.get('category'), null, 'unknown categories are not sent');
  assert.deepEqual([videos.results[0].url, videos.results[0].thumb, videos.results[0].duration, videos.pages],
    ['https://cdn.pixabay.com/video/11_medium.mp4', 'https://cdn.pixabay.com/video/11_s.jpg', 12, 2]);

  // A wrong key: a friendly error without the key or the URL in it. No key: asks for one.
  await assert.rejects(stock.search(fakeFetch, 'bad-key-999', { kind: 'photo', q: 'x' }), (e) => /refused the API key/.test(e.message) && !e.message.includes('bad-key-999') && !e.message.includes('http'));
  await assert.rejects(stock.search(fakeFetch, '', { kind: 'photo' }), /Add your free Pixabay API key/);

  // Downloads: once, into the library folder; bad ids and hosts refused.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-stock-'));
  const f = await stock.download(fakeFetch, dir, videos.results[0]);
  assert.equal(path.basename(f), 'pixabay-video-11.mp4');
  const n = calls.length;
  await stock.download(fakeFetch, dir, videos.results[0]);
  assert.equal(calls.length, n, 'second add uses the downloaded file');
  await assert.rejects(stock.download(fakeFetch, dir, { ...videos.results[0], id: '../x' }));
  await assert.rejects(stock.download(fakeFetch, dir, { ...videos.results[0], url: 'https://evil.example/a.mp4' }));
  await assert.rejects(stock.thumbnail(fakeFetch, dir, 'http://cdn.pixabay.com/a.jpg'));
  assert.ok(fs.existsSync(await stock.thumbnail(fakeFetch, dir, videos.results[0].thumb)));
  assert.equal(stock.creditLine(videos.results[0]), 'Video by Ann on Pixabay: https://pixabay.com/videos/id-11/');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('STOCK OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
