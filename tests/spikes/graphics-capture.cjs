// Motion graphics spike (docs/design/motion-graphics.md, phase 0). Runs inside the real app through
// the smoke dispatcher (FVE_SMOKE_MODE=graphics-spike); launch with
// `node tests/spikes/run-graphics-spike.cjs`. Renders the bar chart fixture
// at 1080x1920 for 5 s through the sandbox with each capture method and measures:
// - speed (ms per frame, window start-up) and peak sandbox memory;
// - transparency at pixels whose value is known (background, bar, 25 % gridline): exact, no fringe;
// - the transparent VP9 preview copy: encode time, alpha kept, Chromium playback with alpha;
// - the real export composite against the expected blend, and bar edge positions;
// - the sandbox: network, Node, the host bridge and an endless loop.
// Evidence: docs/design/motion-graphics-spike.json (or SPIKE_EVIDENCE).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BrowserWindow } = require('electron');
const root = path.join(__dirname, '../..');
const ff = require(path.join(root, 'electron/media/ffmpeg.cjs'));
const { renderGraphic } = require(path.join(root, 'electron/graphics/render.cjs'));

const W = 1080, H = 1920, FPS = 30, FRAMES = 150;
const code = fs.readFileSync(path.join(root, 'tests/fixtures/graphics/barChart.js'), 'utf8');
let dir;
const evidenceFile = process.env.SPIKE_EVIDENCE || path.join(root, 'docs/design/motion-graphics-spike.json');
// Known pixels on the final frame (see the fixture's geometry).
const SAMPLES = { background: [40, 40, [0, 0, 0, 0]], bar: [876, 1200, [232, 179, 74, 255]], gridline: [130, 750, [255, 255, 255, 64]] };
const BG = [29, 53, 87];

// yuv (the export, the VP9 preview) is decoded with the BT.709 matrix it was written with.
const decode = (file, index, { vp9 = false, size = `${W}x${H}`, yuv = false } = {}) => execFileSync(ff.ffmpegPath, ['-v', 'error', ...(vp9 ? ['-c:v', 'libvpx-vp9'] : []), '-i', file,
  '-vf', `select=eq(n\\,${index})${yuv ? ',scale=in_color_matrix=bt709:in_range=tv,format=rgba' : ''}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', size, 'pipe:1'], { maxBuffer: 64 << 20 });
const px = (buf, x, y, w = W) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const timed = (fn) => { const t = Date.now(); const value = fn(); return [value, Date.now() - t]; };
// Top edge of the tallest bar in a column: the first row close to the bar colour (the white value
// label above it does not match), with sub-pixel position from the edge pixel's coverage.
const edge = (buf, x, w = W) => {
  const bar = [232, 179, 74], close = (y) => { const i = (y * w + x) * 4; return Math.abs(buf[i] - bar[0]) + Math.abs(buf[i + 1] - bar[1]) + Math.abs(buf[i + 2] - bar[2]) < 30; };
  for (let y = 300; y < 1600; y++) if (close(y) && close(y + 1) && close(y + 2)) return y;
  return -1;
};

async function main() {
  const evidence = { date: new Date().toISOString(), platform: `${process.platform} ${os.release()} ${os.arch()}`, electron: process.versions.electron, chrome: process.versions.chrome,
    graphic: { width: W, height: H, fps: FPS, frames: FRAMES }, methods: {} };
  // 1. Capture methods.
  // Phase 0 also measured 'capture' and 'paint' (see the evidence file); the renderer now keeps canvas only.
  for (const method of ['canvas']) {
    const out = path.join(dir, method);
    try {
      const { file, stats } = await renderGraphic({ ffmpegPath: ff.ffmpegPath, code, width: W, height: H, fps: FPS, frames: FRAMES, method, dir: out });
      const last = decode(file, FRAMES - 1);
      const samples = Object.fromEntries(Object.entries(SAMPLES).map(([k, [x, y, want]]) => { const got = px(last, x, y); return [k, { got, want, max_error: diff(got, want) }]; }));
      evidence.methods[method] = { ok: true, file, bytes: fs.statSync(file).size, ms_per_frame: +(stats.total_ms / FRAMES).toFixed(1),
        ms_per_frame_after_load: +((stats.total_ms - stats.load_ms) / FRAMES).toFixed(1), ...stats, samples, bar_top_row: edge(last, 876) };
    } catch (error) { evidence.methods[method] = { ok: false, error: error.message }; }
  }
  // Embedded fonts (an SVG image cannot load external ones): cost per frame and whether the font is used.
  evidence.fonts = {};
  const titleBand = (file) => { const f = decode(file, FRAMES - 1); let sum = 0; for (let y = 300; y < 400; y++) for (let x = 120; x < 600; x++) sum += f[(y * W + x) * 4 + 3]; return sum; };
  const plainInk = evidence.methods.canvas?.ok ? titleBand(evidence.methods.canvas.file) : null;
  for (const [name, file] of [['anton_19kb', 'node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2'], ['amiri_arabic_100kb', 'node_modules/@fontsource/amiri/files/amiri-arabic-700-normal.woff2']]) {
    try {
      const data = fs.readFileSync(path.join(root, file)).toString('base64');
      const { file: out, stats } = await renderGraphic({ ffmpegPath: ff.ffmpegPath, code, inputs: { font: { family: name, data } }, width: W, height: H, fps: FPS, frames: FRAMES, method: 'canvas', dir: path.join(dir, 'font-' + name) });
      evidence.fonts[name] = { ms_per_frame: +(stats.total_ms / FRAMES).toFixed(1), raster_ms_per_drawn_frame: +(stats.raster_ms / (FRAMES - stats.repeated)).toFixed(1), title_ink: titleBand(out), plain_title_ink: plainInk };
    } catch (error) { evidence.fonts[name] = { error: error.message }; }
  }
  // Methods against each other on a moving frame.
  const reference = evidence.methods.canvas?.ok ? decode(evidence.methods.canvas.file, 40) : null;
  for (const [name, m] of Object.entries(evidence.methods)) if (m.ok && reference && name !== 'canvas') {
    const other = decode(m.file, 40); let differing = 0, worst = 0;
    for (let i = 0; i < other.length; i++) { const d = Math.abs(other[i] - reference[i]); if (d > 2) differing++; worst = Math.max(worst, d); }
    m.vs_canvas_frame_40 = { channels_off_by_more_than_2: differing, worst };
  }
  const chosen = Object.entries(evidence.methods).filter(([, m]) => m.ok).sort((a, b) => a[1].ms_per_frame - b[1].ms_per_frame)[0];
  if (!chosen) throw Error('No capture method worked.');
  evidence.fastest = chosen[0];
  const mov = chosen[1].file;

  // 2. Preview copy: transparent VP9 (Chromium plays it; FFmpeg's own VP9 decoder would drop alpha).
  const preview = {};
  for (const [label, scale] of [['full', null], ['half', '540:960']]) {
    const webm = path.join(dir, `preview-${label}.webm`);
    const [, ms] = timed(() => execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-i', mov, ...(scale ? ['-vf', `scale=${scale}:flags=lanczos`] : []),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0', webm]));
    const size = scale ? '540x960' : `${W}x${H}`, w = scale ? 540 : W, k = scale ? 0.5 : 1;
    const last = decode(webm, FRAMES - 1, { vp9: true, size, yuv: true });
    preview[label] = { encode_ms: ms, bytes: fs.statSync(webm).size, file: webm,
      alpha: Object.fromEntries(Object.entries(SAMPLES).map(([n, [x, y, want]]) => [n, { got: px(last, Math.round(x * k), Math.round(y * k), w), want }])) };
  }
  // Chromium plays the transparent preview: draw a frame over red and read it back.
  const page = path.join(dir, 'play.html');
  fs.writeFileSync(page, `<!doctype html><video id="v" src="preview-full.webm" muted playsinline></video><canvas id="c" width="${W}" height="${H}"></canvas>`);
  const viewer = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await viewer.loadFile(page);
  preview.chromium = await viewer.webContents.executeJavaScript(`(async () => {
    const v = document.getElementById('v'), c = document.getElementById('c').getContext('2d');
    if (v.readyState < 1) await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(Error('video error ' + (v.error && v.error.code))); });
    v.currentTime = ${(FRAMES - 1) / FPS}; await new Promise((r) => { v.onseeked = r; });
    c.fillStyle = '#ff0000'; c.fillRect(0, 0, ${W}, ${H}); c.drawImage(v, 0, 0, ${W}, ${H});
    const at = (x, y) => Array.from(c.getImageData(x, y, 1, 1).data);
    return { video: [v.videoWidth, v.videoHeight], background_over_red: at(40, 40), bar: at(876, 1200), gridline_over_red: at(130, 750) };
  })()`);
  viewer.destroy();
  evidence.preview = preview;

  // 3. The real export composite: the transparent graphic as an overlay over a solid background.
  const bg = path.join(dir, 'bg.png');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${BG.map((v) => v.toString(16).padStart(2, '0')).join('')}:s=${W}x${H}`, '-frames:v', '1', bg]);
  const project = { width: W, height: H, fps: FPS, background: '#000000',
    media: [{ ...await ff.probe(bg), id: 'bg', path: bg }, { ...await ff.probe(mov), id: 'g', path: mov }],
    videoClips: [{ id: 'v', mediaId: 'bg', in: 0, out: FRAMES / FPS, speed: 1 }], overlayClips: [{ id: 'o', mediaId: 'g', start: 0, in: 0, out: FRAMES / FPS, speed: 1 }],
    audioClips: [], textClips: [], exportSettings: { preset: 'custom', custom: { mode: 'crf', crf: 12, codec: 'h264', encoderPreset: 'ultrafast', resCap: 0, fps: 0, audioKbps: 128 } } };
  const exported = path.join(dir, 'export.mp4');
  let exportError = null;
  try { const { args } = ff.buildExportArgs(project, exported, {}); execFileSync(ff.ffmpegPath, args.filter((a) => a !== '-progress' && a !== 'pipe:1'), { maxBuffer: 64 << 20 }); }
  catch (error) { exportError = String(error.stderr || error.message).slice(-600); }
  if (!exportError) {
    const out = decode(exported, FRAMES - 10, { yuv: true }), graphic = decode(mov, FRAMES - 10);
    // Expected: the graphic blended over the background, everywhere; measure the error. The overlay
    // compositing path shifts luma by ~2 levels for every overlay (measured with a plain image too),
    // so the blend is also checked against the background as exported.
    const shown = px(out, 40, 40).slice(0, 3);
    const errors = (under) => { let sum = 0, worst = 0, n = 0, over8 = 0;
      for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4, a = graphic[i + 3] / 255;
        for (let ch = 0; ch < 3; ch++) { const want = graphic[i + ch] * a + under[ch] * (1 - a), d = Math.abs(out[i + ch] - want); sum += d; worst = Math.max(worst, d); n++; if (d > 8) over8++; }
      }
      return { mean: +(sum / n).toFixed(2), worst: Math.round(worst), share_over_8: +(over8 / n).toFixed(4) }; };
    const vsSource = errors(BG), vsShown = errors(shown);
    const sum = vsSource.mean, worst = vsSource.worst, n = 1;
    evidence.export = { probe: await ff.probe(exported), mean_error: +(sum / n).toFixed(2), worst_error: Math.round(worst), blend_vs_source_background: vsSource, blend_vs_exported_background: vsShown,
      note: 'Luma about 2 levels low under any overlay (also with a plain image overlay): an existing export-path offset, not the graphic.',
      bar_top_row: { graphic: edge(graphic, 876), exported: edge(out, 876) },
      pixels: { background: px(out, 40, 40), bar: px(out, 876, 1200), gridline: px(out, 130, 750), gridline_expected: BG.map((v) => Math.round(255 * 0.25 + v * 0.75)) } };
  } else evidence.export = { error: exportError };

  // 4. Sandbox.
  const attempt = async (name, source, frames = 20) => {
    try { await renderGraphic({ ffmpegPath: ff.ffmpegPath, code: source, width: 320, height: 180, fps: FPS, frames, method: 'canvas', dir: path.join(dir, 'sandbox-' + name), frameTimeoutMs: 1500 }); return 'completed'; }
    catch (error) { return error.message.split('\n')[0].slice(0, 300); }
  };
  const report = `let net = 'pending', file = 'pending';
    fetch('http://127.0.0.1:9/probe').then(() => { net = 'reached'; }, (e) => { net = 'blocked (' + e.name + ')'; });
    fetch('file:///etc/hosts').then(() => { file = 'read'; }, (e) => { file = 'blocked (' + e.name + ')'; });
    let hostJob = 'pending', hostFrame = 'pending';
    window.graphicsHost.job().then(() => { hostJob = 'GOT THE JOB'; }, (e) => { hostJob = 'refused'; });
    window.graphicsHost.frame('guess', 0, new Uint8Array(4)).then(() => { hostFrame = 'ACCEPTED'; }, () => { hostFrame = 'refused'; });
    export default function render({ frame, kit }) {
      if (frame === 15) throw Error(JSON.stringify({ net, file, require: typeof require, process: typeof process, host_visible: typeof window.graphicsHost, host_job: hostJob, host_frame: hostFrame, random: Math.random() === Math.random() ? 'fixed?' : 'seeded', now: Date.now() }));
      return kit.svg\`<svg viewBox="0 0 320 180"></svg>\`;
    }`;
  const loopStart = Date.now();
  evidence.sandbox = {
    probes: await attempt('probes', report),
    endless_loop: await attempt('loop', 'export default function render({ frame, kit }) { if (frame === 3) for (;;) {} return kit.svg`<svg viewBox="0 0 320 180"></svg>`; }'),
    endless_loop_stopped_after_ms: Date.now() - loopStart,
    not_svg: await attempt('notsvg', 'export default function render() { return "<div>hi</div>"; }'),
  };
  evidence.windows_left_open = BrowserWindow.getAllWindows().length;
  return evidence;
}

module.exports = async (_win, app, smokeDir) => {
  dir = path.join(smokeDir, 'graphics'); fs.mkdirSync(dir, { recursive: true });
  let evidence, code = 0;
  try { evidence = await main(); } catch (error) { evidence = { error: error.stack }; code = 1; }
  evidence.work_dir = dir;
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  fs.writeFileSync(path.join(smokeDir, 'result.json'), JSON.stringify({ error: evidence.error || null }));
  app.exit(code);
};
