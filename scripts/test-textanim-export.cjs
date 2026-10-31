// Text Animations export parity: drives the real app (FVE_SMOKE_MODE=textanim) to apply Slide Up Smooth
// through the new browser UI and export; then checks the exported MP4 frame by frame — the text must
// start below its resting position and rise into place, which proves the preset is real in the export,
// not just in the panel. Usage: node scripts/test-textanim-export.cjs   (uses xvfb-run when headless)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const root = path.join(__dirname, '..');
const W = 640;
const H = 360;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-textanim-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const bg = path.join(dir, 'bg.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=black:size=${W}x${H}:rate=30:duration=3`, '-pix_fmt', 'yuv420p', bg]);
  const info = await probe(bg);
  const project = {
    name: 'textanim', ratio: '16:9', resolution: 720, width: W, height: H, fps: 30, background: '#000000',
    media: [{ id: 'm1', path: bg, name: 'bg.mp4', ...info }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [],
    textClips: [{ id: 't1', text: 'SMOOTH RISE', start: 0, duration: 3, x: 0.5, y: 0.5, size: 72 }],
    audioClips: [], stickerClips: [], effectClips: [],
  };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));

  const electronBin = process.env.ELECTRON_BIN
    || [path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
      path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
  assert(electronBin, 'electron binary not found (set ELECTRON_BIN)');
  const useXvfb = !process.env.DISPLAY && fs.existsSync('/usr/bin/xvfb-run');
  const cmd = useXvfb ? 'xvfb-run' : electronBin;
  const args = useXvfb ? ['-a', electronBin, '--no-sandbox', '.'] : ['--no-sandbox', '.'];
  const child = spawn(cmd, args, {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'textanim' },
  });
  const code = await new Promise((resolve) => {
    const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 300000);
    child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
  });
  assert(code === 0, `app exited with ${code}`);

  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert(!result.error, `smoke error: ${result.error}`);
  assert(result.categories >= 8, `browser shows the category folders (got ${result.categories})`);
  assert(result.tiles >= 30, `browser shows the In preset tiles (got ${result.tiles})`);
  assert(result.outTiles >= 30, `browser shows the Out preset tiles (got ${result.outTiles})`);
  assert(result.animIn?.id === 'slideUpSmooth' && Math.abs(result.animIn.dur - 0.7) < 1e-9,
    `tile applied Slide Up Smooth with its duration (got ${JSON.stringify(result.animIn)})`);
  assert(result.animOut?.id === 'fade', `Out tile applied Fade Out (got ${JSON.stringify(result.animOut)})`);
  assert(/complete/i.test(result.exportStatus || ''), `export completed (got "${result.exportStatus}")`);
  console.log(`ui ok (${result.categories} categories, ${result.tiles}+${result.outTiles} tiles, in=${result.animIn.id}@${result.animIn.dur}s, out=${result.animOut.id})`);

  const out = path.join(dir, 'ui-export.mp4');
  const meta = await probe(out);
  assert(meta.hasVideo && Math.abs(meta.duration - 3) < 0.35, `export is a ~3s video (got ${JSON.stringify(meta)})`);
  const frameAt = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const centroid = (buf, thr) => {
    let sy = 0; let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] > thr) { sy += y; n++; }
    return { cy: n ? sy / n : -1, n };
  };
  const early = centroid(frameAt(0.15), 40); // p≈0.21: gliding, still ~65 px below rest, alpha ≈ 0.34
  const mid = centroid(frameAt(0.45), 40); // p≈0.64: most of the way up
  const rest = centroid(frameAt(1.6), 40); // entrance finished at 0.7 s
  assert(rest.n > 400, `text fully visible at rest (${rest.n} bright px)`);
  assert(mid.n > 200, `text visible mid-animation (${mid.n} bright px)`);
  assert(early.cy > mid.cy + 12, `text starts lower and rises: cy ${early.cy.toFixed(1)} -> ${mid.cy.toFixed(1)}`);
  assert(mid.cy > rest.cy + 6, `text settles upward into place: cy ${mid.cy.toFixed(1)} -> ${rest.cy.toFixed(1)}`);
  console.log(`export parity ok (centroid y ${early.cy.toFixed(1)} -> ${mid.cy.toFixed(1)} -> ${rest.cy.toFixed(1)}, export ${meta.duration.toFixed(2)}s ${meta.width}x${meta.height})`);
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
