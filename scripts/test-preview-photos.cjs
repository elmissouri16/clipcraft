const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensurePreviewPhotos, PHOTO_IDS } = require('./fetch-preview-photos.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-preview-photos-'));
// File-boundary fixture; real decode/render checks live in the Electron smoke.
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xff, 0xd9]);
(async () => {
  try {
    let calls = 0;
    const fetchImpl = async (url) => { calls++; assert.match(url, /^https:\/\/picsum\.photos\/id\/\d+\/640\/400\.jpg$/); return new Response(bytes); };
    let result = await ensurePreviewPhotos({ root, fetchImpl });
    assert.equal(calls, PHOTO_IDS.length);
    assert.ok(result.every((r) => r.status === 'downloaded'));
    result = await ensurePreviewPhotos({ root, fetchImpl });
    assert.equal(calls, PHOTO_IDS.length, 'cached files need no network');
    assert.ok(result.every((r) => r.status === 'present'));
    const file = path.join(root, 'public', 'preview', `p${PHOTO_IDS[0]}.jpg`);
    const largeLocal = Buffer.alloc(2 * 1024 * 1024 + 1);
    bytes.copy(largeLocal, 0, 0, 3); largeLocal[largeLocal.length - 2] = 0xff; largeLocal[largeLocal.length - 1] = 0xd9;
    fs.writeFileSync(file, largeLocal);
    assert.ok((await ensurePreviewPhotos({ root, fetchImpl })).every((r) => r.status === 'present'), 'existing larger local photos are preserved');
    assert.equal(calls, PHOTO_IDS.length);
    fs.writeFileSync(file, '<html>not a photo</html>');
    result = await ensurePreviewPhotos({ root, fetchImpl: async () => new Response('<html>source error</html>') });
    assert.equal(result[0].status, 'failed');
    assert.equal(fs.readFileSync(file, 'utf8'), '<html>not a photo</html>', 'failed downloads never overwrite a local file');
    assert.ok(!fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.part')));
    result = await ensurePreviewPhotos({ root, check: true });
    assert.equal(result[0].status, 'missing');
    result = await ensurePreviewPhotos({ root, fetchImpl });
    assert.equal(result[0].status, 'downloaded', 'a later retry restores invalid/missing photos');
    assert.ok((await ensurePreviewPhotos({ root, check: true })).every((r) => r.status === 'present'));
    console.log('preview photos ok (fixed sources, cache reuse, invalid responses, atomic retry)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
