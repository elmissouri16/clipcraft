// Animated GIFs as clips: on the main track and as an overlay (layered path), the export works and
// the GIF animation plays. (R1, 2026-11-01: the GIF-as-sticker placement was removed with the
// Stickers feature.) Usage: node scripts/test-gif.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-gif-'));
  const gif = path.join(dir, 'anim.gif');
  // 1 s animation, 10 frames: black, then white for the second half.
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=0.5', '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=10:d=0.5',
    '-filter_complex', '[0][1]concat=n=2:v=1', gif]);
  const m = { id: 'g', path: gif, name: 'anim.gif', ...(await probe(gif)) };
  assert.equal(m.type, 'image', 'a GIF is a picture in the library');
  const clip = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const project = {
    name: 'gif', width: 320, height: 180, fps: 30, background: '#000000', media: [m],
    videoClips: [{ ...clip, id: 'v', mediaId: 'g', in: 0, out: 3 }],
    overlayClips: [{ ...clip, id: 'o', mediaId: 'g', start: 0.5, in: 0, out: 2, transform: { scale: 0.4, x: 0.25, y: -0.25 } }],
    textClips: [], audioClips: [],
  };
  const out = path.join(dir, 'out.mp4');
  await runExport(project, out, () => {}).promise;
  const info = await probe(out);
  assert.ok(Math.abs(info.duration - 3) < 0.15, `duration ${info.duration}`);
  // The GIF plays and loops: black, white, black again (a corner of the main-track picture, away from the overlay).
  const px = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=4:4:20:150', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])[5];
  const seen = [0.2, 0.75, 1.2, 1.75].map(px);
  assert.ok(seen[0] < 60 && seen[1] > 190 && seen[2] < 60 && seen[3] > 190, `the GIF animates and loops (${seen})`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('GIF OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
