// Stage 1 compositing proofs (blend parity, opacity, chroma key + spill, mask shapes):
// exports two-layer fixtures of known colours through the real export pipeline and checks
// the sampled pixels against the blend formula / keying expectation / shape geometry.
// Usage: node scripts/test-compositing.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

const W = 320;
const H = 180;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-compositing-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const pixel = (file, t, x, y) => [...execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
  '-vf', `crop=4:4:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
const near = (a, b, tol, what) => ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${what}: got rgb(${a}), expected ~rgb(${b}) ±${tol}`);

const solid = (name, hex, secs = 2) => {
  const p = path.join(dir, name);
  gen(['-f', 'lavfi', '-i', `color=c=${hex}:s=${W}x${H}:r=30:d=${secs}`, '-pix_fmt', 'yuv420p', p]);
  return p;
};

(async () => {
  // ---- Blend parity: base (64,128,191) under top (204,102,51), full-frame overlay. ----
  const baseF = solid('base.mp4', '0x4080bf');
  const topF = solid('top.mp4', '0xcc6633');
  const media = [];
  for (const [id, p] of [['b', baseF], ['t', topF]]) media.push({ id, path: p, name: id, ...(await probe(p)) });
  const clipBase = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mk = (extra) => ({
    name: 'blend', width: W, height: H, fps: 30, background: '#000000', media,
    videoClips: [{ ...clipBase, id: 'base', mediaId: 'b', in: 0, out: 2 }],
    overlayClips: [{ ...clipBase, id: 'top', mediaId: 't', start: 0, in: 0, out: 2, ...extra }],
    textClips: [], audioClips: [], stickerClips: [],
  });
  const B = [64 / 255, 128 / 255, 191 / 255];
  const T = [204 / 255, 102 / 255, 51 / 255];
  const formulas = {
    multiply: (a, b) => a * b,
    screen: (a, b) => 1 - (1 - a) * (1 - b),
    overlay: (a, b) => (b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
    difference: (a, b) => Math.abs(a - b),
  };
  for (const [mode, f] of Object.entries(formulas)) {
    const out = path.join(dir, `blend-${mode}.mp4`);
    await runExport(mk({ blend: mode }), out, () => {}).promise;
    const exp = T.map((t, i) => Math.round(f(t, B[i]) * 255));
    near(pixel(out, 1, 160, 90), exp, 12, `blend ${mode} matches the formula`);
  }
  { // Opacity 0.5, normal mode: the plain 50% mix.
    const out = path.join(dir, 'blend-opacity.mp4');
    await runExport(mk({ opacity: 0.5 }), out, () => {}).promise;
    const exp = T.map((t, i) => Math.round((t * 0.5 + B[i] * 0.5) * 255));
    near(pixel(out, 1, 160, 90), exp, 10, 'opacity 0.5 gives the 50% mix');
  }

  // ---- Chroma key: green screen, red subject box, pale-green inner box for the spill check. ----
  const gs = path.join(dir, 'gs.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=0x00ff00:s=${W}x${H}:r=30:d=2,drawbox=x=110:y=55:w=100:h=70:color=0xff0000:t=fill,drawbox=x=135:y=70:w=50:h=40:color=0x7fe07f:t=fill`, '-pix_fmt', 'yuv420p', gs]);
  const gMedia = [{ id: 'g', path: gs, name: 'gs', ...(await probe(gs)) }];
  const chromaProj = (spill) => ({
    name: 'chroma', width: W, height: H, fps: 30, background: '#203040', media: gMedia,
    videoClips: [{ ...clipBase, id: 'k', mediaId: 'g', in: 0, out: 2, chroma: { on: true, color: '#00ff00', intensity: 25, feather: 10, spill } }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
  });
  const BG = [0x20, 0x30, 0x40];
  const outS0 = path.join(dir, 'chroma-s0.mp4');
  await runExport(chromaProj(0), outS0, () => {}).promise;
  near(pixel(outS0, 1, 20, 20), BG, 25, 'chroma: keyed area shows the background');
  near(pixel(outS0, 1, 120, 65), [255, 0, 0], 30, 'chroma: subject box intact');
  const gNoSpill = pixel(outS0, 1, 160, 90)[1];
  const outS100 = path.join(dir, 'chroma-s100.mp4');
  await runExport(chromaProj(100), outS100, () => {}).promise;
  const gSpill = pixel(outS100, 1, 160, 90)[1];
  ok(gNoSpill > 180 && gSpill < gNoSpill - 25, `chroma: spill control drops the green cast (${gNoSpill} -> ${gSpill})`);

  // ---- Masks: PIL-drawn shape alphas (the preview uses the identical PNG via maskUrl). ----
  const white = path.join(dir, 'white.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}:r=30:d=2`, '-pix_fmt', 'yuv420p', white]);
  const wMedia = [{ id: 'w', path: white, name: 'white', ...(await probe(white)) }];
  const shapes = {
    circle: `d.ellipse([110,40,210,140], fill=(255,255,255,255))`,
    rectangle: `d.rectangle([80,45,240,135], fill=(255,255,255,255))`,
    star: `import math; cx,cy,R,r=160,90,60,25; pts=[]; [pts.extend([(cx+ (R if i%2==0 else r)*math.cos(-math.pi/2+i*math.pi/5), cy+(R if i%2==0 else r)*math.sin(-math.pi/2+i*math.pi/5))]) for i in range(10)]; d.polygon(pts, fill=(255,255,255,255))`,
  };
  const drawMask = (name, draw) => {
    const p = path.join(dir, `mask-${name}.png`);
    execFileSync('python3', ['-c', `from PIL import Image, ImageDraw, ImageFilter; im=Image.new('RGBA',(${W},${H}),(255,255,255,0)); d=ImageDraw.Draw(im); ${draw}; im.save('${p}')`]);
    return p;
  };
  const maskProj = (maskPng) => ({
    name: 'mask', width: W, height: H, fps: 30, background: '#102030', media: wMedia,
    videoClips: [{ ...clipBase, id: 'm', mediaId: 'w', in: 0, out: 2, mask: { type: 'circle' } }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    maskImages: { m: `data:image/png;base64,${fs.readFileSync(maskPng).toString('base64')}` },
  });
  const MBG = [0x10, 0x20, 0x30];
  for (const [name, draw] of Object.entries(shapes)) {
    const out = path.join(dir, `mask-${name}.mp4`);
    await runExport(maskProj(drawMask(name, draw)), out, () => {}).promise;
    near(pixel(out, 1, 160, 90), [255, 255, 255], 25, `mask ${name}: centre shows the clip`);
    near(pixel(out, 1, 8, 8), MBG, 25, `mask ${name}: corner shows the background`);
  }
  { // Feather: a blurred circle edge gives a mid-grey boundary pixel (not a hard step).
    const p = path.join(dir, 'mask-feather.png');
    execFileSync('python3', ['-c', `from PIL import Image, ImageDraw, ImageFilter; im=Image.new('RGBA',(${W},${H}),(255,255,255,0)); d=ImageDraw.Draw(im); d.ellipse([110,40,210,140], fill=(255,255,255,255)); im.filter(ImageFilter.GaussianBlur(12)).save('${p}')`]);
    const out = path.join(dir, 'mask-feather.mp4');
    await runExport(maskProj(p), out, () => {}).promise;
    const edge = pixel(out, 1, 110, 90)[0];
    ok(edge > 60 && edge < 200, `mask feather softens the edge (boundary pixel ${edge}, between background and white)`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nCOMPOSITING OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
