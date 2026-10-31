// Export text layer: raw frames, runs of transparent frames and repeats go into text.mov; every frame must come
// back pixel for pixel (transparency included), in order.
// Usage: node scripts/test-textstream.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');
const { TextStream } = require('../electron/textstream.cjs');

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const W = 64;
const H = 36;

// A frame with a half-transparent box at x (straight alpha, like canvas getImageData).
const frame = (x, a = 200) => {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 5; y < 20; y++) {
    for (let i = x; i < x + 10; i++) px.set([255, 200, 0, a], (y * W + i) * 4);
  }
  return px;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-text-'));
  const s = new TextStream(ffmpegPath, dir, W, H, 30);
  const a = frame(2);
  const b = frame(30, 255);
  await s.add({ blank: 3 });
  await s.add(a);
  await s.add({ same: 2 });
  await s.add(b);
  await s.add({ blank: 1 });
  await s.add({ same: 1 }); // a copy of the transparent frame before it
  await s.finish();
  assert(s.count === 9, `frames written: ${s.count}`);

  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', s.file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e8 });
  const size = W * H * 4;
  assert(raw.length === size * 9, `decoded ${raw.length / size} frames`);
  const want = [null, null, null, a, a, a, b, null, null];
  want.forEach((px, i) => {
    const got = raw.subarray(i * size, (i + 1) * size);
    const exp = px ? Buffer.from(px.buffer) : Buffer.alloc(size);
    assert(got.equals(exp), `frame ${i} differs`);
  });

  // Like the export: each frame goes as the rectangle that changed since the last one (or a count when nothing
  // did), and the decoded frames must equal the drawn ones.
  const { changedRect, cutRect } = await import('../src/frameDiff.js');
  assert(changedRect(new Uint32Array(W * H), new Uint32Array(W * H), W, H) === null, 'equal frames have no change');
  const r0 = changedRect(new Uint32Array(W * H), new Uint32Array(frame(2).buffer), W, H);
  assert(r0.x === 2 && r0.y === 5 && r0.w === 10 && r0.h === 15, `change rect ${JSON.stringify(r0)}`);
  const drawn = [frame(2), frame(2), frame(3), frame(40, 255), new Uint8ClampedArray(W * H * 4), frame(40, 255)];
  const p = new TextStream(ffmpegPath, dir, W, H, 30);
  let prev = new Uint32Array(W * H);
  for (const px of drawn) {
    const cur = new Uint32Array(px.buffer);
    const r = changedRect(prev, cur, W, H);
    await p.add(r ? { ...r, data: cutRect(px, W, r) } : { same: 1 });
    prev = cur;
  }
  await p.finish();
  const raw2 = execFileSync(ffmpegPath, ['-v', 'error', '-i', p.file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e8 });
  assert(raw2.length === size * drawn.length, `patched: decoded ${raw2.length / size} frames`);
  drawn.forEach((px, i) => assert(raw2.subarray(i * size, (i + 1) * size).equals(Buffer.from(px.buffer)), `patched frame ${i} differs`));
  const outside = new TextStream(ffmpegPath, dir, W, H, 30);
  await outside.add({ x: W - 2, y: 0, w: 5, h: 1, data: new Uint8Array(20) })
    .then(() => { throw new Error('patch outside the frame accepted'); }, () => {});
  outside.kill();

  // A wrong frame size is refused, and killing the stream stops FFmpeg.
  const bad = new TextStream(ffmpegPath, dir, W, H, 30);
  await bad.add(new Uint8Array(10)).then(() => { throw new Error('wrong size accepted'); }, () => {});
  bad.kill();
  await bad.done.then(() => { throw new Error('killed stream finished'); }, () => {});

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('TEXT STREAM OK');
})().catch((e) => { console.error(e); process.exit(1); });
