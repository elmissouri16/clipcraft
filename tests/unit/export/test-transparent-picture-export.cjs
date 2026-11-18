// A transparent picture on the main track (PNG/WebP logo, sticker) exports over the project background, as the
// preview shows it, at the same fitted size an opaque picture gets. Usage: node tests/unit/export/test-transparent-picture-export.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-alpha-export-'));
(async () => {
  try {
    const px = (file, x, y) => { const raw = execFileSync(ff.ffmpegPath, ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 22 }); const o = (y * 640 + x) * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 8);
    // 320x180, fully transparent except an opaque red 100x100 square in the middle; its hidden colour is black.
    const sources = { png: path.join(dir, 'logo.png'), webp: path.join(dir, 'logo.webp') };
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=320x180,format=rgba', '-vf', "geq=r='if(between(X,110,209)*between(Y,40,139),255,0)':g=0:b=0:a='if(between(X,110,209)*between(Y,40,139),255,0)'", '-frames:v', '1', sources.png]);
    try { execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-i', sources.png, '-c:v', 'libwebp', '-lossless', '1', sources.webp]); } catch { delete sources.webp; }
    for (const [kind, file] of Object.entries(sources)) {
      const info = await ff.probe(file), out = path.join(dir, `${kind}.mp4`);
      const project = { width: 640, height: 360, fps: 10, background: '#ffffff', media: [{ id: 'p', path: file, ...info }], videoClips: [{ id: 'c', mediaId: 'p', in: 0, out: 1 }], overlayClips: [], audioClips: [], textClips: [] };
      execFileSync(ff.ffmpegPath, ff.buildExportArgs(project, out, { encoder: 'libx264' }).args.filter((a) => a !== '-progress' && a !== 'pipe:1'), { stdio: ['ignore', 'ignore', 'pipe'] });
      assert.ok(near(px(out, 5, 5), [255, 255, 255]), `${kind}: a transparent corner shows the background (${px(out, 5, 5)})`);
      assert.ok(near(px(out, 320, 180), [255, 0, 0]), `${kind}: the opaque square stays red (${px(out, 320, 180)})`);
      // Fitted 2x into 640x360: the square spans x 220..419, so x 215 is background and x 225 is red.
      assert.ok(near(px(out, 215, 180), [255, 255, 255]) && near(px(out, 225, 180), [255, 0, 0]), `${kind}: same fit as an opaque picture`);
    }
    console.log(`transparent pictures export over the project background (${Object.keys(sources).join(', ')})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
