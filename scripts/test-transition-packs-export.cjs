// Transition packs, export proof: six pack transitions (one per pack + the whip pan) go through the real
// export pipeline. The animated segment is rendered exactly the way the app renders it — FFmpeg decodes
// the frames, the transition expression draws them (here the CPU reference of the same expression
// language the WebGL shader is compiled from; test-fx / test-transition-packs prove the shader side),
// FFmpeg stores them losslessly (ffv1/mkv, as electron/fxjobs.cjs does) — then runExport joins the
// project with project.fxSegments, as electron/ffmpeg.cjs does for every fx transition.
// Usage: node scripts/test-transition-packs-export.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const TD = 0.6;
const assert = (ok, what) => { if (!ok) throw new Error(what); };

(async () => {
  const { runTransition } = await import('../src/fx/run.js');
  const { fxTransition } = await import('../src/fx/catalog.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-packs-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const a = path.join(dir, 'a.mp4');
  const b = path.join(dir, 'b.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', a]);
  gen(['-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', b]);
  const media = [];
  for (const [id, p] of [['m1', a], ['m2', b]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });

  const decodeFrames = (file, from, len) => {
    const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
    const size = W * H * 4;
    const frames = [];
    for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
    return frames;
  };

  // The effects pass for one transition, mirroring electron/fxjobs.cjs (frames + ffv1/mkv segment).
  const renderSegment = async (id) => {
    const t = fxTransition(id);
    assert(t, `${id} is an fx transition`);
    const frames = Math.max(1, Math.round(TD * FPS));
    const fa = decodeFrames(a, 2 - TD, TD);
    const fb = decodeFrames(b, 0, TD);
    assert(fa.length >= frames - 1 && fb.length >= frames - 1, `${id}: decoded ${fa.length}/${fb.length} frames`);
    const seg = path.join(dir, `seg-${id}.mkv`);
    const enc = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', seg], { windowsHide: true });
    const done = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`segment encoder ${c}`)))); enc.on('error', rej); });
    enc.stdin.on('error', () => {});
    for (let k = 0; k < frames; k++) {
      const out = new Uint8ClampedArray(W * H * 4);
      runTransition(fa[Math.min(k, fa.length - 1)], fb[Math.min(k, fb.length - 1)], out, W, H, (k / FPS) / TD, t.expr);
      if (!enc.stdin.write(Buffer.from(out))) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await done;
    return seg;
  };

  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const exportWith = async (id, type, seg) => {
    const project = {
      name: 'packs', ratio: '16:9', resolution: 180, width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [
        { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2 },
        { ...base, id: 'c2', mediaId: 'm2', in: 0, out: 2, transition: { type, duration: TD } },
      ],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
      ...(seg ? { fxSegments: { c2: seg } } : {}),
    };
    const out = path.join(dir, `out-${id}.mp4`);
    await runExport(project, out, null).promise;
    return out;
  };

  const CASES = ['fx_whipleft', 'fx_zoomblur', 'fx_gridreveal', 'fx_flaresweep', 'fx_rgbslidel', 'fx_filmroll',
    'fx_rects', 'fx_circlecorner', 'fx_diagstripes'];
  for (const id of CASES) {
    const out = await exportWith(id, id, await renderSegment(id));
    const info = await probe(out);
    assert(Math.abs(info.duration - 3.4) < 0.2, `${id}: duration ${info.duration}, expected ~3.4`);
    assert(info.hasVideo && info.hasAudio, `${id}: video + audio streams`);
    assert(info.width === W && info.height === H, `${id}: size ${info.width}x${info.height}`);
    console.log(`${id}: export OK (${info.duration.toFixed(2)}s, ${info.width}x${info.height}, audio ${info.hasAudio})`);
  }

  // Motion profile: at the middle of the transition window the whip pan frame is motion-blurred
  // (low horizontal gradient energy), a plain dissolve's mid frame is a sharp double exposure.
  const frameAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { maxBuffer: 1 << 24 });
  const hGrad = (buf) => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) { s += Math.abs(buf[y * W + x] - buf[y * W + x - 1]); n++; }
    return s / n;
  };
  const mid = 2 - TD / 2; // the transition window is [2 - TD, 2]; its middle in the joined video
  const whipOut = await exportWith('whip-check', 'fx_whipleft', await renderSegment('fx_whipleft'));
  const dissolveOut = await exportWith('dissolve-check', 'dissolve', null);
  const whipGrad = hGrad(frameAt(whipOut, mid));
  const dissolveGrad = hGrad(frameAt(dissolveOut, mid));
  console.log(`mid-transition horizontal gradient: whip ${whipGrad.toFixed(2)} vs dissolve ${dissolveGrad.toFixed(2)}`);
  assert(whipGrad < dissolveGrad * 0.85, 'whip pan mid frame is blurred compared with a dissolve');

  // ---- The three reveal additions, each with a measurement only it can pass. ----
  const frameRgb = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${W}:${H},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 24 });
  const blockDiff = (f1, f2, x0, y0, x1, y1) => {
    let s = 0; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * 3; s += Math.abs(f1[o] - f2[o]) + Math.abs(f1[o + 1] - f2[o + 1]) + Math.abs(f1[o + 2] - f2[o + 2]); n += 3; }
    return s / n;
  };
  const pureA = frameRgb(a, 1.85);
  const pureB = frameRgb(b, 0.15);

  // Circles From Corner: at mid-transition the corner is already B while the centre is still A —
  // the exact opposite of the centre iris.
  const cornerOut = await exportWith('circlecorner-check', 'fx_circlecorner', await renderSegment('fx_circlecorner'));
  const cornerMid = frameRgb(cornerOut, mid);
  const cornerToB = blockDiff(cornerMid, pureB, 0, 0, 44, 44);
  const cornerToA = blockDiff(cornerMid, pureA, 0, 0, 44, 44);
  const centreToA = blockDiff(cornerMid, pureA, W / 2 - 22, H / 2 - 22, W / 2 + 22, H / 2 + 22);
  const centreToB = blockDiff(cornerMid, pureB, W / 2 - 22, H / 2 - 22, W / 2 + 22, H / 2 + 22);
  console.log(`circlecorner mid: corner->B ${cornerToB.toFixed(1)} vs corner->A ${cornerToA.toFixed(1)}; centre->A ${centreToA.toFixed(1)} vs centre->B ${centreToB.toFixed(1)}`);
  assert(cornerToB < cornerToA * 0.8, 'circlecorner: the corner has flipped to B at mid-transition');
  assert(centreToA < centreToB, 'circlecorner: the centre is still A at mid-transition');

  // Diagonal Stripes: B-likeness along the diagonal alternates band by band (a plain wipe is monotonic).
  const stripesOut = await exportWith('diagstripes-check', 'fx_diagstripes', await renderSegment('fx_diagstripes'));
  const stripesMid = frameRgb(stripesOut, mid);
  const SLICES = 28;
  const prof = [];
  for (let sIdx = 0; sIdx < SLICES; sIdx++) {
    let dA = 0; let dB = 0; let n = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      if (Math.floor((x + y) / (W + H) * SLICES) !== sIdx) continue;
      const o = (y * W + x) * 3;
      dA += Math.abs(stripesMid[o] - pureA[o]) + Math.abs(stripesMid[o + 1] - pureA[o + 1]) + Math.abs(stripesMid[o + 2] - pureA[o + 2]);
      dB += Math.abs(stripesMid[o] - pureB[o]) + Math.abs(stripesMid[o + 1] - pureB[o + 1]) + Math.abs(stripesMid[o + 2] - pureB[o + 2]);
      n++;
    }
    prof.push(n ? Math.sign(dA / n - dB / n) : 0); // +1: slice looks like B, -1: like A
  }
  let flips = 0;
  for (let i = 1; i < SLICES; i++) if (prof[i] !== 0 && prof[i - 1] !== 0 && prof[i] !== prof[i - 1]) flips++;
  console.log(`diagstripes mid: diagonal B-likeness profile flips ${flips} times across ${SLICES} slices`);
  assert(flips >= 3, 'diagstripes: bands alternate along the diagonal (not a monotonic wipe)');

  // Rectangles: the two-color flash edge exists ONLY while blocks are flipping.
  const flashShare = (f) => {
    let hit = 0;
    for (let o = 0; o < f.length; o += 3) {
      const r = f[o]; const g = f[o + 1]; const bl = f[o + 2];
      const warm = Math.abs(r - 255) < 30 && Math.abs(g - 210) < 35 && Math.abs(bl - 90) < 40;
      const cyan = Math.abs(r - 90) < 40 && Math.abs(g - 200) < 35 && Math.abs(bl - 255) < 30;
      if (warm || cyan) hit++;
    }
    return hit / (f.length / 3);
  };
  const rectsOut = await exportWith('rects-check', 'fx_rects', await renderSegment('fx_rects'));
  const flashMid = flashShare(frameRgb(rectsOut, 2 - TD * 0.72)); // early-mid: many blocks mid-flip
  const flashRest = flashShare(frameRgb(rectsOut, 1.0));
  console.log(`rectangles: flash-color share mid ${(flashMid * 100).toFixed(2)}% vs rest ${(flashRest * 100).toFixed(2)}%`);
  assert(flashMid > 0.004, 'rectangles: the two-color flash edge is present while blocks flip');
  assert(flashRest < flashMid * 0.4, 'rectangles: no flash colors outside the transition');
  console.log('TRANSITION PACKS EXPORT OK');
})().catch((e) => { console.error(e.message); process.exit(1); });
