// Motion tracking: matcher core, the pin/path math, the engine against a ground-truth fixture, and the
// full app flow (pick -> track -> pin -> export) measured in the exported frames.
// Usage: node scripts/test-tracking.cjs    (the app part needs the Electron binary + xvfb like the
// other smoke suites; set SKIP_APP=1 to run only the engine/unit parts.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');
const { makeTemplate, matchTemplate, trackMotion } = require('../electron/track.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)}, expected ${b.toFixed(3)} ±${tol}`);

// The fixture's scripted target path (center, source pixels at 1920x1080): linear in x, a smooth
// sine in y, briefly covered by a black occluder at t in [2.5, 2.9].
const CX = (t) => 245 + 150 * t;
const CY = (t) => 545 + 180 * Math.sin(0.9 * t);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-tracking-'));
  // First-run surfaces are not this suite's subject (W6 moved the tour to first project
  // entry, where it races this harness): seed the persisted flags as already-seen.
  fs.mkdirSync(path.join(dir, 'settings-test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings-test', 'settings.json'), JSON.stringify({ firstRun: { tourSeen: true, packPromptSeen: true } }));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

  // ---------- 1) The matcher on synthetic frame sequences (known shifts) ----------
  {
    const W = 160;
    const H = 120;
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    // One rigid texture (value noise at two scales + a distinct bright block), shifted per frame.
    const tex = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tex[y * W + x] = 90 + 60 * Math.sin(x * 0.31 + y * 0.17) + 40 * rnd();
    for (let y = 44; y < 68; y++) for (let x = 48; x < 72; x++) tex[y * W + x] = 235;
    const frame = (dx, dy) => {
      const f = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = Math.min(W - 1, Math.max(0, x - dx));
        const sy = Math.min(H - 1, Math.max(0, y - dy));
        f[y * W + x] = tex[sy * W + sx];
      }
      return f;
    };
    const f0 = frame(0, 0);
    const tpl = makeTemplate(f0, W, H, 60, 56, 32, 32); // centered on the bright block (48..72, 44..68)
    for (const [dx, dy] of [[0, 0], [5, -3], [-7, 4], [11, 9]]) {
      const m = matchTemplate(frame(dx, dy), W, H, tpl, 60, 56, 14);
      ok(Math.hypot(m.x - (60 + dx), m.y - (56 + dy)) <= 1.0 && m.score > 0.9,
        `matcher recovers shift (${dx},${dy}): got (${m.x.toFixed(2)},${m.y.toFixed(2)}) score ${m.score.toFixed(3)}`);
    }
  }

  // ---------- 2) Path / pin math + dangling-pin cleanup (src/track.js through the real store) ----------
  const T = await import('../src/track.js');
  const S = await import('../src/store.js');
  {
    const track = { points: [{ t: 0, x: 0.2, y: 0.5, c: 1 }, { t: 2, x: 0.6, y: 0.5, c: 1 }], box: { w: 0.06, h: 0.11 }, fps: 30 };
    near(T.trackAt(track, 1).x, 0.4, 1e-9, 'trackAt interpolates');
    near(T.trackAt(track, 9).x, 0.6, 1e-9, 'trackAt clamps at the end');
    const media = [{ id: 'm1', width: 1280, height: 720 }];
    const src = { id: 'v1', mediaId: 'm1', in: 0, out: 6, speed: 1 };
    const fol = { id: 't1', start: 1, duration: 3, pin: { to: 'v1' } };
    const project = {
      ...S.emptyProject(), width: 1280, height: 720, fps: 30, media,
      videoClips: [{ ...src, track }], overlayClips: [], textClips: [fol], audioClips: [],
    };
    near(T.pinOffsetAt(project, { track: 'text', clip: fol }, 1).dx, 0, 1e-9, 'pin offset is zero at the follower start');
    near(T.pinOffsetAt(project, { track: 'text', clip: fol }, 2).dx, 0.2, 1e-9, 'pin offset follows the path');
    near(T.pinOffsetAt(project, { track: 'text', clip: fol }, 3).dx, 0.2, 1e-9, 'pin offset holds past the path end');
    // Unpinned equivalence: motionDataPinned must be byte-identical to anim.motionData without pins.
    const A = await import('../src/anim.js');
    const keyed = {
      ...project, textClips: [{ id: 't1', start: 1, duration: 3 }],
      overlayClips: [{ id: 'o1', mediaId: 'm1', start: 0, in: 0, out: 3, speed: 1, keyframes: { x: [{ t: 0, v: 0 }, { t: 2, v: 0.3 }] } }],
    };
    ok(JSON.stringify(T.motionDataPinned(keyed)) === JSON.stringify(A.motionData(keyed)), 'motionDataPinned == motionData for unpinned clips');
    const pinnedMd = T.motionDataPinned({ ...keyed, overlayClips: [{ ...keyed.overlayClips[0], keyframes: undefined, pin: { to: 'v1' } }] });
    ok(pinnedMd.o1 && pinnedMd.o1.x.length > 1, 'a pinned clip with no keyframes of its own still gets motion curves');
    // R1 (2026-11-01): the sticker follower is gone with the Stickers feature; the export-curve
    // proof now rides the pinned OVERLAY follower through motionDataPinned (x ends at base + offset).
    const op = { ...project, overlayClips: [{ id: 'o9', mediaId: 'm1', start: 1, in: 0, out: 3, speed: 1, pin: { to: 'v1' } }] };
    const oc = T.motionDataPinned(op).o9;
    ok(oc && oc.x.length > 1 && oc.x[0][1] === 0 && Math.abs(oc.x[oc.x.length - 1][1] - 0.2) < 1e-6,
      `pinned overlay curves carry the pin offset (${JSON.stringify(oc?.x)})`);
    // Cleanup: removing the tracked clip (through the real reducer) unpins its followers.
    let state = { past: [], present: project, future: [] };
    state = S.historyReducer(state, { type: 'delete', track: 'video', id: 'v1' });
    ok(!state.present.textClips[0].pin, 'deleting the tracked clip unpins its followers (no dangling pin)');
    ok(T.cleanPins(project) === project, 'cleanPins is a no-op (same object) when every pin resolves');
  }

  // ---------- 3) The engine against ground truth ----------
  // The moving square is an overlay (its x/y expressions are evaluated per frame with n; drawbox's
  // are not, in this ffmpeg build — verified empirically). Frame n: center (245 + 5n, 545 + 180 sin
  // (0.03n)) — exactly CX/CY at t = n/30. The occluder covers it for frames 75..87 (t 2.5..2.9).
  const still = path.join(dir, 'still.png');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=0.05', '-frames:v', '1', still]);
  const square = path.join(dir, 'square.png');
  gen(['-f', 'lavfi', '-i', 'color=c=white:size=90x90', '-frames:v', '1', square]);
  const occPng = path.join(dir, 'occ.png');
  gen(['-f', 'lavfi', '-i', 'color=c=black:size=220x220', '-frames:v', '1', occPng]);
  const fixture = path.join(dir, 'target.mp4');
  gen(['-loop', '1', '-framerate', '30', '-i', still,
    '-loop', '1', '-framerate', '30', '-i', square,
    '-loop', '1', '-framerate', '30', '-i', occPng,
    '-filter_complex', `[0][1]overlay=x='200+5*n':y='500+180*sin(0.03*n)':eof_action=pass[sq];[sq][2]overlay=x=540:y=560:eof_action=pass:enable='between(n\\,75\\,87)',format=yuv420p`,
    '-t', '6', '-c:v', 'libx264', '-crf', '16', fixture]);
  const info = await probe(fixture);
  const t0 = Date.now();
  const res = await trackMotion({ path: fixture, duration: info.duration }, {
    from: 0, to: 6, pick: { x: 245 / 1920, y: 545 / 1080 }, box: { w: 100 / 1920, h: 100 / 1080 },
    cacheDir: path.join(dir, 'cache'), ffmpegPath,
  });
  const secs = (Date.now() - t0) / 1000;
  ok(res.raw >= 170 && res.points.length >= 20, `engine returned a path (${res.points.length} points from ${res.raw} frames)`);
  const errAt = (p) => Math.hypot(p.x * 1920 - CX(p.t), p.y * 1080 - CY(p.t));
  const seg = res.points.filter((p) => p.t >= 0.2 && p.t <= 2.4);
  const segMean = seg.reduce((a, p) => a + errAt(p), 0) / seg.length;
  const segMax = Math.max(...seg.map(errAt));
  ok(segMean <= 6, `linear segment mean error ${segMean.toFixed(2)} px at 1080p (budget 6)`);
  ok(segMax <= 15, `linear segment max error ${segMax.toFixed(2)} px (budget 15)`);
  const rest = res.points.filter((p) => p.t < 2.4 || p.t > 3.05);
  const restMean = rest.reduce((a, p) => a + errAt(p), 0) / rest.length;
  console.log(`      whole path (outside occlusion) mean error ${restMean.toFixed(2)} px; tracking speed ${(secs / 6).toFixed(2)} s per second of 1080p`);
  const preOcc = res.points.filter((p) => p.t <= 2.45).pop();
  const occ = res.points.filter((p) => p.t >= 2.55 && p.t <= 2.85);
  ok(occ.length >= 2, `occlusion: the path has points inside the covered window (${occ.length})`);
  const occJump = occ.length ? Math.max(...occ.map((p) => Math.hypot((p.x - preOcc.x) * 1920, (p.y - preOcc.y) * 1080))) : Infinity;
  ok(occJump <= 45, `occlusion: the track holds instead of teleporting (max drift ${occJump.toFixed(1)} px while covered)`);
  ok(occ.some((p) => (p.c ?? 1) < 0.35), 'occlusion: covered points are marked low-confidence');
  const post = res.points.filter((p) => p.t >= 3.1 && p.t <= 3.6);
  const postMean = post.reduce((a, p) => a + errAt(p), 0) / post.length;
  ok(postMean <= 12, `occlusion: the track re-acquires after (mean error ${postMean.toFixed(2)} px)`);

  // ---------- 4) The app flow: pick -> track -> pin -> export, measured in the export ----------
  if (!process.env.SKIP_APP) {
    const mediaInfo = await probe(fixture);
    const project = {
      name: 'tracking', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
      media: [{ id: 'm1', path: fixture, name: 'target.mp4', ...mediaInfo }],
      videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
      overlayClips: [],
      textClips: [{ id: 't1', text: 'TRACKED', start: 1, duration: 4, x: CX(1) / 1920, y: CY(1) / 1080, size: 44, color: '#ff00ff' }],
      audioClips: [],
      effectClips: [],
    };
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
    fs.writeFileSync(path.join(dir, 'pick.json'), JSON.stringify({ x: CX(0.02) / 1920, y: CY(0.02) / 1080 }));

    const root = path.join(__dirname, '..');
    const electronBin = process.env.ELECTRON_BIN
      || [path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
        path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
    ok(!!electronBin, 'electron binary found');
    const useXvfb = !process.env.DISPLAY && fs.existsSync('/usr/bin/xvfb-run');
    const child = spawn(useXvfb ? 'xvfb-run' : electronBin,
      useXvfb ? ['-a', electronBin, '--no-sandbox', '.'] : ['--no-sandbox', '.'],
      { cwd: root, stdio: 'inherit', env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'tracking' } });
    const code = await new Promise((resolve) => {
      const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 600000);
      child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
    });
    ok(code === 0, `app exited cleanly (${code})`);
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    ok(!result.error, `smoke ran (${result.error || 'no error'})`);
    ok(result.trackButton && result.pickMode, 'Track motion opens the pick mode from the inspector');
    ok(result.markerShown, 'the pick marker + template box show on the player');
    ok(result.tracked && result.trackPoints > 20, `the in-app track landed on the clip (${result.trackPoints} points, ${result.lowConf} low-confidence)`);
    ok(result.pinButton && result.pinnedTo === 'v1', 'the text clip pinned through its inspector card');
    // R1 (2026-11-01): the sticker-pin UI assertion was retired with the Stickers feature;
    // the text-follower pin above is the end-to-end pin proof.
    ok(/complete/i.test(result.exportStatus || ''), `export completed (${result.exportStatus || 'no status'})`);
    for (const [srcName, dstName] of [['track-ui.png', 'v32-track-ui.png'], ['track-pick.png', 'v32-track-pick.png']]) {
      const srcP = path.join(dir, srcName);
      if (fs.existsSync(srcP)) fs.copyFileSync(srcP, path.join(os.homedir(), 'workspace', 'clipcraft-shots', dstName));
    }

    // Measure the export: the magenta text's centroid must travel with the target between t=2 and t=4
    // (project is 720p, so the expected travel is the 1080p delta scaled by 2/3). The centroid is
    // taken in a window around the predicted anchor — the testsrc2 background has a magenta bar of
    // its own, and a full-frame centroid belongs to the bar, not the text (measured: a static
    // full-frame centroid while the text demonstrably moved).
    const out = path.join(dir, 'ui-export.mp4');
    const frameRGB = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
    const centroid = (buf, pred, cx, cy, hw, hh) => {
      // Bounds must be integers: a fractional loop variable makes (y * W + x) * 3 a fractional
      // buffer index, which reads undefined and silently matches nothing.
      const x0 = Math.max(0, Math.round(cx - hw));
      const x1 = Math.min(1280, Math.round(cx + hw));
      const y0 = Math.max(0, Math.round(cy - hh));
      const y1 = Math.min(720, Math.round(cy + hh));
      let sx = 0; let sy = 0; let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * 1280 + x) * 3;
        if (pred(buf[i], buf[i + 1], buf[i + 2])) { sx += x; sy += y; n++; }
      }
      return n ? { x: sx / n, y: sy / n, n } : null;
    };
    const magenta = (r, g, b) => r > 170 && g < 120 && b > 170;
    const c2 = centroid(frameRGB(2), magenta, CX(2) * (1280 / 1920), CY(2) * (720 / 1080), 170, 130);
    const c4 = centroid(frameRGB(4), magenta, CX(4) * (1280 / 1920), CY(4) * (720 / 1080), 170, 130);
    ok(c2 && c2.n > 150 && c4 && c4.n > 150, `pinned text visible in the export (${c2?.n || 0} / ${c4?.n || 0} magenta px)`);
    if (c2 && c4) {
      const expDx = (CX(4) - CX(2)) * (1280 / 1920);
      const expDy = (CY(4) - CY(2)) * (720 / 1080);
      near(c4.x - c2.x, expDx, 30, 'exported text travel x matches the target');
      near(c4.y - c2.y, expDy, 30, 'exported text travel y matches the target');
    }
  }

  if (failures) throw new Error(`${failures} tracking check(s) failed`);
  console.log('TRACKING OK');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
