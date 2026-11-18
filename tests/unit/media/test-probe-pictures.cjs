// A damaged picture must be refused when it is probed: its header still reports a size, and a
// looped still that never decodes keeps the export encoder retrying forever.
// Usage: node tests/unit/media/test-probe-pictures.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ffmpegPath, probe } = require('../../../electron/media/ffmpeg.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-probe-pictures-'));
  const make = (name, source) => { const file = path.join(dir, name); execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, ...(name.endsWith('.gif') ? [] : ['-frames:v', '1']), file]); return file; };
  for (const name of ['still.png', 'still.jpg', 'still.webp', 'still.bmp']) {
    const info = await probe(make(name, 'color=red:s=64x48'));
    assert.deepEqual([info.type, info.width, info.height, info.duration], ['image', 64, 48, 0], name);
  }
  assert.equal((await probe(make('moving.gif', 'testsrc2=s=64x48:r=10:d=1'))).type, 'image', 'an animated GIF is still a picture');
  // A PNG whose header is intact (2x2) and whose pixel data cannot be inflated.
  const damaged = path.join(dir, 'damaged.png');
  fs.writeFileSync(damaged, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBNBgAAEnHB/kK8pQ3AAAAAElFTkSuQmCC', 'base64'));
  await assert.rejects(probe(damaged), /damaged or is not a readable image/);
  const truncated = path.join(dir, 'truncated.jpg');
  fs.writeFileSync(truncated, fs.readFileSync(path.join(dir, 'still.jpg')).subarray(0, 200));
  await assert.rejects(probe(truncated), /damaged or is not a readable image/);
  // Video probing is unchanged: no frame counting, the duration comes from the container.
  const video = path.join(dir, 'clip.mp4');
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=1', '-pix_fmt', 'yuv420p', video]);
  const clip = await probe(video);
  assert.equal(clip.type, 'video');
  assert.ok(Math.abs(clip.duration - 1) < 0.2);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PROBE PICTURES OK');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
