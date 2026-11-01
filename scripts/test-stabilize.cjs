// Stabilize (electron/stabilize.cjs): measured against GROUND TRUTH, not a proxy metric.
// A detailed still scene is shaken by a known analytic camera path (a crop window following summed
// sines), the app's stabilize runs on it, and the residual jitter of both files is measured the same
// way: consecutive-frame template matching (electron/track.cjs, sub-pixel) recovers the camera path,
// and jitter is the RMS frame-step of the path after removing its smooth (intended) component.
//
// Why not the old metric: this suite used to compare mean frame differences over an animated
// testsrc2 clip and demand -40%; it measured ~-25..36% and failed in this sandbox. That number was
// the metric, not the stabilizer — testsrc2's own content moves, and frame difference saturates on
// noise. On the ground-truth fixture below, the path metric reads -97% for the same pipeline where
// frame difference reads about -85%. (The bundled ffmpeg does ship vidstabdetect/vidstabtransform;
// deshake, measured for reference, leaves ~4x the residual jitter of vidstab here.)
// Also covered: output length, progress reaching 100%, the cache, and cancel leaving nothing behind.
// Usage: node scripts/test-stabilize.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, toSdr } = require('../electron/ffmpeg.cjs');
const { stabilize } = require('../electron/stabilize.cjs');
const { makeTemplate, matchTemplate } = require('../electron/track.cjs');

function grayFrames(file, W, H) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('frame extraction failed'));
      const buf = Buffer.concat(chunks);
      const out = [];
      for (let i = 0; i < Math.floor(buf.length / (W * H)); i++) out.push(buf.subarray(i * W * H, (i + 1) * W * H));
      resolve(out);
    });
  });
}

// RMS frame-step (px, at the source's width) of the recovered camera path minus its 15-frame moving
// average — the part of the motion that reads as shake.
async function jitter(file, srcW) {
  const W = 512;
  const H = 288;
  const frames = await grayFrames(file, W, H);
  const k = srcW / W;
  const pos = [{ x: 0, y: 0 }];
  let cur = { x: 0, y: 0 };
  for (let i = 1; i < frames.length; i++) {
    const tpl = makeTemplate(frames[i - 1], W, H, W / 2, H / 2, 176, 120);
    const m = matchTemplate(frames[i], W, H, tpl, W / 2, H / 2, 22);
    cur = { x: cur.x + (m.x - W / 2) * k, y: cur.y + (m.y - H / 2) * k };
    pos.push({ ...cur });
  }
  const movavg = (v, r) => v.map((_, i) => {
    let s = 0; let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(v.length - 1, i + r); j++) { s += v[j]; n++; }
    return s / n;
  });
  const xs = movavg(pos.map((p) => p.x), 7);
  const ys = movavg(pos.map((p) => p.y), 7);
  let s = 0;
  for (let i = 1; i < pos.length; i++) {
    const dx = (pos[i].x - xs[i]) - (pos[i - 1].x - xs[i - 1]);
    const dy = (pos[i].y - ys[i]) - (pos[i - 1].y - ys[i - 1]);
    s += dx * dx + dy * dy;
  }
  return Math.sqrt(s / (pos.length - 1));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-stab-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args]);

  // A detailed, non-periodic still scene (seeded boxes + grain) — periodic test patterns alias under
  // template matching and flatter or sink the measurement, so the scene is deliberately irregular.
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const palette = ['e74c3c', 'f1c40f', '2ecc71', '3498db', '9b59b6', 'e67e22', 'ecf0f1', '1abc9c', 'fd79a8', '74b9ff'];
  const boxes = [];
  for (let i = 0; i < 240; i++) {
    const w = 20 + Math.floor(rnd() * 200);
    const h = 14 + Math.floor(rnd() * 140);
    const x = Math.floor(rnd() * (1400 - w));
    const y = Math.floor(rnd() * (800 - h));
    boxes.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x${palette[i % palette.length]}:t=fill`);
  }
  const still = path.join(dir, 'still.png');
  gen(['-f', 'lavfi', '-i', 'color=c=0x2a2f3a:s=1400x800', '-vf', `${boxes.join(',')},noise=alls=10`, '-frames:v', '1', still]);

  // The known shake: crop window following summed sines (frame n of 30 fps), ~±15 px of travel.
  const ox = '60+7*sin(2*PI*0.9*n/30)+5*sin(2*PI*2.3*n/30+1.7)+3*sin(2*PI*4.1*n/30+0.6)';
  const oy = '40+6*cos(2*PI*1.3*n/30+0.4)+4*sin(2*PI*3.1*n/30+2.9)+2*sin(2*PI*5.3*n/30)';
  const shaky = path.join(dir, 'shaky.mp4');
  gen(['-loop', '1', '-framerate', '30', '-i', still, '-vf', `crop=1280:720:x='${ox}':y='${oy}'`, '-t', '6', '-pix_fmt', 'yuv420p', shaky]);

  const item = { ...(await probe(shaky)), path: shaky };
  const cache = path.join(dir, 'cache');
  const opts = { cacheDir: cache, ffmpegPath, toSdr };

  // Full range at the recommended level: the steadiness verdict.
  const out = await stabilize(item, { ...opts, from: 0, to: 6, level: 'recommended' });
  const before = await jitter(shaky, 1280);
  const after = await jitter(out, 1280);
  const reduction = 1 - after / before;
  console.log(`camera-path jitter ${before.toFixed(2)} px -> ${after.toFixed(2)} px (${(reduction * 100).toFixed(1)}% removed)`);
  assert.ok(reduction >= 0.7, `stabilize removes at least 70% of the jitter (got ${(reduction * 100).toFixed(1)}%)`);

  // A ranged render: length + progress.
  const marks = [];
  const ranged = await stabilize(item, { ...opts, from: 0.5, to: 3.5, level: 'recommended', onProgress: (f) => marks.push(f) });
  const info = await probe(ranged);
  assert.ok(Math.abs(info.duration - 3) < 0.15, `stabilized length ${info.duration}`);
  assert.equal(marks.at(-1), 1, 'progress reaches 100%');

  // The cache serves the second run instantly, with the same file.
  const t = Date.now();
  assert.equal(await stabilize(item, { ...opts, from: 0.5, to: 3.5, level: 'recommended' }), ranged, 'from the cache');
  assert.ok(Date.now() - t < 200, 'cache is instant');

  // A canceled job leaves nothing behind (only the two finished renders are in the cache).
  let n = 0;
  await stabilize(item, { ...opts, from: 0, to: 4, level: 'most', isCanceled: () => ++n > 2 })
    .then(() => assert.fail('not canceled'), (e) => assert.ok(e.canceled, e.message));
  assert.deepEqual(fs.readdirSync(cache).sort(), [path.basename(out), path.basename(ranged)].sort(), 'a canceled job leaves no file');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('STABILIZE OK');
})().catch((e) => { console.error(e.message); process.exit(1); });
