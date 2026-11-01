// Batch 2 (W2/W3) export proof: drives the real app (FVE_SMOKE_MODE=tplmotion) to apply
// the 'Smooth Slide' template through the Templates UI and export; then pixel-checks the
// exported MP4 — the title's text centroid must start low and rise into place (the slide
// survives export), and the 'Impact Pop' caption must show its violet highlight.
// Usage: node scripts/test-tplmotion-export.cjs   (uses xvfb-run when headless)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-tplmotion-'));
  // First-run surfaces are not this suite's subject (W6 moved the tour to first project
  // entry, where it races this harness): seed the persisted flags as already-seen.
  fs.mkdirSync(path.join(dir, 'settings-test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings-test', 'settings.json'), JSON.stringify({ firstRun: { tourSeen: true, packPromptSeen: true } }));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const bg = path.join(dir, 'bg.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=black:size=${W}x${H}:rate=30:duration=3`, '-pix_fmt', 'yuv420p', bg]);
  const info = await probe(bg);
  const words = 'MADE WITH CLIPCRAFT TODAY'.split(' ').map((w, i) => ({ text: w, start: i * 0.6, end: (i + 1) * 0.6 }));
  const project = {
    name: 'tplmotion', ratio: '16:9', resolution: 720, width: W, height: H, fps: 30, background: '#000000',
    media: [{ id: 'm1', path: bg, name: 'bg.mp4', ...info }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [],
    textClips: [
      { id: 't1', text: 'SMOOTH SLIDE', start: 0, duration: 3, x: 0.5, y: 0.42, size: 72 },
      { id: 'c1', text: 'MADE WITH CLIPCRAFT TODAY', caption: true, words, start: 0, duration: 2.4, y: 0.85, size: 40, template: 'cap-hormozi' },
    ],
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
    env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'tplmotion' },
  });
  const code = await new Promise((resolve) => {
    const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 300000);
    child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
  });
  assert(code === 0, `app exited with ${code}`);

  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert(!result.error, `smoke error: ${result.error}`);
  assert(result.chips && result.chips.includes('Motion') && result.chips.includes('Craft') && !result.chips.includes('Material'),
    `chips are the redesigned rows (got ${JSON.stringify(result.chips)})`);
  assert(['Slide Up', 'Smooth Slide', 'Slide Down', 'Smooth Left', 'Smooth Right', 'Rise & Fade', 'Slide Blur'].every((n) => (result.motionNames || []).includes(n)),
    `Motion row carries all 7 slide templates (got ${JSON.stringify(result.motionNames)})`);
  assert(result.template === 'mot-smooth-slide', `title template applied (got ${result.template})`);
  assert(result.animIn && result.animIn.id === 'slideUpSmooth' && Math.abs(result.animIn.dur - 0.65) < 1e-9,
    `animIn is slideUpSmooth@0.65 (got ${JSON.stringify(result.animIn)})`);
  assert(result.caption && result.caption.highlight && result.caption.highlight.color === '#a78bfa',
    `caption filled with the Impact Pop highlight (got ${JSON.stringify(result.caption && result.caption.highlight)})`);
  assert(/complete/i.test(result.exportStatus || ''), `export completed (got "${result.exportStatus}")`);
  console.log(`ui ok (chips ${result.chips.join('/')}; template ${result.template} in=${result.animIn.id}@${result.animIn.dur}s)`);

  const out = path.join(dir, 'ui-export.mp4');
  const meta = await probe(out);
  assert(meta.hasVideo && Math.abs(meta.duration - 3) < 0.35, `export is a ~3s video (got ${JSON.stringify(meta)})`);
  const frameAt = (t, fmt) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', fmt, '-']);
  // Title zone only (rows above the caption band) so the caption cannot skew the centroid.
  const centroid = (buf, thr) => {
    let sy = 0; let n = 0;
    for (let y = 0; y < 230; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] > thr) { sy += y; n++; }
    return { cy: n ? sy / n : -1, n };
  };
  const early = centroid(frameAt(0.12, 'gray'), 40); // p≈0.18 of the 0.65 s smooth slide
  const mid = centroid(frameAt(0.38, 'gray'), 40); // p≈0.58
  const rest = centroid(frameAt(1.6, 'gray'), 40); // entrance finished
  assert(rest.n > 300, `title fully visible at rest (${rest.n} bright px)`);
  assert(mid.n > 150, `title visible mid-animation (${mid.n} bright px)`);
  assert(early.cy > mid.cy + 6, `title starts lower and rises: cy ${early.cy.toFixed(1)} -> ${mid.cy.toFixed(1)}`);
  assert(mid.cy > rest.cy + 3, `title settles upward into place: cy ${mid.cy.toFixed(1)} -> ${rest.cy.toFixed(1)}`);
  console.log(`W3 export motion ok (centroid y ${early.cy.toFixed(1)} -> ${mid.cy.toFixed(1)} -> ${rest.cy.toFixed(1)})`);
  // Caption highlight: at t=0.3 the first word is active in #a78bfa (167,139,250).
  const rgb = frameAt(0.3, 'rgb24');
  let violet = 0;
  for (let y = 240; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3; const r = rgb[i]; const b = rgb[i + 2];
    if (b > 200 && b > r + 40 && r > 120) violet++;
  }
  assert(violet > 30, `Impact Pop violet highlight present in export (${violet} px)`);
  console.log(`W2 export ok (violet highlight ${violet} px in the caption band)`);
  fs.writeFileSync(path.join(__dirname, '..', '..', 'clipcraft-qa', 'logs', 'tplmotion-export.json'), JSON.stringify({ result, early, mid, rest, violet }, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
