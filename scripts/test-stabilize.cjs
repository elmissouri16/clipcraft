// Stabilize (electron/stabilize.cjs): a synthetic shaky clip comes out steadier (much less change from frame to
// frame), with the clip's length, found in the cache the second time, and a canceled job leaves nothing behind.
// Usage: node scripts/test-stabilize.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, toSdr } = require('../electron/ffmpeg.cjs');
const { stabilize } = require('../electron/stabilize.cjs');

// Mean difference between consecutive frames (0..255): lower is steadier.
const shake = (file) => {
  const out = execFileSync(ffmpegPath, ['-hide_banner', '-i', file, '-vf',
    'scale=320:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const v = [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return v.reduce((a, b) => a + b, 0) / v.length;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-stab-'));
  const shaky = path.join(dir, 'shaky.mp4');
  // A test picture filmed by a "shaking hand": a crop window that jitters quickly.
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=4',
    '-vf', 'crop=560:310:40+30*sin(t*13)+15*sin(t*29):25+20*cos(t*11)+10*sin(t*31),scale=640:360', '-pix_fmt', 'yuv420p', shaky]);
  const item = { ...(await probe(shaky)), path: shaky };
  const cache = path.join(dir, 'cache');
  const opts = { cacheDir: cache, ffmpegPath, toSdr };
  const marks = [];
  const out = await stabilize(item, { ...opts, from: 0.5, to: 3.5, level: 'recommended', onProgress: (f) => marks.push(f) });
  const info = await probe(out);
  assert.ok(Math.abs(info.duration - 3) < 0.15, `stabilized length ${info.duration}`);
  assert.equal(marks.at(-1), 1, 'progress reaches 100%');
  const before = shake(shaky);
  const after = shake(out);
  assert.ok(after < before * 0.6, `steadier: ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  console.log(`shake ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  const t = Date.now();
  assert.equal(await stabilize(item, { ...opts, from: 0.5, to: 3.5, level: 'recommended' }), out, 'from the cache');
  assert.ok(Date.now() - t < 200, 'cache is instant');
  let n = 0;
  await stabilize(item, { ...opts, from: 0, to: 4, level: 'most', isCanceled: () => ++n > 2 })
    .then(() => assert.fail('not canceled'), (e) => assert.ok(e.canceled, e.message));
  assert.deepEqual(fs.readdirSync(cache), [path.basename(out)], 'a canceled job leaves no file');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('STABILIZE OK');
})().catch((e) => { console.error(e.message); process.exit(1); });
