// Generates sample media with FFmpeg, then exports a project using every feature through the real pipeline.
// Usage: node scripts/test-export.cjs [outDir]   (outDir keeps the media + project.json for UI smoke tests)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

(async () => {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'fve-test-'));
  fs.mkdirSync(dir, { recursive: true });
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const a = path.join(dir, 'a.mp4');
  const b = path.join(dir, 'b no audio.mp4');
  const img = path.join(dir, 'photo.png');
  const music = path.join(dir, 'music.mp3');
  const sticker = path.join(dir, 'sticker.png');
  gen(['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', a]);
  gen(['-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=25:duration=4', b]);
  gen(['-f', 'lavfi', '-i', 'mandelbrot=size=800x800', '-frames:v', '1', img]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=10', music]);
  gen(['-f', 'lavfi', '-i', 'color=c=red@0.8:size=200x200,format=rgba', '-frames:v', '1', sticker]);

  const media = [];
  for (const [id, p] of [['m1', a], ['m2', b], ['m3', music], ['m4', img], ['m5', sticker]]) {
    const info = await probe(p);
    media.push({ id, path: p, name: path.basename(p), ...info });
  }
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const project = {
    name: 'test', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#101010', media,
    videoClips: [
      { ...base, id: 'c1', mediaId: 'm1', in: 1, out: 3, speed: 2, filter: 'vivid' },
      { ...base, id: 'c2', mediaId: 'm2', in: 0, out: 2.5, transition: { type: 'fade', duration: 0.5 }, effects: ['vignette', 'mirror'] },
      { ...base, id: 'c3', mediaId: 'm4', in: 0, out: 2, transition: { type: 'fadeblack', duration: 0.5 }, adjust: { brightness: 0.2, blur: 2 } },
      { id: 'gap1', gap: true, in: 0, out: 1, speed: 1 }, // 1 s gap on the main track
      { ...base, id: 'c4', mediaId: 'm1', in: 3, out: 4, filter: 'bw', effects: ['grain'] },
    ],
    // Picture in picture with sound at 1.5x, keyed and rotated.
    overlayClips: [
      { ...base, id: 'o1', mediaId: 'm1', start: 2, in: 0, out: 3, speed: 1.5, transform: { scale: 0.4, x: -0.25, y: -0.2, rot: 10 },
        chroma: { on: true, color: '#00ff00', intensity: 20, feather: 20, spill: 30 }, blend: 'screen', opacity: 0.8 },
    ],
    // Text is rendered by the UI (canvas) and covered by the FVE_SMOKE_MODE=text UI test.
    textClips: [],
    audioClips: [{ id: 'a1', mediaId: 'm3', start: 1, in: 0, out: 4, volume: 0.5, fadeIn: 1, fadeOut: 1 }],
    // (R1, 2026-11-01: the fixture's sticker clip was removed with the Stickers feature.)
  };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  const out = path.join(dir, 'out.mp4');
  const job = runExport(project, out, (p) => process.stdout.write(`\rprogress ${(p * 100).toFixed(0)}%`));
  await job.promise;
  const info = await probe(out);
  console.log('\n', out, info);
  if (Math.abs(info.duration - 6.5) > 0.2 || !info.hasAudio || info.width !== 1280) throw new Error('Unexpected output');
  console.log('EXPORT OK');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
