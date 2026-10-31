// Item 12 proofs D: a freeze-frame edit holds in EXPORT. Builds the exact structure the Freeze
// menu action produces — [source 0..1.2][4 s still of the 1.2 s frame][source 1.2..6] — through
// the real export path and asserts the still's span is pixel-static and matches the source frame
// it was taken from, while the moving parts are not static.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-freeze-'));
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const src = path.join(dir, 'src.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', src]);
const still = path.join(dir, 'frame.png');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1.2', '-i', src, '-frames:v', '1', still]);

const media = [
  { id: 'm1', path: src, type: 'video', duration: 6, width: 320, height: 180, hasAudio: false },
  { id: 'm2', path: still, type: 'image', duration: 4, width: 320, height: 180 },
];
const base = { speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, transform: { scale: 1, x: 0, y: 0, rot: 0, uniform: true, scaleX: 1, scaleY: 1 }, opacity: 1 };
const project = {
  name: 'freeze', ratio: '16:9', resolution: 720, width: 320, height: 180, fps: 30, background: '#101010', media,
  videoClips: [
    { ...base, id: 'a', mediaId: 'm1', in: 0, out: 1.2 },
    { ...base, id: 'still', mediaId: 'm2', in: 0, out: 4 },
    { ...base, id: 'b', mediaId: 'm1', in: 1.2, out: 6 },
  ],
  overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
};
const frame = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 * 1024 * 1024 });
const diff = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]); return s / n; };

(async () => {
  const out = path.join(dir, 'out.mp4');
  const job = runExport(project, out, () => {});
  await job.promise;
  const fPre = frame(out, 0.5);   // moving source, before the freeze
  const fIn1 = frame(out, 2.0);   // inside the still (1.2..5.2)
  const fIn2 = frame(out, 4.8);   // still inside, near the end
  const fRef = frame(src, 1.2);   // the source frame that was frozen
  const fPost = frame(out, 5.8);  // moving again (source ~1.8)
  ok(diff(fIn1, fIn2) < 1.5, `frozen span is static (diff ${diff(fIn1, fIn2).toFixed(2)})`);
  ok(diff(fIn1, fRef) < 6, `frozen frame matches the source frame at 1.2 s (diff ${diff(fIn1, fRef).toFixed(2)})`);
  ok(diff(fPre, fIn1) > 4, `pre-freeze frame differs from the frozen one (diff ${diff(fPre, fIn1).toFixed(2)})`);
  ok(diff(fPost, fIn1) > 4, `post-freeze motion differs from the frozen frame (diff ${diff(fPost, fIn1).toFixed(2)})`);
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
