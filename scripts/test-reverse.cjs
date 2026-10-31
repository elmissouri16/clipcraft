// Item 12 proofs B: Reverse round-trip against electron/reverse.cjs (the real module main uses).
// A time-varying clip (testsrc2) reversed over its full range: the derivative's first frames
// must match the source's last frames (and vice versa), its length must be preserved, the cache
// must serve the second call, and an over-long range must fail with the memory explanation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, ffprobePath } = require('../electron/ffmpeg.cjs');
const { reverse, MAX_SECONDS } = require('../electron/reverse.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-reverse-'));
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const src = path.join(dir, 'src.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', src]);
const frame = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 * 1024 * 1024 });
const diff = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]); return s / n; };
const dur = (file) => Number(execFileSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

(async () => {
  const item = { path: src, duration: 4, hdr: false, hasAudio: false };
  const out = await reverse(item, { from: 0, to: 4, hasVideo: true, cacheDir: dir, ffmpegPath, toSdr: () => '' });
  ok(fs.existsSync(out), 'derivative file created');
  ok(Math.abs(dur(out) - 4) < 0.25, `duration preserved (${dur(out).toFixed(2)}s vs 4s)`);
  const dFirstLast = diff(frame(out, 0.1), frame(src, 3.85));
  const dLastFirst = diff(frame(out, 3.85), frame(src, 0.1));
  const dFirstFirst = diff(frame(out, 0.1), frame(src, 0.1));
  ok(dFirstLast < 6, `reversed first frame matches source last (diff ${dFirstLast.toFixed(2)})`);
  ok(dLastFirst < 6, `reversed last frame matches source first (diff ${dLastFirst.toFixed(2)})`);
  ok(dFirstFirst > 10, `reversed first frame is NOT the source first (diff ${dFirstFirst.toFixed(2)})`);
  const again = await reverse(item, { from: 0, to: 4, hasVideo: true, cacheDir: dir, ffmpegPath, toSdr: () => '' });
  ok(again === out, 'second call is served by the content-hash cache');
  let capError = '';
  try {
    await reverse({ path: src, duration: 999, hdr: false, hasAudio: false }, { from: 0, to: MAX_SECONDS + 5, hasVideo: true, cacheDir: dir, ffmpegPath, toSdr: () => '' });
  } catch (e) { capError = e.message; }
  ok(/memory/i.test(capError), `over-long range refused with the memory explanation ("${capError.slice(0, 60)}…")`);
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
