// Motion graphics renderer: runs one graphic component (electron/graphics/runtime.js) in a hidden,
// locked-down window and streams its frames into a transparent lossless video (QuickTime RLE, the
// same pipe as the export's text layer). The page rasterises each SVG frame in a canvas and sends
// the pixels (the method chosen by the phase 0 spike: docs/design/motion-graphics.md).
//
// The window is hostile-code safe by construction: sandboxed renderer, no Node, context isolation,
// its own session that denies every permission and blocks every request except the sandbox's own
// files and the blob:/data: URLs it creates, no navigation, no pop-ups, a time limit per frame, and
// a bridge the component cannot use (the runtime takes the job and its one-time token first).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { TextStream } = require('../export/textstream.cjs');

const DIR = __dirname, PARTITION = 'graphics-sandbox';
const jobs = new Map(); // webContents id -> job
let registered = false, secured = false;

function register() {
  if (registered) return; registered = true;
  const job = (event) => { const j = jobs.get(event.sender.id); if (!j) throw Error('Unknown graphics renderer.'); return j; };
  // The bridge cannot be removed from the page, so it is locked instead: the job is handed out once,
  // before the component loads, with a token the runtime keeps to itself; every later call needs it.
  const owned = (event, token) => { const j = job(event); if (!j.token || token !== j.token) throw Error('Not allowed.'); return j; };
  ipcMain.handle('graphics:job', (event) => {
    const j = job(event);
    if (j.token) throw Error('The job was already taken.');
    j.token = crypto.randomBytes(16).toString('hex');
    return { token: j.token, code: j.code, inputs: j.inputs, fonts: j.fonts, width: j.width, height: j.height, fps: j.fps, frames: j.frames };
  });
  ipcMain.handle('graphics:frame', (event, token, index, pixels) => owned(event, token).onFrame(index, pixels));
  ipcMain.handle('graphics:done', (event, token, error, stats) => owned(event, token).onDone(error, stats));
}

function secure() {
  if (secured) return; secured = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  const own = 'file://' + DIR.split(path.sep).join('/') + '/';
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    callback({ cancel: !(url.startsWith(own) || url.startsWith('blob:') || url.startsWith('data:')) });
  });
}

// Render `frames` frames of `code` at width x height into dir/graphic.mov.
// fonts: [{ family, weight, style, unicodeRange, data (base64) }], embedded in every frame.
// onProgress(done, total) after each frame. Resolves with { file, stats }.
async function renderGraphic({ ffmpegPath, code, inputs = {}, fonts = [], width, height, fps = 30, frames, dir, frameTimeoutMs = 2000, signal, onProgress }) {
  register(); secure();
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const win = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', enableLargerThanScreen: true,
    webPreferences: { preload: path.join(DIR, 'sandboxPreload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION,
      offscreen: true, backgroundThrottling: false, spellcheck: false, webgl: false, devTools: false, navigateOnDragDrop: false } });
  const wc = win.webContents, id = wc.id;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  const stream = new TextStream(ffmpegPath, dir, width, height, fps);
  const stats = { frames: 0, load_ms: 0, encode_wait_ms: 0, peak_memory_mb: 0 };
  let timer = null, memoryTimer = null, loaded = 0;
  try {
    const result = await new Promise((resolve, reject) => {
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => reject(Error(`A graphic frame took longer than ${frameTimeoutMs} ms; the render was stopped. Simplify the drawing or remove the endless loop.`)), loaded ? frameTimeoutMs : 15000); };
      const stop = () => reject(Object.assign(Error('Graphic render stopped.'), { name: 'AbortError' }));
      signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
      wc.once('render-process-gone', () => reject(Error('The graphics renderer stopped.')));
      jobs.set(id, { code, inputs, fonts, width, height, fps, frames,
        // pixels null: the same picture as the previous frame.
        onFrame: async (index, pixels) => {
          if (!loaded) { loaded = Date.now(); stats.load_ms = loaded - started; }
          arm();
          if (index !== stats.frames || (pixels === null ? index === 0 : pixels?.byteLength !== width * height * 4)) throw Error('Bad frame from the graphic.');
          const t = Date.now(); await stream.add(pixels === null ? { same: 1 } : pixels); stats.encode_wait_ms += Date.now() - t; stats.frames++;
          onProgress?.(stats.frames, frames);
        },
        onDone: (error, pageStats) => { clearTimeout(timer); if (error) reject(Error(error)); else resolve(pageStats); } });
      memoryTimer = setInterval(() => {
        try { const pid = wc.getOSProcessId(), m = app.getAppMetrics().find((x) => x.pid === pid); if (m) stats.peak_memory_mb = Math.max(stats.peak_memory_mb, Math.round(m.memory.workingSetSize / 1024)); } catch { /* window closing */ }
      }, 200);
      arm();
      win.loadFile(path.join(DIR, 'sandbox.html')).catch(reject);
    });
    const file = await stream.finish(), out = path.join(dir, 'graphic.mov');
    fs.renameSync(file, out);
    Object.assign(stats, result, { total_ms: Date.now() - started });
    return { file: out, stats };
  } catch (error) { stream.kill(); throw error; }
  finally {
    clearTimeout(timer); clearInterval(memoryTimer); jobs.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { renderGraphic, PARTITION };
