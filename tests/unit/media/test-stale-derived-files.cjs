// A source file replaced at the same path (re-rendered elsewhere) must not keep its old preview copy
// or timeline visuals: the export reads the new file, so the preview would show other content.
// Saved derived paths are reused only while their key (source path, size, time) still matches:
// electron/media/quality.cjs derivedCurrent, used by preparePreview.cjs and projectfile.cjs checkGenerated.
// Usage: node tests/unit/media/test-stale-derived-files.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');
const { preparePreview } = require('../../../electron/media/preparePreview.cjs');
const { checkGenerated } = require('../../../electron/project/projectfile.cjs');
const { derivedCurrent } = require('../../../electron/media/quality.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-stale-derived-'));
const cache = path.join(dir, 'cache'), src = path.join(dir, 'shot.mov');
fs.mkdirSync(cache);
// ProRes: the player needs a compatibility proxy at every quality, Full included.
const make = (color, seconds) => execFileSync(ff.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x96:d=${seconds}:r=10`, '-c:v', 'prores_ks', src]);
const pixel = (file) => [...execFileSync(ff.ffmpegPath, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-'])];
const services = { probe: ff.probe, needsProxy: ff.needsProxy, makeProxy: ff.makeProxy, makeQualityProxy: ff.makeQualityProxy, makeVisuals: async () => {} };
(async () => {
  try {
    make('red', 0.5);
    const first = await preparePreview({ path: src, ...(await ff.probe(src)) }, 'full', cache, () => {}, services);
    assert.ok(first.proxy && fs.existsSync(first.proxy));assert.ok(pixel(first.proxy)[0] > 200, 'the first proxy is red');
    assert.equal(derivedCurrent(first, first.proxy), true, 'an unchanged source keeps its proxy');
    const unchanged = JSON.parse(checkGenerated(JSON.stringify({ media: [first] }), cache)).media[0];
    assert.equal(unchanged.proxy, first.proxy, 'reopening an unchanged project keeps the proxy');
    const again = await preparePreview(unchanged, 'full', cache, () => {}, { ...services, makeProxy: async () => { throw Error('an unchanged source is not encoded again'); } });
    assert.equal(again.proxy, first.proxy);

    // The user re-renders shot.mov in another program: same path, new content (and size).
    make('blue', 0.8);
    assert.equal(derivedCurrent(first, first.proxy), false, 'the old proxy no longer belongs to the source');
    const visuals = { thumb: path.join(cache, `${path.basename(first.proxy).slice(0, 16)}-sprite.jpg`), thumbCount: 8, wave: path.join(cache, 'abcdef0123456789-wave.png'), poster: path.join(cache, 'abcdef0123456789-poster.jpg') };
    for (const f of [visuals.thumb, visuals.wave, visuals.poster]) fs.writeFileSync(f, 'old');
    const reopened = JSON.parse(checkGenerated(JSON.stringify({ media: [{ ...first, ...visuals, proxies: { high: first.proxy, low: false } }] }), cache)).media[0];
    assert.equal(reopened.proxy, undefined, 'checkGenerated drops the stale proxy');assert.equal(reopened.optimizing, true, '…and asks for a new one');
    assert.equal(reopened.thumb, undefined);assert.equal(reopened.thumbCount, undefined);assert.equal(reopened.wave, undefined);assert.equal(reopened.poster, undefined);
    assert.deepEqual(reopened.proxies, { low: false }, 'stale quality copies go, failure markers stay');
    // Even when the renderer still holds the old path (a session that did not reopen), the preparation makes a new copy.
    const second = await preparePreview({ ...first }, 'full', cache, () => {}, services);
    assert.notEqual(second.proxy, first.proxy);assert.ok(pixel(second.proxy)[2] > 200, 'the new proxy shows the new content');
    // Names outside the derived scheme (graphics, user files) and unreadable sources are not judged.
    assert.equal(derivedCurrent(first, path.join(dir, 'my-thumb.png')), true);
    assert.equal(derivedCurrent({ path: path.join(dir, 'gone.mov') }, first.proxy), true);
    console.log('stale derived files: a replaced source gets a new proxy and visuals; an unchanged one keeps them');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error);process.exitCode = 1; });
