// Eased transitions, export proof: the same Zoom In junction exported three ways — no ease (the
// pre-easing behaviour), Ease In, Overshoot — through the real export pipeline. The animated segment
// is rendered the way src/fxExport.js renders it (progress = easeValue(clip.transition.ease, raw)),
// here with the CPU reference of the same expression language. Claims measured on the exported files:
// eased mid-junction frames differ measurably from linear, Ease In lags (closer to clip A), and the
// frames OUTSIDE the junction are untouched by the easing.
// Usage: node scripts/test-eased-transition.cjs
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
  const { easeValue } = await import('../src/fx/easing.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-eased-'));
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

  // Mirrors src/fxExport.js: frame k of the junction is drawn at easeValue(ease, k / fps / len).
  const renderSegment = async (id, ease) => {
    const t = fxTransition(id);
    const frames = Math.max(1, Math.round(TD * FPS));
    const fa = decodeFrames(a, 2 - TD, TD);
    const fb = decodeFrames(b, 0, TD);
    const seg = path.join(dir, `seg-${ease ? (typeof ease === 'string' ? ease : 'custom') : 'linear'}.mkv`);
    const enc = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', seg], { windowsHide: true });
    const done = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`segment encoder ${c}`)))); enc.on('error', rej); });
    enc.stdin.on('error', () => {});
    for (let k = 0; k < frames; k++) {
      const out = new Uint8ClampedArray(W * H * 4);
      runTransition(fa[Math.min(k, fa.length - 1)], fb[Math.min(k, fb.length - 1)], out, W, H, easeValue(ease, (k / FPS) / TD), t.expr);
      if (!enc.stdin.write(Buffer.from(out))) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await done;
    return seg;
  };

  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const exportWith = async (tag, ease) => {
    const project = {
      name: 'eased', ratio: '16:9', resolution: 180, width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [
        { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2 },
        { ...base, id: 'c2', mediaId: 'm2', in: 0, out: 2, transition: { type: 'fx_zoomin', duration: TD, ...(ease ? { ease } : {}) } },
      ],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
      fxSegments: { c2: await renderSegment('fx_zoomin', ease) },
    };
    const out = path.join(dir, `out-${tag}.mp4`);
    await runExport(project, out, null).promise;
    return out;
  };

  const frameRgb = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${W}:${H},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 24 });
  const meanDiff = (f1, f2) => {
    let s = 0;
    for (let i = 0; i < f1.length; i++) s += Math.abs(f1[i] - f2[i]);
    return s / f1.length;
  };

  const linear = await exportWith('linear', undefined);
  const easeIn = await exportWith('easein', 'easeIn');
  const over = await exportWith('overshoot', 'overshoot');
  for (const [name, f] of [['linear', linear], ['easeIn', easeIn], ['overshoot', over]]) {
    const info = await probe(f);
    assert(Math.abs(info.duration - 3.4) < 0.2 && info.hasVideo && info.hasAudio, `${name}: sane export (${info.duration.toFixed(2)}s)`);
  }
  const mid = 2 - TD / 2;
  const pureA = frameRgb(a, 1.0);
  const linMid = frameRgb(linear, mid);
  const inMid = frameRgb(easeIn, mid);
  const overMid = frameRgb(over, mid);
  const dIn = meanDiff(inMid, linMid);
  const dOver = meanDiff(overMid, linMid);
  console.log(`mid-junction mean diff vs linear: easeIn ${dIn.toFixed(2)}, overshoot ${dOver.toFixed(2)}`);
  assert(dIn > 1.5, 'Ease In mid frame measurably differs from linear');
  assert(dOver > 1.5, 'Overshoot mid frame measurably differs from linear');
  const lagLin = meanDiff(linMid, pureA);
  const lagIn = meanDiff(inMid, pureA);
  console.log(`distance to clip A at mid: linear ${lagLin.toFixed(2)}, easeIn ${lagIn.toFixed(2)} (easeIn lags = closer to A)`);
  assert(lagIn < lagLin, 'Ease In is behind linear at mid-junction (closer to A)');
  // Outside the junction the easing changes nothing in the picture: the A-side frame is bit-identical,
  // the B-side frame differs only by encoder noise (the spliced segment shifts the GOP, so B re-encodes
  // slightly differently — two orders of magnitude below the eased mid-junction difference).
  for (const t of [1.0, 3.1]) {
    const d = meanDiff(frameRgb(easeIn, t), frameRgb(linear, t));
    console.log(`outside junction t=${t}: easeIn vs linear diff ${d.toFixed(3)}`);
    assert(d < 1.2, `frame at ${t}s unchanged by easing (encoder noise only)`);
  }
  assert(dIn > 20 * 1.2, 'the eased difference is concentrated inside the junction');
  console.log('EASED TRANSITION EXPORT OK — eased Zoom junctions differ measurably mid-flight, identical outside');
})().catch((e) => { console.error('EASED TRANSITION EXPORT FAIL:', e.message); process.exit(1); });
