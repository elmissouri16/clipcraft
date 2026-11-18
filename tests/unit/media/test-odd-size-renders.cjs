// Clip renders of an odd-sized video (a cropped screen capture, 641x361 here) must succeed: H.264 4:2:0
// needs even dimensions, so Reverse and Stabilize round the picture down to the nearest even size.
// Usage: node tests/unit/media/test-odd-size-renders.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');
const { reverse } = require('../../../electron/media/reverse.cjs');
const { stabilize } = require('../../../electron/media/stabilize.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-odd-size-')), src = path.join(dir, 'odd.mov');
(async () => {
  try {
    // vid.stab needs trackable detail: a still of boxes seen through a shaking window.
    const still = path.join(dir, 'still.png'), palette = ['e05a47', 'f2c14e', '5fb49c', '3d5a80', 'ffffff'];
    const boxes = Array.from({ length: 120 }, (_, i) => `drawbox=x=${(i * 97) % 1000}:y=${(i * 53) % 560}:w=${20 + (i * 13) % 80}:h=${14 + (i * 7) % 60}:color=0x${palette[i % 5]}:t=fill`);
    execFileSync(ff.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2a2f3a:s=1100x640', '-vf', `${boxes.join(',')},noise=alls=10`, '-frames:v', '1', still]);
    execFileSync(ff.ffmpegPath, ['-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', still, '-vf', "crop=641:361:x='60+7*sin(2*PI*0.9*n/30)':y='40+6*cos(2*PI*1.3*n/30+0.4)'",
      '-t', '2', '-c:v', 'mjpeg', '-pix_fmt', 'yuvj444p', '-q:v', '3', src]);
    const item = { path: src, ...(await ff.probe(src)) };
    assert.deepEqual([item.width, item.height], [641, 361]);
    const options = { from: 0, to: 2, cacheDir: path.join(dir, 'cache'), ffmpegPath: ff.ffmpegPath, toSdr: ff.toSdr };
    for (const [name, render] of [['reverse', () => reverse(item, options)], ['stabilize', () => stabilize(item, { ...options, level: 'recommended' })]]) {
      const out = await render(), info = await ff.probe(out);
      assert.deepEqual([info.width, info.height], [640, 360], `${name} rounds to an even size`);
      assert.ok(Math.abs(info.duration - 2) < 0.15, `${name} keeps the range length: ${info.duration}`);
    }
    assert.deepEqual(fs.readdirSync(options.cacheDir).filter((name) => /\.part|\.trf$/.test(name)), [], 'no partial file is left');
    console.log('odd-sized video: reverse and stabilize render at the nearest even size');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
