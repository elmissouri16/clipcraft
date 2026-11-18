// Two processes building the same preview copy into one media cache (two app instances before the
// single-instance lock, or any other tool sharing the folder) must not write the same partial file:
// partial names carry a per-process tag (electron/media/ffmpeg.cjs PART_TAG). Both builds finish and
// the cached copy decodes cleanly. Usage: node tests/unit/media/test-cache-part-names.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');

if (process.argv[2] === 'child') {
  (async () => {
    const [src, cache] = process.argv.slice(3);
    try { process.send({ ok: await ff.makeProxy({ path: src, ...(await ff.probe(src)) }, cache) }); }
    catch (error) { process.send({ error: String(error.message).slice(-300) }); }
  })();
  return;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-part-names-')), cache = path.join(dir, 'cache'), src = path.join(dir, 'shot.mov');
fs.mkdirSync(cache);
(async () => {
  try {
    execFileSync(ff.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=3:r=25', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'prores_ks', '-c:a', 'pcm_s16le', src]);
    const run = () => new Promise((resolve) => { const child = fork(__filename, ['child', src, cache]); child.on('message', (m) => { resolve(m); child.kill(); }); });
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.map((r) => r.error), [undefined, undefined], `both builds finish: ${JSON.stringify(results)}`);
    assert.equal(results[0].ok, results[1].ok, 'both name the same cached copy');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-xerror', '-i', results[0].ok, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal((await ff.probe(results[0].ok)).width, 640);
    assert.deepEqual(fs.readdirSync(cache).filter((name) => name.includes('.part')), [], 'no partial file is left');
    console.log('cache part names: concurrent builds by two processes finish and the cached copy decodes cleanly');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error);process.exitCode = 1; });
