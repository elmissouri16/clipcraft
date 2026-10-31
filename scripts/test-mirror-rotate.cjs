// Item 12 proofs A: Mirror / Rotate export parity through the REAL export path.
// An asymmetric still (red left half, blue right half, white square top-left) as a main-track
// image clip, exported plain / mirrored / rotated. The exported frames must show the geometry
// actually transformed: mirror swaps the red side; rotation moves the white square's quadrant.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-mirror-'));
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

// Asymmetric test card: 640x360, left half red, right half blue, white square top-left.
const img = path.join(dir, 'card.png');
execFileSync('python3', ['-c', `
from PIL import Image
im = Image.new('RGB', (640, 360), (0, 0, 255))
for x in range(320):
    for y in range(360):
        im.putpixel((x, y), (255, 0, 0))
for x in range(40, 140):
    for y in range(30, 130):
        im.putpixel((x, y), (255, 255, 255))
im.save('${img}')
`]);

function frameAt(file, t) {
  return execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
}
// Region means for a 640x360 rgb24 frame.
function regions(buf) {
  const W = 640, H = 360;
  const mean = (x0, x1, y0, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
      const i = (y * W + x) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
    }
    return [r / n, g / n, b / n];
  };
  return {
    left: mean(20, 300, 160, 340), right: mean(340, 620, 160, 340),
    topLeft: mean(40, 140, 30, 130), topRight: mean(500, 600, 30, 130),
    bottomLeft: mean(40, 140, 230, 330), bottomRight: mean(500, 600, 230, 330),
  };
}
const bright = (rgb) => rgb[0] + rgb[1] + rgb[2];

const media = [{ id: 'm1', path: img, type: 'image', duration: 4, width: 640, height: 360 }];
const base = { speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, transform: { scale: 1, x: 0, y: 0, rot: 0, uniform: true, scaleX: 1, scaleY: 1 }, opacity: 1 };
async function exportVariant(name, clipPatch) {
  const project = {
    name, ratio: '16:9', resolution: 720, width: 640, height: 360, fps: 30, background: '#101010', media,
    videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2, ...clipPatch }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  };
  const out = path.join(dir, `${name}.mp4`);
  const job = runExport(project, out, () => {});
  await job.promise;
  return regions(frameAt(out, 1));
}

(async () => {
  const plain = await exportVariant('plain', {});
  ok(plain.left[0] > 180 && plain.left[2] < 90, `plain: left half is red (r=${plain.left[0].toFixed(0)}, b=${plain.left[2].toFixed(0)})`);
  ok(plain.right[2] > 180 && plain.right[0] < 90, `plain: right half is blue (r=${plain.right[0].toFixed(0)}, b=${plain.right[2].toFixed(0)})`);
  ok(bright(plain.topLeft) > 500, `plain: white square sits top-left (brightness ${bright(plain.topLeft).toFixed(0)})`);

  const mir = await exportVariant('mirror', { effects: ['mirror'] });
  ok(mir.left[2] > 180 && mir.left[0] < 90, `mirror: left half is now BLUE (r=${mir.left[0].toFixed(0)}, b=${mir.left[2].toFixed(0)})`);
  ok(mir.right[0] > 180 && mir.right[2] < 90, `mirror: right half is now RED (r=${mir.right[0].toFixed(0)}, b=${mir.right[2].toFixed(0)})`);
  ok(bright(mir.topRight) > 500 && bright(mir.topLeft) < 300, `mirror: white square moved to top-right (${bright(mir.topRight).toFixed(0)} vs ${bright(mir.topLeft).toFixed(0)})`);

  // Rotate: a half-scale clip (the whole rotated picture stays inside the canvas, unlike a
  // full-bleed layer whose corners a quarter turn necessarily crops — the preview's CSS does
  // the same). The white square starts in the clip's top-left; a quarter turn must move its
  // centroid to an ADJACENT quadrant of the frame (top-right or bottom-left), never opposite.
  await exportVariant('rot90', { transform: { scale: 0.5, x: 0, y: 0, rot: 90, uniform: true, scaleX: 1, scaleY: 1 } });
  await exportVariant('norot', { transform: { scale: 0.5, x: 0, y: 0, rot: 0, uniform: true, scaleX: 1, scaleY: 1 } });
  const centroid = (buf) => {
    const W = 640, H = 360;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (buf[i] > 200 && buf[i + 1] > 200 && buf[i + 2] > 200) { sx += x; sy += y; n++; }
    }
    return n ? { x: sx / n, y: sy / n, n } : null;
  };
  const c0 = centroid(frameAt(path.join(dir, 'norot.mp4'), 1));
  const c1 = centroid(frameAt(path.join(dir, 'rot90.mp4'), 1));
  ok(c0 && c0.n > 300 && c0.x < 320 && c0.y < 180, `no-rotate control: square centroid top-left (${c0 && c0.x.toFixed(0)}, ${c0 && c0.y.toFixed(0)})`);
  ok(c1 && c1.n > 300, `rotate 90: white square still in frame (${c1 && c1.n} white px)`);
  if (c1) {
    const adjacent = (c1.x >= 320 && c1.y < 180) || (c1.x < 320 && c1.y >= 180);
    const opposite = c1.x >= 320 && c1.y >= 180;
    ok(adjacent && !opposite, `rotate 90: square moved to an adjacent quadrant (centroid ${c1.x.toFixed(0)}, ${c1.y.toFixed(0)})`);
  }

  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
