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
// The sandbox folder's URL as Chromium spells requests for it: percent-encoded (spaces, accents) and file:///C:/…
// on Windows. options: url.pathToFileURL's (tests pass { windows }).
function ownPrefix(dir = DIR, options) {
  const href = require('node:url').pathToFileURL(dir, options).href;
  return href.endsWith('/') ? href : href + '/';
}
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
    return { token: j.token, code: j.code, inputs: j.inputs, fonts: j.fonts, images: j.images || [], width: j.width, height: j.height, fps: j.fps, frames: j.frames, live: !!j.live };
  });
  ipcMain.handle('graphics:frame', (event, token, index, pixels) => owned(event, token).onFrame(index, pixels));
  ipcMain.handle('graphics:done', (event, token, error, stats) => owned(event, token).onDone(error, stats));
  ipcMain.handle('graphics:liveReady', (event, token, error) => owned(event, token).onReady(error));
  ipcMain.handle('graphics:liveResult', (event, token, index, result) => owned(event, token).onResult(index, result));
}

// Both render paths use the same restrictions. A live component never runs in the editor process.
function sandboxWindow(width, height) {
  const win = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', enableLargerThanScreen: true,
    webPreferences: { preload: path.join(DIR, 'sandboxPreload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION,
      // The display's scale, as offscreen windows had before Electron 42 made 1.0 the default: the sandbox page sees the same devicePixelRatio as before.
      offscreen: { deviceScaleFactor: require('electron').screen.getPrimaryDisplay().scaleFactor }, backgroundThrottling: false, spellcheck: false, webgl: false, devTools: false, navigateOnDragDrop: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  return win;
}

// A persistent sandbox imports the component/fonts once. Each request paints just one current
// frame, with no video encoding, disk writes or full-resolution pixel copy through the editor.
function createLiveGraphic(job) {
  register(); secure();
  const win = sandboxWindow(job.width, job.height), wc = win.webContents, id = wc.id;
  let pending, sequence = 0, closed = false, bootTimer, settleReady, rejectReady;
  const ready = new Promise((resolve, reject) => { settleReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const close = (error = Error('Live graphic preview closed.')) => {
    if (closed) return; closed = true;
    clearTimeout(bootTimer); rejectReady(error);
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
    jobs.delete(id); if (!win.isDestroyed()) win.destroy();
  };
  jobs.set(id, { ...job, live: true,
    onReady: (error) => { clearTimeout(bootTimer); error ? close(Error(error)) : settleReady(); },
    onDone: (error) => close(Error(error || 'Unexpected live preview completion.')),
    onFrame: () => { throw Error('Not a video render.'); },
    onResult: (index, result) => {
      if (!pending || index !== pending.index) throw Error('Unexpected live preview frame.');
      if (result?.error) { const p = pending; pending = null; clearTimeout(p.timer); p.reject(Error(String(result.error).slice(0, 2000))); return; }
      if (typeof result?.image !== 'string' || !result.image.startsWith('data:image/png;base64,') || result.image.length > 12 * 1024 * 1024) { close(Error('Invalid live preview image.')); return; }
      const p = pending; pending = null; clearTimeout(p.timer);
      p.resolve({ image: result.image, render_ms: result.render_ms, session: id, width: result.width, height: result.height });
    },
  });
  bootTimer = setTimeout(() => close(Error('The live graphic did not start.')), 15000);
  wc.once('render-process-gone', () => close(Error('The live graphics renderer stopped.')));
  win.loadFile(path.join(DIR, 'sandbox.html')).catch(close);
  return { close, get closed() { return closed; }, async frame(request) {
    await ready; if (closed) throw Error('Live preview closed.');
    if (pending) throw Error('A live preview frame is already running.');
    const index = sequence++;
    return new Promise((resolve, reject) => {
      pending = { index, resolve, reject, timer: setTimeout(() => close(Error('A live graphic frame exceeded 2000 ms.')), 2000) };
      wc.send('graphics:liveRequest', { ...request, index });
    });
  } };
}

function secure() {
  if (secured) return; secured = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  const own = ownPrefix();
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    callback({ cancel: !(url.startsWith(own) || url.startsWith('blob:') || url.startsWith('data:')) });
  });
}

// Render `frames` frames of `code` at width x height into dir/graphic.mov.
// fonts: [{ family, weight, style, unicodeRange, data (base64) }], embedded in every frame.
// images: [{ id, data (base64), type, width, height }], library pictures the component reads with kit.image(id).
// onProgress(done, total) after each frame. Resolves with { file, stats }.
async function renderGraphic({ ffmpegPath, code, inputs = {}, fonts = [], images = [], width, height, fps = 30, frames, dir, frameTimeoutMs = 2000, signal, onProgress }) {
  register(); secure();
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const win = sandboxWindow(width, height);
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
      jobs.set(id, { code, inputs, fonts, images, width, height, fps, frames,
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

module.exports = { renderGraphic, createLiveGraphic, PARTITION, ownPrefix };
