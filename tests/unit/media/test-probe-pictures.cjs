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
  // A phone photo stored landscape with EXIF orientation 6 (turn 90°) shows upright everywhere (FFmpeg turns it while
  // decoding, the player shows it turned): its size is the displayed, portrait one, and a layered export fits it so.
  const exif = (orientation) => { const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]); const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]); return Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]); };
  const plain = fs.readFileSync(make('wide.jpg', 'color=white:s=320x240'));
  for (const [orientation, size] of [[1, [320, 240]], [3, [320, 240]], [6, [240, 320]], [8, [240, 320]]]) {
    const file = path.join(dir, `photo-${orientation}.jpg`);
    fs.writeFileSync(file, Buffer.concat([plain.subarray(0, 2), exif(orientation), plain.subarray(2)]));
    const info = await probe(file);
    assert.deepEqual([info.type, info.width, info.height, info.orientation], ['image', ...size, orientation], `EXIF orientation ${orientation}`);
  }
  const { buildExportArgs } = require('../../../electron/media/ffmpeg.cjs');
  const photo = path.join(dir, 'photo-6.jpg'), out = path.join(dir, 'photo.mp4');
  const project = { width: 640, height: 360, fps: 10, background: '#000000', media: [{ id: 'p', path: photo, ...(await probe(photo)) }], videoClips: [{ id: 'c', mediaId: 'p', in: 0, out: 1, transform: { scale: 0.9 } }], overlayClips: [], audioClips: [], textClips: [] };
  execFileSync(ffmpegPath, buildExportArgs(project, out, { encoder: 'libx264' }).args.filter((a) => a !== '-progress' && a !== 'pipe:1'), { stdio: ['ignore', 'ignore', 'pipe'] });
  const gray = execFileSync(ffmpegPath, ['-v', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 22 });
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) if (gray[y * 640 + x] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
  assert.ok(Math.abs(w - 243) <= 3 && Math.abs(h - 324) <= 3, `the portrait photo keeps its shape in a layered export: ${w}x${h}, expected 243x324`);
  // Video probing is unchanged: no frame counting, the duration comes from the container.
  const video = path.join(dir, 'clip.mp4');
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=1', '-pix_fmt', 'yuv420p', video]);
  const clip = await probe(video);
  assert.equal(clip.type, 'video');
  assert.ok(Math.abs(clip.duration - 1) < 0.2);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PROBE PICTURES OK');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
