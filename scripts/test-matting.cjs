// Auto removal (AI background removal). 1) Export with a matte made here (left half white, right half black): the
// left of the clip stays, the right becomes the project background, also trimmed, at 2x and as an overlay.
// 2) electron/matting.cjs with the real model (downloaded once, skipped with --offline): the matte has the clip's
// length, is found in the cache the second time, and a canceled job leaves nothing.
// Usage: node scripts/test-matting.cjs [--offline]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ff = require('../electron/ffmpeg.cjs');
const matting = require('../electron/matting.cjs');

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const run = (args) => execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', ...args]);
const pixel = (file, t, x, y) => [...execFileSync(ff.ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
  '-vf', `crop=4:4:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
const near = (a, b, tol, what) => assert(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${what}: got rgb(${a}), expected about rgb(${b})`);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-matting-'));
  // A 6 s yellow clip with a white box moving right (to see the timing) and its "matte": white on the left half.
  const clip = path.join(dir, 'clip.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=0xffd400:s=320x180:r=30:d=6,drawbox=x=t*40:y=70:w=20:h=40:color=white:t=fill', '-pix_fmt', 'yuv420p', clip]);
  const matte = path.join(dir, 'matte.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=6,drawbox=x=0:y=0:w=160:h=180:color=white:t=fill', '-pix_fmt', 'yuv420p', matte]);
  const item = { ...(await ff.probe(clip)), path: clip };
  const media = [{ ...item, id: 'm', name: 'clip.mp4', matte }];
  const base = { width: 320, height: 180, fps: 30, background: '#ec4899', media, overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [], markers: [] };
  const exp = async (name, project) => {
    const out = path.join(dir, `${name}.mp4`);
    await ff.runExport(project, out, () => {}).promise;
    return { out, info: await ff.probe(out) };
  };
  const PINK = [236, 72, 153];
  const YELLOW = [255, 212, 0];

  let r = await exp('main', { ...base, videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, bgRemove: true }] });
  near(pixel(r.out, 3, 40, 20), YELLOW, 30, 'kept side');
  near(pixel(r.out, 3, 280, 20), PINK, 30, 'removed side shows the background');
  r = await exp('off', { ...base, videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, bgRemove: false }] });
  near(pixel(r.out, 3, 280, 20), YELLOW, 30, 'off: the clip is untouched');
  r = await exp('fast', { ...base, videoClips: [{ id: 'a', mediaId: 'm', in: 1, out: 5, speed: 2, bgRemove: true }] });
  assert(Math.abs(r.info.duration - 2) < 0.1, `trimmed 2x clip lasts ${r.info.duration}`);
  near(pixel(r.out, 1, 280, 20), PINK, 30, 'trimmed and fast: still removed');
  r = await exp('overlay', { ...base, background: '#000000', videoClips: [{ id: 'g', gap: true, in: 0, out: 6, speed: 1 }],
    overlayClips: [{ id: 'o', mediaId: 'm', start: 0, in: 0, out: 6, speed: 1, bgRemove: true, transform: { scale: 1, x: 0, y: 0 } }] });
  near(pixel(r.out, 3, 40, 20), YELLOW, 30, 'overlay kept side');
  near(pixel(r.out, 3, 280, 20), [0, 0, 0], 30, 'overlay removed side');
  // A matte that went missing (other PC, cache cleared): the export still works, without removal.
  r = await exp('missing', { ...base, media: [{ ...media[0], matte: path.join(dir, 'gone.mp4') }], videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, bgRemove: true }] });
  near(pixel(r.out, 3, 280, 20), YELLOW, 30, 'missing matte: clip shown whole');
  console.log('export with a matte ok');

  if (!process.argv.includes('--offline')) {
    const modelDir = path.join(os.tmpdir(), 'fve-matting-model'); // kept between runs (15 MB)
    let dl = 0;
    await matting.install(modelDir, (f) => { dl = f; });
    assert(matting.status(modelDir).installed, 'model installed');
    const cache = path.join(dir, 'cache');
    const opts = { dir: modelDir, cacheDir: cache, ffmpegPath: ff.ffmpegPath, toSdr: ff.toSdr };
    const marks = [];
    const t = Date.now();
    const made = await matting.makeMatte(item, { ...opts, onProgress: (f) => marks.push(f) });
    const info = await ff.probe(made);
    assert(Math.abs(info.duration - item.duration) < 0.1, `matte lasts ${info.duration}, clip ${item.duration}`);
    assert(marks.at(-1) === 1 && marks.length > 3, 'progress reported');
    assert((await matting.makeMatte(item, opts)) === made, 'second time from the cache');
    fs.rmSync(made);
    let k = 0;
    await matting.makeMatte(item, { ...opts, isCanceled: () => ++k > 10 }).then(() => assert(false, 'not canceled'), (e) => assert(e.canceled, e.message));
    assert(fs.readdirSync(cache).length === 0, 'a canceled job leaves no file');
    console.log(`real model ok (${((Date.now() - t) / 1000).toFixed(1)} s for ${item.duration.toFixed(1)} s of video${dl ? '' : ', model already here'})`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('MATTING OK');
})().catch((e) => { console.error(e.message.slice(0, 3000)); process.exit(1); });
