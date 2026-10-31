// Smooth text animations export parity: drives the real app (FVE_SMOKE_MODE=textsmooth) and measures
// the exported MP4 — (1) Chars Slide Up staggers left-to-right (bright centroid-x grows mid-intro),
// (2) Decode genuinely cycles glyphs (adjacent mid-decode frames differ strongly; rest frames are
// identical), (3) Settle Up overshoots ABOVE its rest position mid-animation. Plus the Animation
// browser must lead with the Smooth category. Usage: node scripts/test-textsmooth-export.cjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-textsmooth-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const bg = path.join(dir, 'bg.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=black:size=${W}x${H}:rate=30:duration=9`, '-pix_fmt', 'yuv420p', bg]);
  const info = await probe(bg);
  const project = {
    name: 'textsmooth', ratio: '16:9', resolution: 720, width: W, height: H, fps: 30, background: '#000000',
    media: [{ id: 'm1', path: bg, name: 'bg.mp4', ...info }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 9, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [],
    textClips: [
      { id: 't1', text: 'STAGGER', start: 0, duration: 3, x: 0.5, y: 0.5, size: 64 },
      { id: 't2', text: 'DECODE', start: 3, duration: 3, x: 0.5, y: 0.5, size: 64, animIn: { id: 'decode', dur: 1, unit: 'whole' } },
      { id: 't3', text: 'SETTLE', start: 6, duration: 3, x: 0.5, y: 0.5, size: 64, animIn: { id: 'settleUp', dur: 0.8, unit: 'whole' } },
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
    env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'textsmooth' },
  });
  const code = await new Promise((resolve) => {
    const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 300000);
    child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
  });
  assert(code === 0, `app exited with ${code}`);

  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert(!result.error, `smoke error: ${result.error}`);
  assert(result.headers && result.headers[0] === 'Smooth', `Animation browser leads with Smooth (got ${JSON.stringify(result.headers)})`);
  assert(result.animIn?.id === 'charSlideUp', `tile applied Chars Slide Up (got ${JSON.stringify(result.animIn)})`);
  assert(/complete/i.test(result.exportStatus || ''), `export completed (got "${result.exportStatus}")`);
  console.log(`ui ok (categories: ${result.headers.join(' | ')}; in=${result.animIn.id})`);

  const out = path.join(dir, 'ui-export.mp4');
  const meta = await probe(out);
  assert(meta.hasVideo && Math.abs(meta.duration - 9) < 0.4, `export is a ~9s video (got ${JSON.stringify(meta)})`);
  const frameAt = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const stats = (buf, thr = 40) => {
    let sx = 0; let sy = 0; let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] > thr) { sx += x; sy += y; n++; }
    return { cx: n ? sx / n : -1, cy: n ? sy / n : -1, n };
  };
  const meanDiff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };

  // (1) Chars Slide Up (dur 0.9 from t=0): the bright mass moves right as later chars join.
  const sEarly = stats(frameAt(0.18));
  const sMid = stats(frameAt(0.5));
  assert(sEarly.n > 50 && sMid.n > sEarly.n, `stagger reveals progressively (${sEarly.n} -> ${sMid.n} bright px)`);
  assert(sMid.cx > sEarly.cx + 12, `bright centroid moves right as the stagger proceeds (${sEarly.cx.toFixed(1)} -> ${sMid.cx.toFixed(1)})`);
  console.log(`chars slide up ok (n ${sEarly.n}->${sMid.n}, cx ${sEarly.cx.toFixed(1)}->${sMid.cx.toFixed(1)})`);

  // (2) Decode (t=3..4): adjacent mid-decode frames differ strongly; rest frames are identical.
  // Diffs are measured inside the locked-in text's bounding box — the rest of the frame is black
  // background and would only dilute the number.
  const dA = frameAt(3.3);
  const dB = frameAt(3.38);
  const rA = frameAt(5.4);
  const rB = frameAt(5.48);
  let bx0 = W; let bx1 = 0; let by0 = H; let by1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rA[y * W + x] > 40) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const regionDiff = (a, b) => {
    let s = 0; let n = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { s += Math.abs(a[y * W + x] - b[y * W + x]); n++; }
    return s / Math.max(1, n);
  };
  const cyc = regionDiff(dA, dB);
  const rest = regionDiff(rA, rB);
  const vsRest = regionDiff(dA, rA);
  assert(cyc > 6, `mid-decode frames cycle glyphs (bbox mean diff ${cyc.toFixed(2)})`);
  assert(rest < 1.5, `rest frames are stable (bbox mean diff ${rest.toFixed(2)})`);
  assert(vsRest > 6, `decode frame differs from the locked-in text (bbox mean diff ${vsRest.toFixed(2)})`);
  console.log(`decode ok (cycling diff ${cyc.toFixed(2)}, rest diff ${rest.toFixed(2)})`);

  // (3) Settle Up (t=6, dur 0.8): early below rest, mid ABOVE rest (the overshoot), then rest.
  const restS = stats(frameAt(8.5));
  const earlyS = stats(frameAt(6.14));
  const midS = stats(frameAt(6.45));
  assert(earlyS.cy > restS.cy + 4, `settle starts below rest (cy ${earlyS.cy.toFixed(1)} vs rest ${restS.cy.toFixed(1)})`);
  assert(midS.cy < restS.cy - 1.5, `settle overshoots above rest mid-animation (cy ${midS.cy.toFixed(1)} vs rest ${restS.cy.toFixed(1)})`);
  console.log(`settle up ok (cy early ${earlyS.cy.toFixed(1)} > rest ${restS.cy.toFixed(1)} > mid ${midS.cy.toFixed(1)})`);

  console.log('TEXTSMOOTH EXPORT OK');
})().catch((e) => { console.error('TEXTSMOOTH EXPORT FAIL:', e.message); process.exitCode = 1; });
