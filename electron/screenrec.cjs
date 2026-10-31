// Screen recording, main process side.
// - sources(): screens and windows with thumbnails for the picker.
// - choose(): the source the next getDisplayMedia() call of the interface gets (with Windows system sound).
// - begin / chunk / finish: the interface streams the WebM recording here; finish() converts it to MP4 in the
//   user's Videos\ClipCraft folder.
// - A small "Stop" bar stays on top while recording. It is hidden from screen capture, so it never shows in videos.
const { BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Windows can hide a window from screen capture (setContentProtection) but not a transparent one, so the Stop bar
// and the camera bubble are opaque windows cut to their shape with setShape (a stack of 1-pixel rows).
function roundedRows(w, h, r) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 < r ? r - (y + 0.5) : y + 0.5 > h - r ? y + 0.5 - (h - r) : 0;
    const inset = dy > 0 ? r - Math.sqrt(Math.max(0, r * r - dy * dy)) : 0;
    const x = Math.round(inset);
    rows.push({ x, y, width: Math.max(1, w - 2 * x), height: 1 });
  }
  return rows;
}

let pending = null; // { id, audio }
let bar = null;
let barDisplay = null;
let barOpenBounds = null;
let bubble = null;
// Camera bubble settings, kept between recordings. size: diameter in pixels. stroke / glow: the outline and
// glow given to the camera in the video (sizes as in Mask > Outline and glow, 0 = off).
const cam = { deviceId: '', shape: 'circle', size: 220, stroke: 0, strokeColor: '#ffffff', glow: 0, glowColor: '#825cfb' };
const COLOR = /^#[0-9a-f]{6}$/i;
const BUBBLE_ROOM = 56; // pixels of transparent window around the camera shape, for its glow
function setStyle(o) {
  if (o.stroke !== undefined) cam.stroke = Math.max(0, Math.min(40, Math.round(Number(o.stroke) || 0)));
  if (o.glow !== undefined) cam.glow = Math.max(0, Math.min(80, Math.round(Number(o.glow) || 0)));
  if (COLOR.test(o.strokeColor || '')) cam.strokeColor = o.strokeColor;
  if (COLOR.test(o.glowColor || '')) cam.glowColor = o.glowColor;
}
const files = new Map(); // recording id -> { webm, fd }
let n = 0;

function install({ app, getWin, ffmpegPath, probeAll }) {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const choice = pending;
    pending = null;
    if (!choice) return callback({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const src = sources.find((s) => s.id === choice.id);
      if (!src) return callback({});
      callback(choice.audio ? { video: src, audio: 'loopback' } : { video: src });
    } catch {
      callback({});
    }
  });

  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    return sources
      .filter((s) => ![bar, bubble].some((w) => w && !w.isDestroyed() && s.id === w.getMediaSourceId()))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });

  ipcMain.handle('screen:choose', (_e, id, audio) => {
    pending = { id: String(id), audio: !!audio };
  });

  const outDir = () => {
    const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'recordings') : path.join(app.getPath('videos'), 'ClipCraft');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

  // kind: 'screen' | 'camera'. Returns an id for chunk / finish.
  ipcMain.handle('screen:begin', (_e, kind) => {
    const id = `rec${++n}`;
    const webm = path.join(app.getPath('temp'), `clipcraft-${id}-${Date.now()}.webm`);
    files.set(id, { webm, fd: fs.openSync(webm, 'w'), kind: kind === 'camera' ? 'camera' : 'screen', name: stamp() });
    return id;
  });
  ipcMain.handle('screen:chunk', (_e, id, bytes) => {
    const f = files.get(id);
    if (f) fs.writeSync(f.fd, Buffer.from(bytes));
  });
  ipcMain.handle('screen:discard', (_e, id) => {
    const f = files.get(id);
    if (!f) return;
    files.delete(id);
    fs.closeSync(f.fd);
    fs.rmSync(f.webm, { force: true });
  });
  // Converts to MP4 (H.264 + AAC, constant 30 fps so it edits and seeks well) and returns the media item.
  ipcMain.handle('screen:finish', async (_e, id) => {
    const f = files.get(id);
    if (!f) return { error: 'Unknown recording' };
    files.delete(id);
    fs.closeSync(f.fd);
    const out = path.join(outDir(), `${f.kind === 'camera' ? 'Camera' : 'Screen recording'} ${f.name}.mp4`);
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', f.webm,
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-fps_mode', 'cfr', '-r', '30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { windowsHide: true });
        let err = '';
        p.stderr.on('data', (d) => (err += d));
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-1500) || `FFmpeg exited with ${code}`))));
      });
    } catch (e) {
      // Never lose a recording: when the conversion fails (often because the PC ran out of memory, e.g. a full
      // disk C: with no room left for Windows' page file), the original WebM is kept next to where the MP4 would
      // be and added to the project instead.
      fs.rmSync(out, { force: true });
      const keep = out.replace(/\.mp4$/, '.webm');
      try {
        // A browser WebM has no duration in its header: copied once (no re-encoding, very little memory) it gets
        // one, so it edits like any clip. If even that fails, the raw file is kept as it is.
        const copied = await new Promise((resolve) => {
          const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', f.webm, '-c', 'copy', keep], { windowsHide: true });
          p.on('error', () => resolve(false));
          p.on('close', (code) => resolve(code === 0 && fs.existsSync(keep) && fs.statSync(keep).size > 1000));
        });
        if (copied) fs.rmSync(f.webm, { force: true });
        else fs.renameSync(f.webm, keep);
        const [kept] = await probeAll([keep]);
        if (kept && kept.duration > 0) return kept;
      } catch { /* fall through to the message */ }
      const memory = /malloc|cannot allocate memory|out of memory/i.test(e.message);
      return {
        error: memory
          ? `Not enough memory to convert the recording to MP4 (is disk C: full? Windows needs free space there). ${fs.existsSync(keep) ? `The original was kept: ${keep}` : ''}`.trim()
          : `Could not save the recording: ${e.message}`,
      };
    }
    fs.rmSync(f.webm, { force: true });
    const [item] = await probeAll([out]);
    return item;
  });

  // The floating bar: timer + Stop, top center of the screen being recorded (or the main one).
  ipcMain.handle('screen:bar', (_e, show, sourceId) => {
    if (!show) {
      if (bar && !bar.isDestroyed()) bar.close();
      bar = null;
      return;
    }
    if (bar && !bar.isDestroyed()) return;
    const displays = screen.getAllDisplays();
    const m = /^screen:(\d+)/.exec(sourceId || '');
    const d = (m && displays.find((x) => String(x.id) === m[1])) || screen.getPrimaryDisplay();
    const w = 254;
    barDisplay = d;
    bar = new BrowserWindow({
      width: w, height: 38, x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: d.workArea.y + 16,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: true,
      show: false, hasShadow: false, backgroundColor: '#12141c',
      webPreferences: { preload: path.join(__dirname, 'recbar-preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    bar.setShape(roundedRows(w, 38, 19));
    bar.setContentProtection(true); // not visible in screen captures (Windows 10 2004 and later)
    bar.setAlwaysOnTop(true, 'screen-saver');
    bar.loadFile(path.join(__dirname, 'recbar.html'));
    // Set once more after showing: Windows ignores the capture exclusion for a window that was never shown.
    bar.once('ready-to-show', () => { if (!bar) return; bar.showInactive(); bar.setContentProtection(true); });
    bar.on('closed', () => { bar = null; });
  });
  ipcMain.on('recbar:stop', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('screen:stopRequested');
  });
  // Collapse the bar to a small tab at the top edge (the timer goes away), open it again with a click.
  ipcMain.on('recbar:collapse', (_e, collapse) => {
    if (!bar || bar.isDestroyed()) return;
    const d = screen.getDisplayMatching(bar.getBounds()) || barDisplay;
    if (collapse) {
      barOpenBounds = bar.getBounds();
      const w = 74;
      // Windows keeps a minimum window height, so the window stays as tall and its shape shows only the tab.
      bar.setBounds({ x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: d.workArea.y, width: w, height: barOpenBounds.height });
      bar.setShape([{ x: 0, y: 0, width: w, height: 22 }]);
    } else if (barOpenBounds) {
      bar.setBounds(barOpenBounds);
      bar.setShape(roundedRows(barOpenBounds.width, barOpenBounds.height, barOpenBounds.height / 2));
    }
    bar.webContents.send('recbar:collapsed', !!collapse);
  });
  ipcMain.on('recbar:pause', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('screen:pauseRequested');
  });
  ipcMain.handle('screen:barState', (_e, state) => {
    if (bar && !bar.isDestroyed()) bar.webContents.send('recbar:state', state);
  });
  // Camera bubble: shown while the Camera option is on (before and during the recording). It is not hidden from
  // capture: a screen recording shows it, like CapCut's.
  // The bubble is a transparent window a little larger than the camera shape (BUBBLE_ROOM on each side), so the
  // shape is drawn smooth (anti-aliased, not cut in pixel rows) and its glow shines outside it, as in the video.
  const sendCam = () => {
    if (bubble && !bubble.isDestroyed()) bubble.webContents.send('cambubble:config', { ...cam, room: BUBBLE_ROOM });
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('screen:camConfig', { shape: cam.shape, size: cam.size, stroke: cam.stroke, strokeColor: cam.strokeColor, glow: cam.glow, glowColor: cam.glowColor });
  };
  ipcMain.handle('screen:camera', (_e, show, opts = {}) => {
    if (opts.deviceId !== undefined) cam.deviceId = opts.deviceId;
    if (opts.shape) cam.shape = opts.shape === 'square' ? 'square' : 'circle';
    setStyle(opts);
    if (!show) {
      if (bubble && !bubble.isDestroyed()) bubble.close();
      bubble = null;
      return cam;
    }
    if (bubble && !bubble.isDestroyed()) {
      sendCam();
      return cam;
    }
    const d = screen.getPrimaryDisplay();
    const box = cam.size + 2 * BUBBLE_ROOM;
    bubble = new BrowserWindow({
      width: box, height: box, x: d.workArea.x + 40 - BUBBLE_ROOM, y: d.workArea.y + d.workArea.height - box - 40 + BUBBLE_ROOM,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
      transparent: true, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'cambubble-preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    bubble.setAlwaysOnTop(true, 'screen-saver');
    // Like the Stop bar, the bubble stays out of the screen video: the camera is recorded as its own clip.
    bubble.setContentProtection(true);
    bubble.loadFile(path.join(__dirname, 'cambubble.html'));
    bubble.webContents.once('did-finish-load', sendCam);
    bubble.once('ready-to-show', () => { if (!bubble) return; bubble.showInactive(); bubble.setContentProtection(true); });
    bubble.on('closed', () => { bubble = null; });
    return cam;
  });
  // Where the bubble is on the recorded screen, so the camera clip can be placed there in the video:
  // center (cx, cy) and diameter d as fractions of that display, or null when it is on another display.
  ipcMain.handle('screen:camGeom', (_e, sourceId) => {
    if (!bubble || bubble.isDestroyed()) return null;
    const b = bubble.getBounds();
    const m = /^screen:(\d+)/.exec(sourceId || '');
    const displays = screen.getAllDisplays();
    const d = m ? displays.find((x) => String(x.id) === m[1]) : null;
    const on = d || (displays.length === 1 ? displays[0] : null);
    if (!on || !String(sourceId).startsWith('screen:')) return null;
    const D = on.bounds;
    const cx = (b.x + b.width / 2 - D.x) / D.width;
    const cy = (b.y + b.height / 2 - D.y) / D.height;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return null;
    return { cx, cy, d: (b.width - 2 * BUBBLE_ROOM) / D.width }; // the shape, not the room around it
  });
  ipcMain.on('cambubble:set', (_e, patch) => {
    if (patch.shape) cam.shape = patch.shape === 'square' ? 'square' : 'circle';
    if (patch.grow && bubble && !bubble.isDestroyed()) {
      cam.size = Math.max(120, Math.min(520, cam.size + patch.grow * 40));
      const b = bubble.getBounds();
      const box = cam.size + 2 * BUBBLE_ROOM;
      // Grow around the center.
      bubble.setBounds({ x: Math.round(b.x + (b.width - box) / 2), y: Math.round(b.y + (b.height - box) / 2), width: box, height: box });
    }
    sendCam();
  });

  ipcMain.handle('screen:window', (_e, action) => {
    const w = getWin();
    if (!w || w.isDestroyed()) return;
    if (action === 'minimize') w.minimize();
    else {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
}

module.exports = { install };
