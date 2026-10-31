// Text Animations WORD-BY-WORD export parity: drives the real app (FVE_SMOKE_MODE=textanimword) to
// apply Slide Up to "HELLO WORLD" and switch its unit to Word by word through the real inspector UI,
// exports, then checks the exported MP4 frame by frame. With a 0.5 s entrance, a 0.62 stagger window
// and two words, word 2 starts at p = 0.38 (t = 0.19 s): at t = 0.10 word 1 must be on screen mid-rise
// while word 2 is nowhere; at t = 0.30 word 2 must be present but still below its resting line; at
// rest both sit on the same line. That is only possible if the stagger reached the export, not just
// the panel. Usage: node scripts/test-textanim-word-export.cjs   (uses xvfb-run when headless)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-textanimword-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const bg = path.join(dir, 'bg.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=black:size=${W}x${H}:rate=30:duration=4`, '-pix_fmt', 'yuv420p', bg]);
  const info = await probe(bg);
  const project = {
    name: 'textanimword', ratio: '16:9', resolution: 720, width: W, height: H, fps: 30, background: '#000000',
    media: [{ id: 'm1', path: bg, name: 'bg.mp4', ...info }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [],
    // Size 60: at 72 the phrase is wider than the layout's maxWidth and wraps to two lines.
    textClips: [{ id: 't1', text: 'HELLO WORLD', start: 0, duration: 4, x: 0.5, y: 0.5, size: 60 }],
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
    env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'textanimword' },
  });
  const code = await new Promise((resolve) => {
    const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 300000);
    child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
  });
  assert(code === 0, `app exited with ${code}`);

  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert(!result.error, `smoke error: ${result.error}`);
  assert(result.unitButtons === 3, `unit control shows Whole / Word by word / Letters (got ${result.unitButtons})`);
  assert(result.animIn?.id === 'slideUp' && result.animIn?.unit === 'word' && Math.abs(result.animIn.dur - 0.5) < 1e-9,
    `tile + unit stored on the clip (got ${JSON.stringify(result.animIn)})`);
  assert(/complete/i.test(result.exportStatus || ''), `export completed (got "${result.exportStatus}")`);
  console.log(`ui ok (unit buttons ${result.unitButtons}, animIn=${JSON.stringify(result.animIn)})`);

  const out = path.join(dir, 'ui-export.mp4');
  const meta = await probe(out);
  assert(meta.hasVideo && Math.abs(meta.duration - 4) < 0.35, `export is a ~4s video (got ${JSON.stringify(meta)})`);
  const frameAt = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  // Ink inside a horizontal band [x0, x1): bright-pixel count and mean y. The two bands sit under
  // HELLO and WORLD with a dead zone over the space, so font metrics cannot leak one word into the
  // other's band.
  const band = (buf, x0, x1, thr) => {
    let sy = 0; let n = 0;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (buf[y * W + x] > thr) { sy += y; n++; }
    return { cy: n ? sy / n : -1, n };
  };
  const L = [60, 270];
  const R = [330, 580];
  const early = frameAt(0.1); // p=0.20: word 1 local 0.32 (rising, ~26 px low), word 2 local 0 (absent)
  const mid = frameAt(0.3); // p=0.60: word 1 at rest, word 2 local 0.35 (present, ~22 px low)
  const rest = frameAt(2);
  const eL = band(early, ...L, 40); const eR = band(early, ...R, 40);
  const mR = band(mid, ...R, 40);
  const rL = band(rest, ...L, 40); const rR = band(rest, ...R, 40);
  assert(eL.n > 150, `word 1 visible early (${eL.n} bright px in its band)`);
  assert(eR.n < 30, `word 2 not yet on screen early (${eR.n} bright px in its band)`);
  assert(eL.cy > rL.cy + 8, `word 1 still rising early: cy ${eL.cy.toFixed(1)} vs rest ${rL.cy.toFixed(1)}`);
  assert(mR.n > 300, `word 2 visible mid-animation (${mR.n} bright px)`);
  assert(mR.cy > rR.cy + 8, `word 2 still settling mid-animation: cy ${mR.cy.toFixed(1)} vs rest ${rR.cy.toFixed(1)}`);
  assert(rL.n > 300 && rR.n > 300, `both words at rest (left ${rL.n}, right ${rR.n} bright px)`);
  console.log(`export parity ok (early: left ${eL.n}px@cy${eL.cy.toFixed(1)}, right ${eR.n}px; mid right cy ${mR.cy.toFixed(1)} -> rest ${rR.cy.toFixed(1)}; export ${meta.duration.toFixed(2)}s ${meta.width}x${meta.height})`);
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
