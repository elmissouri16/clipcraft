// Exports clips with chroma key + transform, a circle mask and a multiply blend, then checks pixels of the output.
// Usage: node scripts/test-layers.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const layers = require('../electron/layers.cjs');

const W = 640;
const H = 360;

(async () => {
  // The export side mirrors src/visual.js: same defaults and chroma mapping.
  const visual = await import('../src/visual.js');
  for (const k of ['DEFAULT_TRANSFORM', 'DEFAULT_CHROMA']) {
    if (JSON.stringify(visual[k]) !== JSON.stringify(layers[k])) throw new Error(`${k} differs between visual.js and layers.cjs`);
  }
  const c = { intensity: 37, feather: 11, spill: 40 };
  if (JSON.stringify(visual.chromaParams(c)) !== JSON.stringify(layers.chromaParams(c))) throw new Error('chromaParams differ');
  for (const b of visual.BLEND_MODES) if (b.ff !== (layers.BLEND_FF[b.id] || null)) throw new Error(`blend ${b.id} differs`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-layers-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const green = path.join(dir, 'green.mp4');
  const white = path.join(dir, 'white.png');
  const gray = path.join(dir, 'gray.png');
  const mask = path.join(dir, 'mask.png');
  gen(['-f', 'lavfi', '-i', `color=c=0x00ff00:s=${W}x${H}:r=30:d=3,drawbox=x=200:y=100:w=240:h=160:color=red:t=fill`, '-pix_fmt', 'yuv420p', green]);
  gen(['-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-frames:v', '1', white]);
  gen(['-f', 'lavfi', '-i', `color=c=0x808080:s=${W}x${H}`, '-frames:v', '1', gray]);
  gen(['-f', 'lavfi', '-i', `color=c=black@0:s=${W}x${H},format=rgba,geq=r=255:g=255:b=255:a='if(lt(hypot(X-${W / 2},Y-${H / 2}),100),255,0)'`, '-frames:v', '1', mask]);

  const media = [];
  for (const [id, p] of [['g', green], ['w', white], ['k', gray]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const project = {
    name: 'layers', width: W, height: H, fps: 30, background: '#203040', media,
    videoClips: [
      { ...base, id: 'key', mediaId: 'g', in: 0, out: 2, chroma: { on: true, color: '#00ff00', intensity: 30, feather: 10, spill: 50 }, transform: { scale: 0.5, x: 0.25 } },
      { ...base, id: 'msk', mediaId: 'w', in: 0, out: 2, mask: { type: 'circle' } },
      { ...base, id: 'mul', mediaId: 'k', in: 0, out: 2, blend: 'multiply' },
    ],
    // White photo at quarter size, 1.5 s to 3.5 s, moved left: x 0.3 * 640 = 192 px left of center.
    overlayClips: [{ ...base, id: 'pip', mediaId: 'w', start: 1.5, in: 0, out: 2, transform: { scale: 0.25, x: -0.3 } }],
    maskImages: { msk: `data:image/png;base64,${fs.readFileSync(mask).toString('base64')}` },
    textClips: [], audioClips: [], stickerClips: [],
  };
  const out = path.join(dir, 'out.mp4');
  await runExport(project, out, () => {}).promise;

  const frameAt = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const px = (buf, x, y) => [...buf.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
  const near = (a, b, tol, what) => {
    if (a.some((v, i) => Math.abs(v - b[i]) > tol)) throw new Error(`${what}: got ${a} expected ~${b}`);
  };
  const bg = [0x20, 0x30, 0x40];

  // Keyed and moved: the red box (center 320,180 in the source) lands at 320 + 160 = 480 after scale 0.5 and x 0.25.
  let f = frameAt(1);
  near(px(f, 480, 180), [255, 0, 0], 40, 'keyed red box');
  near(px(f, 100, 180), bg, 12, 'green keyed out');
  near(px(f, 320, 40), bg, 12, 'outside the scaled picture');
  // Overlay: not yet on screen at 1 s, on screen at 2 s (center 128,180), gone at 4 s.
  near(px(f, 128, 180), bg, 12, 'overlay not on screen yet');
  near(px(frameAt(2), 128, 180), [255, 255, 255], 12, 'overlay on screen');
  near(px(frameAt(2), 128, 60), bg, 12, 'outside the overlay');
  near(px(frameAt(3.7), 128, 180), bg, 12, 'overlay gone');
  // Circle mask: white inside, background outside.
  f = frameAt(3);
  near(px(f, 320, 180), [255, 255, 255], 12, 'inside the mask');
  near(px(f, 128, 180), [255, 255, 255], 12, 'overlay still on screen at 3 s');
  near(px(f, 40, 40), bg, 12, 'outside the mask');
  // Multiply: 50% gray halves the background.
  f = frameAt(5);
  near(px(f, 320, 180), bg.map((v) => Math.round((v * 128) / 255)), 8, 'multiply blend');

  console.log('LAYERS OK');
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
