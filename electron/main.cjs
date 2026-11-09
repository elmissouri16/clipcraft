const { app, BrowserWindow, ipcMain, dialog, shell, net, nativeImage, powerSaveBlocker, Menu, screen } = require('electron');

const { scopedFetch, checkAbort, activityTimeout } = require("./system/cancel.cjs");
app.setName('ClipCraft');
// Keep the Windows driver workaround; macOS/Linux use Chromium's normal decode
// policy. FVE_GPU_VIDEO=0/1 explicitly disables/allows GPU video on any platform.
if (require('./system/videoPolicy.cjs').disableGpuVideo()) app.commandLine.appendSwitch('disable-accelerated-video-decode');
// The screen recording UI test uses Chromium's fake camera and microphone, never the real ones.
if (process.env.FVE_SMOKE && process.env.FVE_SMOKE_MODE === 'screenrec') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FxJobs } = require("./export/fxjobs.cjs");
const { probe, runExport, exportAudio, toM4a, renderTimelineAudio, detectSilences, makeVisuals, needsProxy, makeProxy, makeQualityProxy, hasLibx265, pickEncoder } = require("./media/ffmpeg.cjs");
const { qualityTargetSize } = require("./media/quality.cjs");
const { mediaWorkBudget } = require('./media/workBudget.cjs');
const whisper = require("./audio/whisper.cjs");
const cloudCaptions = require("./audio/cloudCaptions.cjs");

// Whisper lived under the old app name; move it instead of downloading ~150 MB again.
const whisperDir = () => {
  if (process.env.FVE_SMOKE) return path.join(process.env.FVE_SMOKE, 'whisper-test');
  const dir = path.join(app.getPath('userData'), 'whisper');
  const old = path.join(app.getPath('appData'), 'free-video-editor', 'whisper');
  if (!fs.existsSync(dir) && fs.existsSync(old)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(old, dir);
  }
  return dir;
};

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];

let win;
let currentExport = null;
let exportSleepBlocker = null;
let exportBackgroundThrottle = null;
function exportActivity(active,progress=0) {
  if (active && exportSleepBlocker===null) exportSleepBlocker=powerSaveBlocker.start('prevent-app-suspension');
  if (!active && exportSleepBlocker!==null) {powerSaveBlocker.stop(exportSleepBlocker);exportSleepBlocker=null;}
  if (win && !win.isDestroyed()) {
    if (active && exportBackgroundThrottle===null) {exportBackgroundThrottle=win.webContents.getBackgroundThrottling();win.webContents.setBackgroundThrottling(false);}
    if (!active && exportBackgroundThrottle!==null) {win.webContents.setBackgroundThrottling(exportBackgroundThrottle);exportBackgroundThrottle=null;}
    win.setProgressBar(active?Math.max(0,Math.min(1,Number(progress)||0)):-1);
  }
}
ipcMain.handle('export:activity',(_event,state)=>exportActivity(state?.active===true,state?.progress));
function stopExportWork(){currentExport?.cancel();fxJobs.clear();for(const stream of textStreams.values())stream.kill();}
app.on('will-quit',()=>{exportActivity(false);stopExportWork();});

// Restore the last window placement when it is still on a connected display.
function savedBounds() {
  const saved = !process.env.FVE_SMOKE && settings.getWindowState();
  if (!saved || saved.x === null || saved.y === null) return saved ? { width: saved.width, height: saved.height, maximized: saved.maximized } : null;
  const visible = screen.getAllDisplays().some(d => { const a = d.workArea; return saved.x < a.x + a.width - 80 && saved.x + saved.width > a.x + 80 && saved.y >= a.y - 20 && saved.y < a.y + a.height - 80; });
  return visible ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized };
}
function createWindow() {
  const placement = savedBounds();
  const mac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: placement?.width || 1400,
    height: placement?.height || 860,
    ...(Number.isFinite(placement?.x) ? { x: placement.x, y: placement.y } : {}),
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#07070e',
    title: 'ClipCraft',
    show: false,
    // macOS: the window buttons sit inside ClipCraft's own top bar (one bar, not two).
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 24 } } : {}),
    // The .ico carries 16-256 px versions, so the title bar and taskbar stay sharp on Windows.
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Dev server pages are http://localhost and must still read local media files.
      webSecurity: !process.env.VITE_DEV_SERVER_URL,
      // UI tests keep their local storage (the unsaved-project copy) in memory, away from the real one.
      ...(process.env.FVE_SMOKE ? { partition: 'fve-smoke' } : {}),
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Show once painted (no blank frame), at the remembered size; first launch opens maximized.
  let shown = false;
  const showWindow = () => {
    if (shown || !win || win.isDestroyed()) return; shown = true;
    if (process.env.FVE_SMOKE) return; // UI tests show and size their own window
    if (!placement || placement.maximized) win.maximize();
    win.show();
  };
  win.once('ready-to-show', showWindow);
  setTimeout(showWindow, 3000);
  // A desktop app does not zoom like a web page (pinch or Ctrl+wheel).
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  win.webContents.on('zoom-changed', () => win.webContents.setZoomFactor(1));
  const rememberPlacement = () => {
    if (process.env.FVE_SMOKE || !win || win.isDestroyed()) return;
    try { settings.setWindowState({ ...win.getNormalBounds(), maximized: win.isMaximized(), fullScreen: win.isFullScreen() }); } catch {}
  };
  win.on('close', rememberPlacement);
  // Native right-click menu for text fields and selected text (cut, copy, paste, spelling).
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items = [];
    if (params.misspelledWord) {
      for (const word of (params.dictionarySuggestions || []).slice(0, 5)) items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      if (params.dictionarySuggestions?.length) items.push({ type: 'separator' });
    }
    if (params.isEditable) items.push({ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' }, { role: 'selectAll', enabled: params.editFlags.canSelectAll });
    else items.push({ role: 'copy', enabled: params.editFlags.canCopy });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app:closeRequest');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeNow, 5000);
  });
  // The interface files may be missing for a moment (being rebuilt by "npm run build" / "npm start" in another
  // window) or the page may crash: load it again instead of leaving a black window.
  let reloads = 0;
  const reloadSoon = () => {
    if (reloads++ < 10) setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, 1500);
  };
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    logCrash('page failed to load', { code, desc });
    reloadSoon();
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    exportActivity(false);stopExportWork();
    if (d.reason === 'clean-exit') return;
    logCrash('interface crashed', { reason: d.reason, exitCode: d.exitCode });
    recovered = true; // the interface reloads and restores the project it autosaved
    reloadSoon();
  });
  win.webContents.on('unresponsive', () => logCrash('interface not responding', {}));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) logCrash('interface error', { message: String(message).slice(0, 500), at: `${path.basename(sourceId || '')}:${line}` });
  });
  win.webContents.on('did-start-loading', () => externalAgents.rendererGone());
  win.webContents.on('render-process-gone', () => externalAgents.rendererGone());
  win.webContents.on('did-finish-load', () => {
    // An empty page (index.html written but the scripts not yet): check that the interface started.
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.webContents.executeJavaScript("!!(document.getElementById('root') && document.getElementById('root').children.length)")
        .then((ok) => { if (ok) reloads = 0; else reloadSoon(); }).catch(() => {});
    }, 4000);
  });
  if (process.env.FVE_SMOKE) {
    win.webContents.once('did-finish-load', () => require("../tests/smoke/index.cjs")(win, app, process.env.FVE_SMOKE));
  }
}

// ---- Crash log: <userData>/logs/crash.log, so a black or frozen window can be explained afterwards. ----
// Only what went wrong and the app's memory use: no project content, no keys.
let recovered = false;
const crashDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'logs') : path.join(app.getPath('userData'), 'logs'));
let lastLog = { key: '', at: 0 };
function logCrash(what, details) {
  try {
    const key = `${what}|${JSON.stringify(details)}`;
    if (key === lastLog.key && Date.now() - lastLog.at < 5000) return; // the same error repeating every frame
    lastLog = { key, at: Date.now() };
    const dir = crashDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'crash.log');
    const mem = app.getAppMetrics().map((m) => `${m.type}:${Math.round((m.memory?.workingSetSize || 0) / 1024)}MB`).join(' ');
    const line = `${new Date().toISOString()} v${app.getVersion()} ${what} ${JSON.stringify(details)} | memory ${mem}\n`;
    if (fs.existsSync(file) && fs.statSync(file).size > 300000) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-150000));
    fs.appendFileSync(file, line);
  } catch {
    // logging must never break the app
  }
}
// Graphics chip and driver, written with graphics process crashes.
let gpuName = '';
app.whenReady().then(() => app.getGPUInfo('basic')).then((info) => {
  const g = (info.gpuDevice || []).find((x) => x.active) || (info.gpuDevice || [])[0];
  if (g) gpuName = `${Number(g.vendorId).toString(16)}:${Number(g.deviceId).toString(16)} driver ${g.driverVersion || '?'}`;
}).catch(() => {});
app.on('child-process-gone', (_e, d) => {
  if (d.reason === 'clean-exit') return;
  logCrash(`${d.type} process gone`, { reason: d.reason, exitCode: d.exitCode, name: d.name || '', ...(d.type === 'GPU' ? { gpu: gpuName } : {}) });
});
ipcMain.handle('app:recovered', () => {
  const r = recovered;
  recovered = false;
  return r;
});
ipcMain.handle('app:openCrashLog', () => {
  const file = path.join(crashDir(), 'crash.log');
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  return fs.existsSync(file);
});

async function probeAll(files) {
  const items = [];
  for (const file of files) {
    try {
      const info = await probe(file);
      items.push({ path: file, name: path.basename(file), ...info });
    } catch (e) {
      items.push({ path: file, name: path.basename(file), error: e.message });
    }
  }
  queueVisuals(items.filter((i) => !i.error));
  return items;
}

// Thumbnails and waveforms are generated in the background; the UI gets each result
// through 'media:visuals' so importing never waits for them. How many jobs run at once
// is the performance mode's concurrency knob (measured per mode — see PERF-REPORT).
const visualsQueue = [];
const visualsQueued = new Set();
let visualsActive = 0;
const VISUALS_CONCURRENCY = { 'low-end': 1, balanced: 2, 'high-performance': 3 };
const visualTasks = new Map();
const backgroundVisuals = (item, cache, emit) => {
  if (!visualTasks.has(item.path)) {
    const task = makeVisuals(item, cache, emit).catch(() => {}).finally(() => visualTasks.delete(item.path));
    visualTasks.set(item.path, task);
  }
  // Do not occupy a proxy-preparation slot while optional visuals are deferred.
  return Promise.resolve();
};
ipcMain.handle('media:foregroundWork', (_event, state) => {
  mediaWorkBudget.setState({ playing: state?.playing === true, exporting: state?.exporting === true,
    limit: VISUALS_CONCURRENCY[settings.getPerfMode()] || 2 });
});

function queueVisuals(items) {
  for (const it of items) {
    if (visualsQueued.has(it.path)) continue;
    if (visualTasks.has(it.path) && !needsPreviewWork(it)) continue;
    visualsQueued.add(it.path);
    visualsQueue.push(it);
  }
  pumpVisuals();
}

function needsPreviewWork(item) {
  if (item.type !== 'video') return false;
  if (!item.vcodec || item.pixFmt === undefined || item.hdr === undefined) return true;
  const quality = settings.getQuality(), scaled = quality !== 'full' && qualityTargetSize(item.width, item.height, quality);
  if (scaled && item.proxies?.[quality] == null) return true;
  return needsProxy(item) && !item.proxy && !item.proxyFailed && (quality === 'full' || quality === 'high' || !scaled);
}

// Thumbnails, waveforms and preview proxies. Not "cache": on Windows that is the same folder as Chromium's own
// "Cache", which Chromium cleans, deleting our files. Proxies left there by older versions are moved over once.
let mediaCacheReady = false;
function mediaCacheDir() {
  // UI tests use their own folder (they make and delete proxies).
  const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'media-cache-test') : path.join(app.getPath('userData'), 'media-cache');
  if (!mediaCacheReady) {
    mediaCacheReady = true;
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(app.getPath('userData'), 'cache');
    try {
      for (const f of fs.readdirSync(old)) {
        if (!/-proxy\.mp4$/.test(f)) continue; // thumbnails and waveforms are quick to make again
        try { fs.renameSync(path.join(old, f), path.join(dir, f)); } catch { /* in use or already there */ }
      }
    } catch { /* no old folder */ }
  }
  return dir;
}

function pumpVisuals() {
  const limit = VISUALS_CONCURRENCY[settings.getPerfMode()] || 2;
  while (visualsActive < limit && visualsQueue.length) {
    visualsActive++;
    processVisualItem(visualsQueue.shift())
      .catch(() => {})
      .finally(() => { visualsActive--; pumpVisuals(); });
  }
}

async function processVisualItem(it) {
  const quality = settings.getQuality();
  let latest = it;
  try {
    latest = await require('./media/preparePreview.cjs').preparePreview(it, quality, mediaCacheDir(),
      patch => { if (win && !win.isDestroyed()) win.webContents.send('media:visuals', { path: it.path, ...patch }); },
      { probe, needsProxy, makeProxy, makeQualityProxy, makeVisuals: backgroundVisuals });
  } finally {
    visualsQueued.delete(it.path);
    // A quality switch during an encode must not get lost behind deduplication.
    // Completed paths travel into the next job so its metadata merge retains them.
    if (settings.getQuality() !== quality) queueVisuals([latest]);
  }
}

// Playback quality: the current level, the space the scaled copies take, and deleting them
// (only at Full quality, so the player is never left pointing at deleted files).
const proxyFiles = () => {
  try {
    return fs.readdirSync(mediaCacheDir()).filter((f) => /-(lproxy|qhigh|qmedium|qlow)\.mp4$/.test(f)).map((f) => path.join(mediaCacheDir(), f));
  } catch {
    return [];
  }
};
const proxyStatus = () => {
  const quality = settings.getQuality();
  const files = proxyFiles();
  return { on: quality !== 'full', quality, files: files.length, bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0) };
};
ipcMain.handle('proxy:status', () => proxyStatus());
ipcMain.handle('proxy:set', (_e, on) => {
  settings.setProxy(on === true);
  return proxyStatus();
});
ipcMain.handle('proxy:setQuality', (_e, q) => {
  settings.setQuality(q);
  return proxyStatus();
});
// Performance mode: a bundle applied on selection — Low-End defaults playback to the
// Low tier, High-Performance to Full, Balanced leaves the user's tier alone. The other
// knobs (visuals concurrency, export priority) read the persisted mode where they run.
ipcMain.handle('perf:getMode', () => settings.getPerfMode());
ipcMain.handle('perf:setMode', (_e, mode) => {
  const m = settings.setPerfMode(mode);
  mediaWorkBudget.setState({ limit: VISUALS_CONCURRENCY[m] || 2 });
  if (m === 'low-end') settings.setQuality('low');
  if (m === 'high-performance') settings.setQuality('full');
  pumpVisuals(); // a wider or narrower gate applies to the queue right away
  return { mode: m, ...proxyStatus() };
});
ipcMain.handle('proxy:clear', () => {
  if (settings.getQuality() !== 'full') return { ...proxyStatus(), deleted: [] };
  const deleted = [];
  for (const f of proxyFiles()) {
    try {
      fs.rmSync(f);
      deleted.push(f);
    } catch { /* still open in the player */ }
  }
  return { ...proxyStatus(), deleted };
});

// Adjust > Auto: a few small frames of the clip (the analysis itself runs in the renderer, src/features/effects/autocolor.js).
ipcMain.handle('color:sample', async (_e, item, from, to) => {
  try {
    if (!item || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
    const frames = await require("./media/ffmpeg.cjs").sampleFrames(item, from, to);
    return frames.length ? { frames } : { error: 'Could not read pictures from this clip.' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('media:ensureVisuals', (_e, items) => queueVisuals(items.filter((i) => i && fs.existsSync(i.path))));

ipcMain.handle('media:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
      { name: 'Video', extensions: VIDEO_EXT },
      { name: 'Audio', extensions: AUDIO_EXT },
      { name: 'Images', extensions: IMAGE_EXT },
    ],
  });
  return res.canceled ? [] : probeAll(res.filePaths);
});

// Files dropped from Explorer.
ipcMain.handle('media:probe', (_e, files) => {
  const ok = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT];
  return probeAll(files.filter((f) => ok.includes(path.extname(f).slice(1).toLowerCase())));
});

// Voice-over recorded in the UI (MediaRecorder webm) -> m4a in the user data folder.
ipcMain.handle('media:saveRecording', async (_e, bytes) => {
  const dir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const webm = path.join(dir, `voiceover-${stamp}.webm`);
  fs.writeFileSync(webm, Buffer.from(bytes));
  const m4a = await toM4a(webm, webm.replace(/\.webm$/, '.m4a'));
  fs.rmSync(webm, { force: true });
  return (await probeAll([m4a]))[0];
});

// ---- Your fonts: .ttf / .otf / .woff / .woff2 kept in <userData>/fonts for every project. ----
const userFonts = require('./export/fonts.cjs');
const fontDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'fonts-test') : path.join(app.getPath('userData'), 'fonts'));
const fontList = () => userFonts.list(fontDir()).map(({ id, name }) => ({ id, name }));
ipcMain.handle('fonts:list', () => fontList());
ipcMain.handle('fonts:import', async (_e, files) => {
  try {
    let paths = Array.isArray(files) ? files.filter((f) => typeof f === 'string') : null;
    if (!paths) {
      const res = await dialog.showOpenDialog(win, {
        title: 'Add fonts', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Fonts', extensions: userFonts.EXT.map((x) => x.slice(1)) }],
      });
      if (res.canceled) return { added: [], skipped: [], list: fontList() };
      paths = res.filePaths;
    }
    return { ...userFonts.add(fontDir(), paths), list: fontList() };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('fonts:data', (_e, id) => {
  const file = userFonts.fileOf(fontDir(), id);
  return file ? fs.readFileSync(file) : null;
});
ipcMain.handle('fonts:remove', (_e, id) => {
  try {
    userFonts.remove(fontDir(), id);
  } catch (e) {
    return { error: e.message };
  }
  return { list: fontList() };
});

// ---- Favorites (sounds, videos, photos), kept across projects. UI tests use their own file. ----
const favorites = require("./project/favorites.cjs");
const favDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'favorites-test') : app.getPath('userData'));
ipcMain.handle('favorites:list', () => favorites.list(favDir()));
ipcMain.handle('favorites:toggle', (_e, entry) => {
  try {
    return favorites.toggle(favDir(), entry);
  } catch (e) {
    return { error: e.message };
  }
});

// ---- Audio library (Openverse / SFXMint / MyInstants + Soundza). Files live in <userData>/library. ----
const library = require("./library/library.cjs");
const soundza = require("./library/soundza.cjs");
const libraryDir = () => path.join(app.getPath('userData'), 'library');
// The Soundza key only ever comes from the encrypted settings. Local-fixture override for
// tests/development (cf. CLIPCRAFT_PACK_URL): while CLIPCRAFT_SOUNDZA_URL points the client
// at a fixture server, a key may come from the environment, because the test sandbox has no
// OS keyring to save one into. In normal runs the environment is never consulted.
const soundzaKey = () => settings.getServiceKey('soundza')
  || (process.env.CLIPCRAFT_SOUNDZA_URL ? process.env.CLIPCRAFT_SOUNDZA_KEY || '' : '');
const libraryPath = (item, fetchImpl = net.fetch) => (String(item?.id || '').startsWith('soundza-')
  ? soundza.download(fetchImpl, libraryDir(), item, soundzaKey())
  : library.download(fetchImpl, libraryDir(), item));

ipcMain.handle('library:search', (event, opts = {}) => withAgentJob(event, opts.requestId, async signal => {
  try {
    return await library.search(scopedFetch(net.fetch, signal), opts || {});
  } catch (e) {
    return { error: /fetch|ENOTFOUND|ERR_INTERNET|network/i.test(e.message) ? 'No internet connection.' : e.message };
  }
}));
ipcMain.handle('library:file', async (_e, item) => {
  try {
    return { path: await libraryPath(item) };
  } catch (e) {
    return { error: e.message };
  }
});
// Adds a library sound as a media item; online sounds keep their license and credit line.
ipcMain.handle('library:add', (event, item, opts = {}) => withAgentJob(event, opts.requestId, async signal => {
  try {
    const file = await libraryPath(item, scopedFetch(net.fetch, signal));
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const credit = {
      title: item.title, creator: item.creator, license: item.license, licenseName: item.licenseName,
      licenseUrl: item.licenseUrl, landing: item.landing, providerName: item.providerName,
      line: item.provider === 'soundza' ? soundza.creditLine(item) : library.creditLine(item),
    };
    return { ...m, name: `${item.title}${path.extname(file) || '.mp3'}`, credit };
  } catch (e) {
    return { error: e.message };
  }
}));

// ---- Sound effects (Soundza). The key stays in this process. ----
ipcMain.handle('soundza:status', () => ({ hasKey: !!soundzaKey() }));
// Tests a typed key (or the saved one) with a tiny search.
ipcMain.handle('soundza:test', async (_e, key) => {
  try {
    const k = String(key || '').trim() || soundzaKey();
    const r = await soundza.search(net.fetch, k, { q: 'whoosh' });
    return { ok: true, text: `Soundza works (a test search found ${r.results.length} sounds).` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
});
ipcMain.handle('soundza:search', async (_e, opts) => {
  try {
    return await soundza.search(net.fetch, soundzaKey(), opts || {});
  } catch (e) {
    return { error: e.message };
  }
});
// Preview MP3s are fetched once into the library folder (the page may only play local media).
ipcMain.handle('soundza:preview', async (_e, item) => {
  try {
    return { path: await soundza.preview(net.fetch, libraryDir(), item) };
  } catch (e) {
    return { error: e.message };
  }
});

// Project files the user picked in a Save or Open dialog: only these are written without asking (auto save).
const projectFiles = new Set();
const persistence = new (require('./project/persistence.cjs').ProjectPersistence)();
// Saves to the project's file, or asks where the first time (and for "Save as").
ipcMain.handle('project:save', async (_e, json, file, opts = {}) => {
  try {
    if (file && projectFiles.has(file) && !opts.saveAs) {
      await persistence.writeProject(file, json);
      return file;
    }
    const name = String(opts.name || 'project').replace(/[\\/:*?"<>|]+/g, '').trim() || 'project';
    const res = await dialog.showSaveDialog(win, {
      title: opts.saveAs ? 'Save project as' : 'Save project',
      defaultPath: file || `${name}.clipcraft.json`,
      filters: [{ name: 'Project', extensions: ['json'] }],
    });
    if (res.canceled) return null;
    await persistence.writeProject(res.filePath, json);
    projectFiles.add(res.filePath);
    return res.filePath;
  } catch (e) {
    return { error: `Could not save the project: ${e.message}` };
  }
});
// An external agent's save_project with a path (docs/design/external-agent-mcp.md): no dialog, so only a
// new *.clipcraft.json in an existing folder, or the project's own file; never another existing file.
ipcMain.handle('project:saveAgent', async (_e, json, target, current) => {
  try {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return { error: 'Give an absolute path ending in .clipcraft.json.' };
    const file = path.resolve(target);
    if (!/\.clipcraft\.json$/i.test(file)) return { error: 'The path must end in .clipcraft.json.' };
    if (!fs.existsSync(path.dirname(file)) || !fs.statSync(path.dirname(file)).isDirectory()) return { error: `The folder ${path.dirname(file)} does not exist.` };
    const own = typeof current === 'string' && current && path.resolve(current) === file;
    if (fs.existsSync(file) && !own) return { error: `${file} already exists. Choose a new file name; existing files are never overwritten.` };
    await persistence.writeProject(file, json);
    projectFiles.add(file);
    return { file };
  } catch (e) {
    return { error: `Could not save the project: ${e.message}` };
  }
});
// Auto save: rewrites an already chosen project file.
ipcMain.handle('project:autosave', async (_e, file, json) => {
  if (!projectFiles.has(file)) return false;
  try {
    await persistence.writeProject(file, json);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'Project', extensions: ['json'] }],
  });
  if (res.canceled) return null;
  const pf = require("./project/projectfile.cjs");
  const file = res.filePaths[0];
  projectFiles.add(file);
  return { file, json: await pf.refreshSizes(pf.checkGenerated(fs.readFileSync(file, 'utf8'), mediaCacheDir()), probe) };
});

// Reopen a known project file by path (Home screen recents): same refresh as project:open,
// no dialog. Returns null when the file is gone or unreadable.
ipcMain.handle('project:openPath', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const pf = require("./project/projectfile.cjs");
    projectFiles.add(filePath);
    return { file: filePath, json: await pf.refreshSizes(pf.checkGenerated(fs.readFileSync(filePath, 'utf8'), mediaCacheDir()), probe) };
  } catch {
    return null;
  }
});

// ---- Per-project autosave slots (electron/project/autosave.cjs): one slot per project id under
// <userData>/autosave, so Home is a switchboard — leaving a project (Home, another open,
// a new project) flushes its slot, and every project the user touched is listed there.
const autosaveStore = require("./project/autosave.cjs");
const autosaveDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'autosave-test') : path.join(app.getPath('userData'), 'autosave'));
ipcMain.handle('slots:write', (_e, record) => persistence.writeSlot(autosaveDir(), record));
ipcMain.handle('slots:list', () => autosaveStore.listSlots(autosaveDir()));
ipcMain.handle('slots:forFile', (_e, filePath) => autosaveStore.slotForFile(autosaveDir(), filePath));
ipcMain.handle('slots:read', (_e, id) => {
  const slot = autosaveStore.readSlot(autosaveDir(), id);
  // A slot bound to a project file adopts that file as known (same trust as project:openPath),
  // so the auto-save-to-file writes keep working for a project reopened from its slot.
  if (slot?.file && fs.existsSync(slot.file)) projectFiles.add(slot.file);
  return slot;
});
ipcMain.handle('slots:delete', (_e, id) => autosaveStore.deleteSlot(autosaveDir(), id));

// Closing the window: the interface saves the project, or asks (in its own dialog) about a project that never had
// a file. If it does not answer (frozen), the window closes anyway after a few seconds; the next start offers the
// autosaved copy.
let allowClose = !!process.env.FVE_SMOKE && !['autosave','persistence-performance'].includes(process.env.FVE_SMOKE_MODE);
let closeTimer = null;
const closeNow = () => {
  clearTimeout(closeTimer);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
};
ipcMain.handle('app:closeNow', () => closeNow());
ipcMain.handle('app:closeCancel', () => clearTimeout(closeTimer));

// Export happens in two steps: the UI renders the text layer to PNG frames (export:frame / export:blanks),
// then FFmpeg composes everything (export:run). Frame folders are only accepted if created by export:begin.
const frameDirs = new Set();
const agentExportTargets = new Map();
const agentExportOutputs = new Map();

ipcMain.handle('agent:exportBegin', (event, req = {}) => {
  try {
    if (currentExport || agentExportTargets.size) throw Error('Another export is already running.');
    const key = agentRequestKey(event, req.requestId);
    if (agentRequests.has(key)) throw Error('This assistant request is already running.');
    const target = require('./agents/editorExport.cjs').createEditorExportTarget(req, {
      outputDir: process.env.FVE_SMOKE || app.getPath('downloads'), cacheDir: path.join(mediaCacheDir(), 'agent-reviews'),
    });
    const controller = new AbortController(), destroyed = () => { controller.abort();dropFrames(target.frameDir); };
    controller.signal.addEventListener('abort', () => stopExportWork(), { once: true });
    event.sender.once('destroyed', destroyed);
    agentRequests.set(key, controller);frameDirs.add(target.frameDir);
    agentExportTargets.set(target.frameDir, { ...target, key, controller, sender: event.sender, destroyed });
    return target;
  } catch (error) { return { error: error.message }; }
});

ipcMain.handle('export:begin', async (_e, suggested) => {
  let file = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'ui-export.mp4') : null;
  if (!file) {
    const base = String(suggested || 'export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'export';
    const res = await dialog.showSaveDialog(win, {
      title: 'Export video',
      defaultPath: `${base}.mp4`,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    if (res.canceled) return { canceled: true };
    file = res.filePath;
  }
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-text-'));
  frameDirs.add(frameDir);
  return { file, frameDir };
});

// Text layer: raw frames from the interface, packed by FFmpeg into <frameDir>/text.mov as they come (textstream.cjs).
const { TextStream } = require("./export/textstream.cjs");
const { SparseTextStream } = require('./export/sparseText.cjs');
const textRenderCache = new (require('./export/renderCache.cjs').RenderCache)();
const textCacheKeys = new Map();
const textStreams = new Map(); // frameDir -> TextStream
const textStream = (dir) => {
  const s = textStreams.get(dir);
  if (!s) throw new Error('Unknown text layer');
  return s;
};
ipcMain.handle('export:textCached', async (_event, dir, width, height, fps, count, signature) => {
  if (!frameDirs.has(dir)) throw new Error('Unknown frame folder');
  const key = textRenderCache.key({signature,width,height,fps,count});
  const file = textRenderCache.get(key);if (!file) return false;
  try { await fs.promises.copyFile(file,path.join(dir,'text.mov'));return true; }
  catch { return false; }
});
ipcMain.handle('export:textBegin', (_e, dir, width, height, fps, options) => {
  if (!frameDirs.has(dir)) throw new Error('Unknown frame folder');
  textStreams.get(dir)?.kill();
  const Stream = options?.sparse ? SparseTextStream : TextStream;
  if (options?.cacheKey) textCacheKeys.set(dir,textRenderCache.key({signature:options.cacheKey,width,height,fps,count:options.count}));
  textStreams.set(dir, new Stream(require("./media/ffmpeg.cjs").ffmpegPath, dir, width, height, fps));
});
ipcMain.handle('export:textFrame', (_e, dir, frame) => textStream(dir).add(frame));
ipcMain.handle('export:textEnd', async (_e, dir) => {
  const s = textStream(dir);
  await s.finish();
  await textRenderCache.put(textCacheKeys.get(dir),s.file,{immutable:true}).catch(() => {});
  return s.count;
});

const dropFrames = (dir) => {
  if (!frameDirs.has(dir)) return;
  const owned = agentExportTargets.get(dir);
  if (owned) {
    agentExportTargets.delete(dir);agentRequests.delete(owned.key);
    if (!owned.sender.isDestroyed()) owned.sender.removeListener('destroyed', owned.destroyed);
  }
  frameDirs.delete(dir);
  textStreams.get(dir)?.kill();
  textStreams.delete(dir);
  textCacheKeys.delete(dir);
  fs.rmSync(dir, { recursive: true, force: true });
};

ipcMain.handle('export:abort', (_e, dir) => dropFrames(dir));

// Animated effects pass (see electron/export/fxjobs.cjs): frames go to the interface's WebGL shaders and back.
const fxJobs = new FxJobs();
const fxCall = (fn) => async (...args) => {
  try {
    return { ok: true, value: await fn(...args) };
  } catch (e) {
    logCrash('effect export failed',{message:String(e.message).slice(0,3000)});
    return { ok: false, error: e.message };
  }
};
ipcMain.handle('fx:begin', fxCall((_e, project, spec) => fxJobs.begin(project, spec)));
ipcMain.handle('fx:read', fxCall((_e, id, count) => fxJobs.read(id, count)));
ipcMain.handle('fx:write', fxCall((_e, id, bytes) => fxJobs.write(id, bytes)));
ipcMain.handle('fx:end', fxCall((_e, id) => fxJobs.end(id)));
ipcMain.handle('fx:lut', fxCall((_e, size, bytes) => fxJobs.lut(size, bytes)));
ipcMain.handle('fx:clear', () => fxJobs.clear());
app.on('will-quit', () => { fxJobs.clear();fxJobs.cache.clear();textRenderCache.clear(); });

// What the bundled FFmpeg can do, for the export-quality UI (H.265 availability drives the summary's
// stated fallback). Cached: the encoder list does not change at runtime.
let exportCapsCache = null;
ipcMain.handle('export:caps', async () => {
  exportCapsCache ||= (async () => ({ libx265: hasLibx265(), h265Hardware: (await pickEncoder('h265')) === 'hevc_videotoolbox' }))();
  return exportCapsCache;
});

ipcMain.handle('export:run', async (event, projectIn, target, textFrames) => {
  let exportJob, ownsFrames = false;
  try {
    const owned = agentExportTargets.get(target?.frameDir);
    if ((owned || target?.requestId) && (!owned || owned.sender.id !== event.sender.id || owned.requestId !== target.requestId || owned.file !== target.file)) throw Error('This assistant export target is not valid.');
    ownsFrames = frameDirs.has(target?.frameDir);
    if (owned?.controller.signal.aborted) return { canceled: true };
    if (currentExport) throw Error('Another video is already being encoded.');
    const project = fxJobs.resolve(projectIn);
    if (owned && fs.existsSync(target.file) && project.media.some(m => m.path && fs.existsSync(m.path) && fs.realpathSync(m.path) === fs.realpathSync(target.file))) throw Error('Choose an output path different from source media.');
    const textFile = path.join(target.frameDir, 'text.mov');
    const withText = textFrames > 0 && frameDirs.has(target.frameDir) && fs.existsSync(textFile)
      ? { ...project, textOverlay: { file: textFile, count: textFrames } }
      : project;
    // Low-End mode: the export yields CPU to the rest of the PC (nice +10). Other modes
    // run at normal priority. Priority never changes the encoder settings or output.
    exportJob = runExport(withText, target.file, (p,detail) => {if(!win.isDestroyed())win.webContents.send('export:progress',p,detail);}, { nice: settings.getPerfMode() === 'low-end' ? 10 : 0, noOverwrite: !!owned?.noOverwrite });
    currentExport = exportJob;
    await exportJob.promise;
    let size = 0;
    try { size = fs.statSync(target.file).size; } catch { /* the done card shows no size */ }
    let metadata;
    if (owned) {
      const probe = await require('./media/ffmpeg.cjs').probe(target.file);
      if (probe.type !== 'video' || !probe.width || !(probe.duration > 0) || !size) throw Error('The rendered file could not be verified as a video.');
      metadata = { duration_sec: probe.duration, width: probe.width, height: probe.height, fps: probe.fps, video_codec: probe.vcodec, audio_codec: probe.acodec, has_audio: probe.hasAudio };
      agentExportOutputs.set(target.file, { owner: event.sender.id, requestId: owned.requestId, revision: owned.revision, timelineStart: owned.timelineStart || 0, metadata, fingerprint: fileFingerprint(target.file) });
      while (agentExportOutputs.size > 64) agentExportOutputs.delete(agentExportOutputs.keys().next().value);
    }
    return { ok: true, file: target.file, size, ...(metadata ? { metadata } : {}) };
  } catch (e) {
    if (exportJob?.canceled) return { canceled: true };
    return { ok: false, error: e.message };
  } finally {
    if (currentExport === exportJob) currentExport = null;
    if (ownsFrames) dropFrames(target.frameDir);
    if (exportJob) fxJobs.clear();
  }
});

// One full-resolution frame of an original media file at `at` seconds, as a JPEG in the media
// cache (never scaled — the Export dialog's cover preview shows this, not a thumbnail-sprite
// frame). Cached per file+position; the cache keeps only the newest few grabs.
ipcMain.handle('media:frame', async (_e, mediaPath, at) => {
  const { execFile } = require('child_process');
  const { ffmpegPath } = require("./media/ffmpeg.cjs");
  try {
    if (!mediaPath || !fs.existsSync(mediaPath)) return { ok: false, error: 'missing file' };
    const st = fs.statSync(mediaPath);
    const key = require('crypto').createHash('sha1')
      .update(`${mediaPath}|${st.size}|${st.mtimeMs}|${(Number(at) || 0).toFixed(2)}`).digest('hex').slice(0, 16);
    const out = path.join(mediaCacheDir(), `${key}-frame.jpg`);
    if (!fs.existsSync(out)) {
      await new Promise((resolve, reject) => execFile(ffmpegPath,
        ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Number(at) || 0)), '-i', mediaPath, '-frames:v', '1', '-q:v', '3', out],
        (e) => (e ? reject(e) : resolve())));
      // Prune older grabs (keep the newest 16) so scrubbing the cover chooser cannot fill the cache.
      try {
        const grabs = fs.readdirSync(mediaCacheDir()).filter((f) => f.endsWith('-frame.jpg'))
          .map((f) => path.join(mediaCacheDir(), f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        for (const f of grabs.slice(16)) { try { fs.rmSync(f); } catch { /* in use */ } }
      } catch { /* cache dir unavailable */ }
    }
    return { ok: true, path: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Embed the chosen poster frame as the MP4's attached cover picture: grab the frame from the source
// media, then a stream-copy remux adds it as attached_pic (the original file is only replaced once
// the remux succeeds, so a failure leaves the export untouched).
ipcMain.handle('export:cover', async (event, file, mediaPath, at) => {
  const { execFile } = require('child_process');
  const { ffmpegPath } = require("./media/ffmpeg.cjs");
  const run = (args) => new Promise((resolve, reject) => execFile(ffmpegPath, args, (e) => (e ? reject(e) : resolve())));
  let tmp;
  try {
    if (!fs.existsSync(file) || !fs.existsSync(mediaPath)) throw new Error('missing file');
    tmp = fs.mkdtempSync(path.join(path.dirname(file), '.clipcraft-cover-'));
    const cover = path.join(tmp, 'cover.jpg');
    await run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Number(at) || 0)), '-i', mediaPath, '-frames:v', '1', '-q:v', '3', cover]);
    const out = path.join(tmp, 'with-cover.mp4');
    await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic', out]);
    fs.renameSync(out, file);
    const output = agentExportOutputs.get(file);
    if (output?.owner === event.sender.id) output.fingerprint = fileFingerprint(file);
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* ignore */ }
    return { ok: true, size };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if(tmp)fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Audio only: asks where to save, then mixes the timeline's sound into MP3, WAV or M4A.
const AUDIO_FORMATS = { mp3: 'MP3 audio', wav: 'WAV audio', m4a: 'M4A audio' };
ipcMain.handle('export:audio', async (_e, project, format, name) => {
  if (!AUDIO_FORMATS[format]) return { ok: false, error: 'Unknown audio format' };
  const base = String(name || 'audio').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'audio';
  let file = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, `ui-audio.${format}`) : null;
  if (!file) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export audio',
      defaultPath: `${base}.${format}`,
      filters: [{ name: AUDIO_FORMATS[format], extensions: [format] }],
    });
    if (res.canceled) return { canceled: true };
    file = res.filePath;
  }
  try {
    await exportAudio(project, file, format);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('export:cancel', () => {
  // Stop preprocessing too: it may be awaiting a decoder or encoder pipe.
  stopExportWork();
});
// ---- Settings and AI. API keys stay in this process; the renderer only ever sees a hint like "…abcd". ----
const settings = require("./system/settings.cjs");
const ai = require("./agents/ai.cjs");
const localAgents = require("./agents/localAgents.cjs");
const agentRuntimes = require('./agents/agentRuntime.cjs').createAgentRuntimes({
  root: path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'agent-runtimes'),
  fetchImpl: (...args) => net.fetch(...args),
  onProgress: (progress, owner) => { const sender = require('electron').webContents.fromId(owner); if (sender && !sender.isDestroyed()) sender.send('ai:runtimeProgress', progress); },
});
localAgents.setRuntimeDirectory(agentRuntimes.root);

// Opens a help page in the browser. Only a short allowlist of known sites is accepted.
const HELP_HOSTS = new Set(['www.slaycamera.com', 'www.instagram.com', 'elevenlabs.io', 'try.elevenlabs.io', 'pixabay.com', 'aistudio.google.com', 'console.developers.google.com', 'console.cloud.google.com', 'ollama.com', 'console.anthropic.com', 'platform.openai.com', 'developers.openai.com', 'learn.chatgpt.com', 'code.claude.com', 'console.groq.com', 'github.com', 'hamzaabika.com', 'www.hamzaabika.com', 'paypal.me']);
ipcMain.handle('app:openHelp', (_e, url) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && HELP_HOSTS.has(u.hostname)) return shell.openExternal(u.toString());
  } catch {
    // fall through
  }
  return false;
});

ipcMain.handle('settings:get', () => settings.getPublic());
// ---- MCP servers: external tool servers (stdio) whose tools CraftAI may call. ----
const mcp = require("./agents/mcp.cjs");
const mcpRegistry = mcp.createRegistry(() => settings.getMcpServers());
ipcMain.handle('settings:setMcpServers', (_e, list) => settings.setMcpServers(list));
ipcMain.handle('settings:setShortcuts', (_e, map) => settings.setShortcuts(map));
ipcMain.handle('mcp:tools', (event, opts = {}) => withAgentJob(event, opts.requestId, async signal => {
  try {
    const { decls, problems } = await mcpRegistry.declarations({ signal });
    // The renderer/agent only needs the Gemini declaration shape; _mcp routing stays server-side.
    return { ok: true, tools: decls.map(({ _mcp, ...d }) => d), problems };
  } catch (e) {
    return { ok: false, error: e.message, tools: [], problems: [] };
  }
}));
ipcMain.handle('mcp:call', (event, { name, args, requestId, revision }) => withAgentJob(event, requestId, async signal => {
  try {
    const { result } = await mcpRegistry.call(name, args || {}, { signal });
    const normalized = await require("./agents/mcpResult.cjs").prepareMcpResult(result, async block => {
      checkAbort(signal);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(block.mimeType) || typeof block.data !== 'string' || block.data.length > 12 * 1024 * 1024) throw new Error('Unsupported or oversized MCP image.');
      const image = nativeImage.createFromBuffer(Buffer.from(block.data, 'base64'));
      if (image.isEmpty()) throw new Error('MCP returned an unreadable image.');
      const size = image.getSize(), scale = Math.min(1, 1024 / Math.max(size.width, size.height));
      return agentFrames.addExternal(event.sender.id, image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toJPEG(88), { revision, label: `Image returned by external tool ${name}` });
    });
    return { ok: true, result: normalized };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}));
ipcMain.handle('mcp:test', async (_e, server) => mcpRegistry.test(server));
ipcMain.handle('settings:save', (_e, patch) => {
  try {
    return { ok: true, settings: settings.save(patch) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('settings:clearKey', (_e, provider) => settings.clearKey(provider));
ipcMain.handle('settings:setModel', (_e, provider, model) => {
  try { return { ok: true, settings: settings.setModel(provider, model) }; }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('settings:setReasoningEffort', async (_e, provider, model, effort) => {
  try {
    const active = settings.getActive();
    if (active.provider !== provider || active.model !== model) throw new Error('The AI provider or model changed. Reopen the picker and try again.');
    let levels = [];
    if (effort) {
      const capability = await ai.modelCapabilities(active, { refresh: true });
      if (!capability.ok) throw new Error(capability.error || 'Could not check supported thinking efforts.');
      levels = capability.reasoningEfforts;
      if (!levels.includes(effort)) throw new Error('This model does not report support for that thinking effort.');
    }
    return { ok: true, settings: settings.setReasoningEffort(provider, model, effort, levels) };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('settings:saveServiceKey', (_e, name, key) => {
  try {
    return { ok: true, settings: settings.saveServiceKey(name, key) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('settings:clearServiceKey', (_e, name) => settings.clearServiceKey(name));

// ---- About and updates: the version, and (only when the user asks in About) whether the
// update feed on clipcrafts.pages.dev has a newer one — see updates.cjs. ----
const updates = require("./system/updates.cjs");
ipcMain.handle('app:version', () => app.getVersion());
// Manual checks only (the About dialog); nothing checks automatically at startup.
ipcMain.handle('updates:check', async () => { lastCheck = await updates.check(); return lastCheck; });
let lastCheck = null;
// In-app installer download (progress streamed to the requesting window). Uses ONLY the
// download URL from the last check — the renderer never supplies a URL.
ipcMain.handle('updates:download', async (e) => {
  if (!lastCheck?.newer || !lastCheck.downloadUrl) return { error: 'Check for updates first.' };
  return updates.downloadInstaller(lastCheck.downloadUrl, {
    destDir: app.getPath('downloads'),
    onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send('updates:progress', p); },
  });
});
// Opens the installer downloaded above — and only that exact file.
ipcMain.handle('updates:openInstaller', async () => {
  const p = updates.lastDownload();
  if (!p || !fs.existsSync(p)) return { error: 'The downloaded installer is no longer there.' };
  const { shell } = require('electron');
  const err = await shell.openPath(p);
  return err ? { error: err } : { ok: true };
});
// One-click install of the file downloaded above (updates.cjs validates that it is exactly
// that file), then a relaunch into the new version: relaunch() registers the fresh start
// and this process quits, so the new instance begins only after the package files are fully
// replaced. Where no silent install exists (macOS), fall back to opening the downloaded
// file — the same behaviour as updates:openInstaller.
ipcMain.handle('updates:install', async () => {
  const r = await updates.installDownloaded({ destDir: app.getPath('downloads') });
  if (r.unsupported) {
    const p = updates.lastDownload();
    if (!p || !fs.existsSync(p)) return { error: 'The downloaded installer is no longer there.' };
    const { shell } = require('electron');
    const err = await shell.openPath(p);
    return err ? { error: err } : { ok: true, opened: true };
  }
  if (r.error) return r;
  app.relaunch();
  setTimeout(() => app.quit(), 300);
  return { ok: true, restarting: true };
});

// ---- Anonymous usage statistics: opt-in, see telemetry.cjs. ----
const telemetry = require("./system/telemetry.cjs");
ipcMain.handle('telemetry:status', () => telemetry.getStatus());
ipcMain.handle('telemetry:setConsent', (_e, on) => telemetry.setConsent(on === true));

// ---- Text to speech: Piper, ElevenLabs and Gemini. Keys stay in the main process. ----
const tts = require("./audio/tts.cjs");
const geminiTts = require("./audio/geminiTts.cjs");
const ttsDir = () => path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'tts');
const ttsOut = () => path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'voiceovers');
const ttsWords = (text) => String(text || '').trim().split(/\s+/).slice(0, 5).join(' ').replace(/[\\/:*?"<>|]+/g, '');
ipcMain.handle('tts:status', () => ({ ...tts.piperStatus(ttsDir()), elevenKey: !!settings.getServiceKey('elevenlabs'),
  geminiKey: !!settings.getServiceKey('gemini-tts'), gemini: geminiTts.catalog() }));
ipcMain.handle('tts:geminiTestKey', async (_e, key) => {
  try { return await geminiTts.testKey(net.fetch, String(key || '').trim() || settings.getServiceKey('gemini-tts')); }
  catch (e) { return { ok: false, text: e.message }; }
});
ipcMain.handle('tts:elevenVoices', (event, opts = {}) => withAgentJob(event, opts.requestId, async signal => {
  try {
    return { voices: await tts.elevenVoices(scopedFetch(net.fetch, signal), settings.getServiceKey('elevenlabs')) };
  } catch (e) {
    return { error: e.message };
  }
}));
ipcMain.handle('tts:elevenUsage', async () => {
  try {
    return { usage: await tts.elevenUsage(net.fetch, settings.getServiceKey('elevenlabs')) };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('tts:testKey', async (_e, key) => {
  try {
    const k = String(key || '').trim() || settings.getServiceKey('elevenlabs');
    const v = await tts.elevenVoices(net.fetch, k);
    // A key without the "User" read permission cannot see its credits; the voices still work.
    const u = await tts.elevenUsage(net.fetch, k).catch(() => null);
    const credits = u ? ` ${u.left.toLocaleString('en-US')} of ${u.limit.toLocaleString('en-US')} credits left this month.` : '';
    return { ok: true, text: `ElevenLabs works (${v.length} voices).${credits}` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
});
// Speaks the text and returns a media item (the file stays in <userData>/voiceovers).
ipcMain.handle('tts:speak', (event, req) => withAgentJob(event, req?.requestId, async signal => {
  try {
    if (!req || !['piper', 'eleven', 'gemini'].includes(req.engine)) return { error: 'Choose a supported speech engine.' };
    const send = (stage, fraction, extra) => { if (win && !win.isDestroyed()) win.webContents.send('tts:progress', { stage, fraction, ...extra }); };
    let file, waited = 0;
    if (req.engine === 'gemini') {
      send('speech', 0);
      const onWait = (seconds) => { waited += seconds; send('wait', 0, { seconds }); };
      file = await geminiTts.speak(scopedFetch(net.fetch, signal), settings.getServiceKey('gemini-tts'), ttsOut(), { ...req, signal, onWait });
    } else if (req.engine === 'eleven') {
      send('voice', 0);
      file = await tts.elevenSpeak(scopedFetch(net.fetch, signal), settings.getServiceKey('elevenlabs'), ttsOut(), { ...req, signal });
    } else {
      // Piper's engine and voices are downloaded in Settings > Voice, never on the way.
      send('voice', 1);
      file = await tts.piperSpeak(ttsDir(), ttsOut(), { ...req, signal });
    }
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const words = ttsWords(req.text);
    const credit = req.engine === 'gemini'
      ? { license: 'gemini', providerName: 'Google Gemini', creator: req.voiceId || geminiTts.DEFAULT_VOICE, line: 'Speech generated with Google Gemini TTS' }
      : req.engine === 'eleven'
      ? { license: 'elevenlabs', providerName: 'ElevenLabs', creator: req.voiceName || 'ElevenLabs voice', line: 'Voice generated with ElevenLabs (elevenlabs.io)' }
      : { license: 'piper', providerName: 'Piper', creator: req.voiceName || req.voiceId, line: `Voice: Piper ${req.voiceId}` };
    return { ...m, origin: 'tts', name: `Voice - ${words || 'text'}${path.extname(file)}`, credit, ...(waited ? { waited_sec: Math.round(waited) } : {}) };
  } catch (e) {
    return { error: e.message, ...(e.limit ? { limit: e.limit } : {}) };
  }
}));
// Piper voices on this computer (Settings > Voice): download the engine or a voice (one at a time, with progress
// and Cancel), or remove it. target: 'engine' or a voice id.
const piperJobs = new Map(); // target -> AbortController
ipcMain.handle('tts:piperDownload', async (_event, target) => {
  if (typeof target !== 'string' || !target) return { error: 'Nothing to download.' };
  if (piperJobs.size) return { error: 'Another download is running. Wait for it, or cancel it.' };
  const controller = new AbortController();
  piperJobs.set(target, controller);
  const send = (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('tts:piperProgress', { target, fraction }); };
  try {
    await tts.piperDownload(scopedFetch(net.fetch, controller.signal), ttsDir(), target, send, { signal: controller.signal });
    return { ok: true, status: tts.piperStatus(ttsDir()) };
  } catch (e) {
    return controller.signal.aborted ? { canceled: true, status: tts.piperStatus(ttsDir()) } : { error: e.message, status: tts.piperStatus(ttsDir()) };
  } finally { piperJobs.delete(target); }
});
ipcMain.handle('tts:piperCancel', (_event, target) => { piperJobs.get(target)?.abort(); return true; });
ipcMain.handle('tts:piperRemove', (_event, target) => {
  if (piperJobs.has(target)) return { error: 'Cancel the download first.' };
  try { tts.piperRemove(ttsDir(), String(target)); return { ok: true, status: tts.piperStatus(ttsDir()) }; }
  catch (e) { return { error: e.message, status: tts.piperStatus(ttsDir()) }; }
});
// Several narration lines from one Gemini request, cut into one audio item per line (audio/narration.cjs).
ipcMain.handle('tts:speakLines', (event, req) => withAgentJob(event, req?.requestId, async signal => {
  try {
    const lines = Array.isArray(req?.lines) ? req.lines.map((t) => String(t ?? '')) : [];
    const send = (stage, extra) => { if (win && !win.isDestroyed()) win.webContents.send('tts:progress', { stage, fraction: 0, ...extra }); };
    const key = settings.getServiceKey('gemini-tts'), voiceId = req?.voiceId || geminiTts.DEFAULT_VOICE, model = req?.model || geminiTts.DEFAULT_MODEL;
    if (lines.join('\n\n').length > geminiTts.MAX_TEXT) return { error: `Keep one narration to ${geminiTts.MAX_TEXT} characters in total; split it into two add_narration calls.` };
    let waited = 0;
    const onWait = (seconds) => { waited += seconds; send('wait', { seconds }); };
    send('speech');
    const out = await require('./audio/narration.cjs').speakLines({ ffmpegPath: require('./media/ffmpeg.cjs').ffmpegPath, outDir: ttsOut(), lines, style: req?.style,
      cacheKey: ['gemini', model, voiceId], signal,
      speak: (text, style) => geminiTts.speak(scopedFetch(net.fetch, signal), key, ttsOut(), { text, voiceId, model, style, signal, onWait }) });
    const probed = await probeAll(out.files);
    const bad = probed.find((m) => m.error);
    if (bad) return { error: bad.error };
    const credit = { license: 'gemini', providerName: 'Google Gemini', creator: voiceId, line: 'Speech generated with Google Gemini TTS' };
    return { items: probed.map((m, i) => ({ ...m, origin: 'tts', name: `Voice ${i + 1} - ${ttsWords(lines[i]) || 'text'}.wav`, credit })),
      mode: out.mode, requests: out.requests, ...(waited ? { waited_sec: Math.round(waited) } : {}) };
  } catch (e) {
    return { error: e.message, ...(e.limit ? { limit: e.limit } : {}) };
  }
}));

// ---- AI video and photo generation (ElevenLabs, the user's key; the API needs a Pro plan). Files stay in
// <userData>/generated with a small .json describing each one. ----
const gen = require("./library/gen.cjs");
const genDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'generated-test') : path.join(app.getPath('userData'), 'generated'));
const genJobs = new Map(); // job id -> AbortController
ipcMain.handle('gen:status', async () => {
  const key = settings.getServiceKey('elevenlabs');
  if (!key) return { hasKey: false };
  // A key without the "User" read permission cannot see its plan: generation is then simply tried.
  const u = await tts.elevenUsage(net.fetch, key).catch(() => null);
  return { hasKey: true, tier: u?.tier || '', pro: gen.isPro(u?.tier), left: u?.left ?? null, limit: u?.limit ?? null, proUrl: gen.PRO_URL };
});
ipcMain.handle('gen:models', () => gen.catalog());
ipcMain.handle('gen:list', () => gen.list(genDir()));
// Speech for a talking avatar must be MP3 or WAV: other audio (a recorded voice-over is M4A) is converted once.
const speechFile = async (file) => {
  if (gen.AUDIO_TYPES[path.extname(file).toLowerCase()]) return file;
  const out = path.join(genDir(), 'speech', `${path.basename(file, path.extname(file))}.mp3`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await new Promise((resolve, reject) => require('child_process').execFile(require("./media/ffmpeg.cjs").ffmpegPath,
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', out],
    { windowsHide: true }, (e) => (e ? reject(new Error('Could not read this audio.')) : resolve())));
  return out;
};
ipcMain.handle('gen:run', async (_e, jobId, kind, opts = {}) => {
  const ctl = new AbortController();
  genJobs.set(jobId, ctl);
  try {
    const onStatus = (stage) => { if (win && !win.isDestroyed()) win.webContents.send('gen:progress', { jobId, stage }); };
    const key = settings.getServiceKey('elevenlabs');
    let o = opts;
    if (kind === 'avatar') {
      // Typed text is spoken first with the chosen ElevenLabs voice.
      if (o.text) {
        onStatus('voicing');
        o = { ...o, audio: await tts.elevenSpeak(net.fetch, key, ttsOut(), { voiceId: o.voiceId, text: o.text }) };
      } else if (o.audio) o = { ...o, audio: await speechFile(o.audio) };
    }
    return await gen.run(net.fetch, key, genDir(), kind, o, { onStatus, signal: ctl.signal });
  } catch (e) {
    return { error: e.message, code: e.code || '' };
  } finally {
    genJobs.delete(jobId);
  }
});
ipcMain.handle('gen:stop', (_e, jobId) => genJobs.get(jobId)?.abort());

// ---- Asset pack library: folder-backed (electron/library/assets.cjs). The folder is created on
// first read so the panels can name a real path in their empty state. ----
const assets = require("./library/assets.cjs");
ipcMain.handle('assets:list', () => {
  const root = assets.assetsRoot(app.getPath('userData'), process.env);
  assets.ensureRoot(root);
  return assets.readLibraryFor(app.getPath('userData'), process.env, process.resourcesPath);
});

// ---- First run: the Welcome card, shown once (flags in settings.json —
// electron/system/settings.cjs). ----
ipcMain.handle('firstrun:get', () => settings.getFirstRun());
ipcMain.handle('firstrun:set', (_e, patch) => settings.setFirstRun(patch));

// My avatars: photos of people reused in every project (<userData>/avatars).
const avatarDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'avatars-test') : path.join(app.getPath('userData'), 'avatars'));
ipcMain.handle('avatars:list', () => gen.avatarList(avatarDir()));
ipcMain.handle('avatars:add', async (_e, file) => {
  try {
    let files = file ? [file] : [];
    if (!file) {
      const res = await dialog.showOpenDialog(win, { title: 'Add avatar photos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
      if (res.canceled) return { list: gen.avatarList(avatarDir()) };
      files = res.filePaths;
    }
    const added = files.map((f) => gen.avatarAdd(avatarDir(), f));
    return { list: gen.avatarList(avatarDir()), added };
  } catch (e) {
    return { error: e.message, list: gen.avatarList(avatarDir()) };
  }
});
ipcMain.handle('avatars:remove', (_e, file) => {
  try {
    gen.avatarRemove(avatarDir(), file);
  } catch {
    // not an avatar: nothing to remove
  }
  return gen.avatarList(avatarDir());
});

// ---- Templates: the remote store, and the package flow. ----
const templates = require("./library/templates.cjs");
const bundledTemplates = require("./library/bundledTemplates.cjs");
const tplCache = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'templates-test') : path.join(app.getPath('userData'), 'templates'));
const tplCall = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (e) {
    return { error: e.message };
  }
};
ipcMain.handle('templates:list', tplCall((_e, params) => templates.list(net.fetch, params)));
// Bundled templates (ship with the app, fully offline): list from disk, open from disk.
ipcMain.handle('templates:bundledList', () => bundledTemplates.list(path.join(__dirname, '..')));
ipcMain.handle('templates:bundledUse', tplCall(async (_e, slug) => {
  const { json } = bundledTemplates.use(path.join(__dirname, '..'), slug);
  const pf = require("./project/projectfile.cjs");
  return { json: await pf.refreshSizes(pf.checkGenerated(json, mediaCacheDir()), probe) };
}));
ipcMain.handle('templates:thumb', (_e, t) => templates.thumb(net.fetch, tplCache(), t));
ipcMain.handle('templates:preview', tplCall(async (_e, t) => ({ path: await templates.preview(net.fetch, tplCache(), t) })));
// Downloads a template and returns it as a project, like project:open (it has no file until saved).
ipcMain.handle('templates:use', tplCall(async (_e, id) => {
  const send = (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('templates:progress', { id, fraction }); };
  const { json } = await templates.download(net.fetch, tplCache(), id, send);
  templates.use(net.fetch, id);
  const pf = require("./project/projectfile.cjs");
  return { json: await pf.refreshSizes(pf.checkGenerated(json, mediaCacheDir()), probe) };
}));
// Export > Template package: asks for a folder and writes the package into a new subfolder.
ipcMain.handle('templates:pack', tplCall(async (_e, projectJson, meta) => {
  let parent = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'packages') : null;
  if (!parent) {
    const res = await dialog.showOpenDialog(win, { title: 'Choose where to write the template package', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled) return null;
    parent = res.filePaths[0];
  }
  fs.mkdirSync(parent, { recursive: true });
  return templates.pack(JSON.parse(projectJson), meta, parent, { ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath });
}));
ipcMain.handle('shell:openFolder', (_e, dir) => (fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? shell.openPath(dir) : false));

// ---- Stock photos and videos (Pixabay). The key stays in this process. ----
const stock = require("./library/stock.cjs");
// UI tests keep their (fake) downloads apart from the real library.
const stockDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'library-test') : path.join(app.getPath('userData'), 'library'));
// Tests a typed key (or the saved one) with a tiny search.
ipcMain.handle('stock:test', async (_e, key) => {
  try {
    const k = String(key || '').trim() || settings.getServiceKey('pixabay');
    const r = await stock.search(net.fetch, k, { kind: 'photo', q: `nature ${Date.now() % 7}` });
    return { ok: true, text: `Pixabay works (${r.total} photos for a test search).` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
});
ipcMain.handle('stock:search', (event, opts = {}) => withAgentJob(event, opts.requestId, async signal => {
  try {
    return await stock.search(scopedFetch(net.fetch, signal), settings.getServiceKey('pixabay'), opts || {});
  } catch (e) {
    return { error: e.message };
  }
}));
ipcMain.handle('stock:thumb', async (_e, url) => {
  try {
    return { path: await stock.thumbnail(net.fetch, stockDir(), url) };
  } catch (e) {
    return { error: e.message };
  }
});
// Background pictures for scenes without footage (CraftAI's add_scene), kept with the library downloads.
ipcMain.handle('scene:make', async (_e, opts) => {
  try {
    const file = await require("./media/ffmpeg.cjs").makeScene(opts || {}, path.join(stockDir(), 'scenes'));
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const o = opts || {};
    return { ...m, name: `Background ${o.color}${o.color2 ? `-${o.color2}` : ''}.png` };
  } catch (e) {
    return { error: e.message };
  }
});

// Stabilization (vid.stab, electron/media/stabilize.cjs): one clip at a time; the stabilized copy comes back as a media item.
const { stabilize } = require("./media/stabilize.cjs");
let stabJob = null;
ipcMain.handle('stabilize:run', async (_e, item, from, to, level) => {
  if (stabJob) return { error: 'Another clip is being stabilized.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
  const job = { canceled: false };
  stabJob = job;
  try {
    const out = await stabilize(item, {
      from, to, level, cacheDir: mediaCacheDir(), ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath, toSdr: require("./media/ffmpeg.cjs").toSdr,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('stabilize:progress', { path: item.path, fraction }); },
    });
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the stabilized video.' };
    return { ...m, name: `${path.basename(item.path).replace(/\.[^.]+$/, '')} (stabilized).mp4` };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    stabJob = null;
  }
});
ipcMain.handle('stabilize:cancel', () => { if (stabJob) stabJob.canceled = true; });

// Motion tracking (electron/media/track.cjs): one job at a time; the path comes back to the renderer, which
// stores it on the clip. The render is cached by file, range, pick and box, like the other derivatives.
const { trackMotion } = require("./media/track.cjs");
let trackJob = null;
ipcMain.handle('track:run', async (_e, item, from, to, pick, box) => {
  if (trackJob) return { error: 'Another clip is being tracked.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
  if (!pick || !Number.isFinite(pick.x) || !Number.isFinite(pick.y)) return { error: 'No point to track.' };
  const job = { canceled: false };
  trackJob = job;
  try {
    const res = await trackMotion(item, {
      from, to, pick, box: box || { w: 0.055, h: 0.095 }, cacheDir: mediaCacheDir(), ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('track:progress', { path: item.path, fraction }); },
    });
    return { points: res.points, fps: res.fps, frames: res.raw, cached: !!res.cached };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    trackJob = null;
  }
});
ipcMain.handle('track:cancel', () => { if (trackJob) trackJob.canceled = true; });

// Reverse (context menu, item 12): same one-job-at-a-time derivative-render pattern.
const { reverse } = require("./media/reverse.cjs");
let revJob = null;
ipcMain.handle('reverse:run', async (_e, item, from, to) => {
  if (revJob) return { error: 'Another clip is being reversed.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  revJob = job;
  try {
    const out = await reverse(item, {
      from, to, hasVideo: item.type !== 'audio', cacheDir: mediaCacheDir(), ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath, toSdr: require("./media/ffmpeg.cjs").toSdr,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('reverse:progress', { path: item.path, fraction }); },
    });
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the reversed video.' };
    return { ...m, name: `${path.basename(item.path).replace(/\.[^.]+$/, '')} (reversed).mp4` };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    revJob = null;
  }
});
ipcMain.handle('reverse:cancel', () => { if (revJob) revJob.canceled = true; });

// Detach audio (clip menu): render a video clip's sound into its own audio file, cached
// like the reverse renders. The project then holds it as a linked audio clip.
const { detach } = require("./media/detach.cjs");
let detachJob = null;
ipcMain.handle('detach:run', async (_e, item, from, to) => {
  if (detachJob) return { error: 'Another clip is being detached.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  detachJob = job;
  try {
    const out = await detach(item, {
      from, to, cacheDir: mediaCacheDir(), ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('detach:progress', { path: item.path, fraction }); },
    });
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the detached audio.' };
    return { ...m, name: `${path.basename(item.path).replace(/\.[^.]+$/, '')} (detached).wav` };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    detachJob = null;
  }
});
ipcMain.handle('detach:cancel', () => { if (detachJob) detachJob.canceled = true; });

// Voice Enhancer (clip Audio tab): render the clip's sound cleaned (electron/media/enhance.cjs,
// cached like the detach renders). The clip then plays / exports the enhanced file.
const { enhance } = require("./media/enhance.cjs");
let enhanceJob = null;
ipcMain.handle('enhance:run', async (_e, item, from, to, strength) => {
  if (enhanceJob) return { error: 'Another clip is being enhanced.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  enhanceJob = job;
  try {
    const res = await enhance(item, {
      from, to, strength, cacheDir: mediaCacheDir(), ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('enhance:progress', { path: item.path, fraction }); },
    });
    return { path: res.path };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    enhanceJob = null;
  }
});
ipcMain.handle('enhance:cancel', () => { if (enhanceJob) enhanceJob.canceled = true; });

// Freeze frame (context menu, item 12): grab one frame of a media file as a PNG still the
// project can hold. Cached by file + time; the file lands in the media cache like other stills.
ipcMain.handle('media:frameImage', async (_e, mediaPath, at) => {
  const { execFile } = require('child_process');
  const { ffmpegPath } = require("./media/ffmpeg.cjs");
  try {
    if (!fs.existsSync(mediaPath)) return { error: 'The media file was not found.' };
    const st = fs.statSync(mediaPath);
    const key = require('crypto').createHash('sha1').update(`${mediaPath}|${st.size}|${st.mtimeMs}|frame|${Number(at).toFixed(2)}`).digest('hex').slice(0, 16);
    const dir = mediaCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${key}-frame.png`);
    if (!fs.existsSync(out)) {
      await new Promise((resolve, reject) => execFile(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Number(at) || 0)), '-i', mediaPath, '-frames:v', '1', out], (e) => (e ? reject(e) : resolve())));
    }
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the frozen frame.' };
    return m;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('stock:add', (event, item, opts = {}) => withAgentJob(event, opts.requestId, async signal => {
  try {
    const file = await stock.download(scopedFetch(net.fetch, signal), stockDir(), item);
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const name = `${(item.tags || 'pixabay').split(',')[0].trim() || 'pixabay'} ${item.id}.${path.extname(file).slice(1)}`;
    return { ...m, name, credit: { license: 'pixabay', providerName: 'Pixabay', creator: item.user, landing: item.pageURL, line: stock.creditLine(item) } };
  } catch (e) {
    return { error: e.message };
  }
}));
// Tests the typed (not yet saved) values when given, otherwise the saved configuration.
const draftConfig = (draft = {}) => {
  return ai.resolveDraft(settings.getActive(draft.provider), draft);
};
ipcMain.handle('ai:test', (_e, draft) => ai.testConnection(draftConfig(draft)));
ipcMain.handle('ai:models', (_e, draft) => ai.listModels(draftConfig(draft),{refresh:!!draft?.refresh}));
ipcMain.handle('ai:modelCapabilities', (_e, draft) => ai.modelCapabilities(draftConfig(draft), { refresh: !!draft?.refresh }));
ipcMain.handle('ai:sdkStatus', async (_e, draft) => {
  const cfg = draftConfig(draft);
  return { ...await localAgents.status(cfg), runtime: agentRuntimes.describe(cfg.provider) };
});
ipcMain.handle('ai:runtimeInstall', async (event, provider) => {
  if (!localAgents.isProvider(provider)) return { ok:false, error:'Unknown agent provider.' };
  const owner = event.sender.id;
  const gone = () => agentRuntimes.cancelOwner(owner);
  event.sender.once('destroyed', gone);
  try { return await agentRuntimes.install(provider, owner); }
  finally { if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', gone); }
});
ipcMain.handle('ai:runtimeCancel', (event, provider) => { if (localAgents.isProvider(provider)) agentRuntimes.cancel(provider, event.sender.id); });
ipcMain.handle('ai:pickExecutable', async (_e, provider) => {
  if (!localAgents.isProvider(provider)) return null;
  const res = await dialog.showOpenDialog(win, { title: `Choose the installed ${localAgents.PROVIDERS[provider].cli} executable`, properties: ['openFile'] });
  return res.canceled ? null : res.filePaths[0] || null;
});

// ---- LUTs (.cube): the bundled ones in shared/luts, or a file the user picked. ----
const LUT_DIR = path.join(__dirname, '..', 'shared', 'luts');
ipcMain.handle('lut:read', (_e, ref) => {
  try {
    let file;
    if (ref && ref.bundled) {
      if (!/^[\w.-]+\.cube$/i.test(ref.bundled)) return { error: 'Unknown LUT' };
      file = path.join(LUT_DIR, ref.bundled);
    } else if (ref && ref.path) {
      if (!/\.cube$/i.test(ref.path)) return { error: 'Only .cube LUT files are supported.' };
      file = ref.path;
    } else return { error: 'No LUT' };
    if (!fs.existsSync(file)) return { error: `LUT file not found: ${path.basename(file)}` };
    if (fs.statSync(file).size > 60 * 1024 * 1024) return { error: 'This LUT file is too big.' };
    return { text: fs.readFileSync(file, 'utf8') };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('lut:import', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Import a LUT', properties: ['openFile'], filters: [{ name: '3D LUT', extensions: ['cube'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  return { path: file, name: path.basename(file).replace(/\.cube$/i, '') };
});

// ---- CraftAI agent: one model step per call; tools run in the interface, heavy ones call back here. ----
// If the provider fails, the step goes to the next one with a saved key (Gemini, Groq, OpenAI-compatible).
// req.provider: the provider that answered the previous step of this request, so a run stays on it.
const agentRequests = new Map();
const nativeRuns = new Map();
const nativeOwners = new Set();
const frameRenderJobs = new Map();
ipcMain.handle('agent:frameJob',event=>{
  const job=frameRenderJobs.get(event.sender.id);
  if(!job)throw new Error('Unknown frame inspection renderer.');
  return job.plan;
});
ipcMain.handle('agent:frameReady',(event,error)=>{
  const job=frameRenderJobs.get(event.sender.id);
  if(!job)throw new Error('Unknown frame inspection renderer.');
  error?job.reject(new Error(String(error).slice(0,1000))):job.resolve();
});
async function captureTimelineFrame(plan,signal){
  if(signal?.aborted)throw Object.assign(new Error('Frame inspection stopped.'),{name:'AbortError'});
  const renderer=new BrowserWindow({width:plan.width,height:plan.height,useContentSize:true,show:false,frame:false,
    webPreferences:{preload:path.join(__dirname,"./agents/framePreload.cjs"),contextIsolation:true,nodeIntegration:false,
      webSecurity:!process.env.VITE_DEV_SERVER_URL,offscreen:true,backgroundThrottling:false}});
  const id=renderer.webContents.id;
  let timer,abort;
  try{
    const ready=new Promise((resolve,reject)=>{
      frameRenderJobs.set(id,{plan,resolve,reject});
      timer=setTimeout(()=>reject(new Error('Frame inspection renderer timed out.')),25000);
      abort=()=>reject(Object.assign(new Error('Frame inspection stopped.'),{name:'AbortError'}));
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      renderer.webContents.once('render-process-gone',()=>reject(new Error('Frame inspection renderer stopped.')));
    });
    // Start loading without leaving an unhandled rejection while the ready job waits.
    const loading=process.env.VITE_DEV_SERVER_URL?renderer.loadURL(process.env.VITE_DEV_SERVER_URL):renderer.loadFile(path.join(__dirname,'..','dist','index.html'));
    loading.catch(error=>frameRenderJobs.get(id)?.reject(error));
    await ready;
    const image=await renderer.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    if(signal?.aborted)throw Object.assign(new Error('Frame inspection stopped.'),{name:'AbortError'});
    if(image.isEmpty())throw new Error('The preview frame was empty.');
    return image.resize({width:plan.width,height:plan.height,quality:'best'}).toJPEG(88);
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);frameRenderJobs.delete(id);
    if(!renderer.isDestroyed())renderer.destroy();
  }
}
const {AgentFrames}=require("./agents/agentFrames.cjs");
const agentFrames=new AgentFrames(captureTimelineFrame);
const { ChatImages, EXTENSIONS: CHAT_IMAGE_EXTENSIONS } = require('./agents/chatImages.cjs');
const chatImages = new ChatImages(path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'chat-images'), { nativeImage, BrowserWindow });
ipcMain.handle('agent:attachImages', async (event, items) => {
  const controller = new AbortController(), stop = () => controller.abort();
  event.sender.once('destroyed', stop);
  try {
    if (items == null) {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Attach images to CraftAI', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: CHAT_IMAGE_EXTENSIONS }, { name: 'All files', extensions: ['*'] }],
      });
      if (result.canceled) return { images: [], errors: [] };
      items = result.filePaths.map(file => ({ path: file }));
    }
    return await chatImages.add(items, controller.signal);
  } catch (error) { return { images: [], errors: [{ name: '', error: error.message }] }; }
  finally { if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', stop); }
});
ipcMain.handle('agent:imagePreview', async (_event, id) => { try { return { url: await chatImages.preview(id) }; } catch (error) { return { error: error.message }; } });
ipcMain.handle('agent:validateImages', async (_event, ids) => { try { await chatImages.validate(ids); return { ok: true }; } catch (error) { return { error: error.message }; } });
const agentRequestKey = (event, id) => `${event.sender.id}:${String(id || 'legacy').slice(0, 100)}`;
ipcMain.handle('agent:cancel', (event, requestId) => {
  const key = agentRequestKey(event, requestId);
  nativeRuns.get(key)?.controller.abort();
  agentRequests.get(key)?.abort();
});
app.on('before-quit', () => { externalAgents.stop().catch(() => {}); agentRuntimes.close(); for (const job of nativeRuns.values()) job.controller.abort(); for (const controller of agentRequests.values()) controller.abort(); localAgents.closeNativeSessions(); agentFrames.dispose(); });
// Tile 2–6 already captured frames into one numbered contact sheet (see agentFrames.cjs).
ipcMain.handle('agent:frameSheet',async(event,req={})=>{
  try{return await agentFrames.sheet(event.sender.id,req.frame_ids,{revision:req.revision});}
  catch(error){return {error:error.message};}
});
ipcMain.handle('agent:inspectFrames',async(event,req)=>{
  const key=agentRequestKey(event,req?.requestId);
  if(agentRequests.has(key))return {error:'This assistant request is already running.'};
  const controller=new AbortController();agentRequests.set(key,controller);
  const onDestroyed=()=>{controller.abort();agentFrames.clearOwner(event.sender.id);};
  event.sender.once('destroyed',onDestroyed);
  try{return await agentFrames.inspect(event.sender.id,req,controller.signal);}
  catch(error){return {error:error.message,...(controller.signal.aborted?{canceled:true}:{})};}
  finally{agentRequests.delete(key);if(!event.sender.isDestroyed())event.sender.removeListener('destroyed',onDestroyed);}
});
const { MediaAnalysis, fileFingerprint } = require("./media/mediaAnalysis.cjs");
const sceneAnalysis = new MediaAnalysis(path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'scene-analysis'));
ipcMain.handle('agent:analyzeScenes', async(event,req)=>{
  const key=agentRequestKey(event,req?.requestId);
  if(agentRequests.has(key))return {error:'This assistant request is already running.'};
  const controller=new AbortController();agentRequests.set(key,controller);
  const destroyed=()=>controller.abort();event.sender.once('destroyed',destroyed);
  try{
    if(!Array.isArray(req?.project?.media)||!Array.isArray(req.media_ids)||!req.media_ids.length||req.media_ids.length>100)throw new Error('Select one to 100 media IDs for scene analysis.');
    const analyses=[];
    for(const id of [...new Set(req.media_ids)]){
      const media=req.project.media.find(m=>m.id===id);if(!media)throw new Error('Scene source no longer exists.');
      const index=await sceneAnalysis.analyze(media,req.options,controller.signal);analyses.push({media_id:id,...index});
    }
    let audio_key;
    if(req.audio_selection)try{audio_key=require("./media/ffmpeg.cjs").audioAnalysisKey(req.project,req.audio_selection);}catch{}
    return {analyses,audio_key};
  }catch(error){return {error:error.message,...(controller.signal.aborted?{canceled:true}:{})};}
  finally{agentRequests.delete(key);if(!event.sender.isDestroyed())event.sender.removeListener('destroyed',destroyed);}
});
// Reference videos attached to CraftAI, and the edit fingerprint of a reference
// (electron/media/editStyle.cjs): how it is cut, measured locally, never uploaded.
const { ChatVideos, VIDEO_EXTENSIONS } = require('./agents/chatVideos.cjs');
const chatVideos = new ChatVideos(path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'chat-videos'),
  { ffmpegPath: require('./media/ffmpeg.cjs').ffmpegPath, probe: require('./media/ffmpeg.cjs').probe, fingerprint: fileFingerprint });
ipcMain.handle('agent:attachVideos', async (event, items) => {
  try {
    if (items == null) {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Attach reference videos to CraftAI', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Videos', extensions: VIDEO_EXTENSIONS }],
      });
      if (result.canceled) return { videos: [], errors: [] };
      items = result.filePaths.map(file => ({ path: file }));
    }
    return await chatVideos.add(items);
  } catch (error) { return { videos: [], errors: [{ name: '', error: error.message }] }; }
});
ipcMain.handle('agent:pickAttachments', async (event) => {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Attach images or reference videos to CraftAI', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and videos', extensions: [...CHAT_IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] }, { name: 'Images', extensions: CHAT_IMAGE_EXTENSIONS }, { name: 'Videos', extensions: VIDEO_EXTENSIONS }],
    });
    if (result.canceled) return { images: [], videos: [], errors: [] };
    const isVideo = file => VIDEO_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
    const videoPaths = result.filePaths.filter(isVideo), imagePaths = result.filePaths.filter(file => !isVideo(file));
    const images = imagePaths.length ? await chatImages.add(imagePaths.map(file => ({ path: file }))).catch(error => ({ images: [], errors: [{ name: '', error: error.message }] })) : { images: [], errors: [] };
    const videos = videoPaths.length ? await chatVideos.add(videoPaths.map(file => ({ path: file }))).catch(error => ({ videos: [], errors: [{ name: '', error: error.message }] })) : { videos: [], errors: [] };
    return { images: images.images, videos: videos.videos, errors: [...images.errors, ...videos.errors] };
  } catch (error) { return { images: [], videos: [], errors: [{ name: '', error: error.message }] }; }
});
ipcMain.handle('agent:videoPreview', (_event, id) => chatVideos.preview(id).catch(error => ({ error: error.message })));
ipcMain.handle('agent:validateVideos', async (_event, ids) => { try { await chatVideos.validate(ids); return { ok: true }; } catch (error) { return { error: error.message }; } });
let editStyleService = null;
const editStyle = () => editStyleService ||= require('./media/editStyle.cjs').createEditStyle({
  ffmpegPath: require('./media/ffmpeg.cjs').ffmpegPath, probe: require('./media/ffmpeg.cjs').probe,
  analyzeSamples: require('./audio/rhythm.cjs').analyzeSamples, fingerprint: fileFingerprint,
  spawnDecoder: require('./export/framePipes.cjs').spawnDecoder,
  cacheDir: path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'edit-style'),
  // Speech pacing of a reference, with the local speech model when it is installed.
  transcribe: async (file, { seconds, signal }) => {
    const dir = whisperDir();
    if (!whisper.status(dir).installed) throw new Error('the local speech model is not installed (Settings › Voice).');
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'clipcraft-reference-speech-'));
    try {
      const wav = path.join(tmp, 'speech.wav');
      await new Promise((resolve, reject) => {
        const p = require('node:child_process').spawn(require('./media/ffmpeg.cjs').ffmpegPath, ['-hide_banner', '-v', 'error', '-y', '-i', file, '-t', String(seconds), '-vn', '-ac', '1', '-ar', '16000', wav], { windowsHide: true, stdio: 'ignore', signal });
        p.once('error', reject); p.once('close', code => code === 0 ? resolve() : reject(new Error('Could not read the reference audio.')));
      });
      // Segments keep their words: the timed transcript and the speech pacing both come from them.
      return (await whisper.transcribe(dir, wav, { language: 'auto', maxLen: 0, signal }))
        .map(segment => ({ start: segment.start, end: segment.end, text: segment.text, words: segment.words || [] }));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  },
});
ipcMain.handle('agent:analyzeReference', (event, req = {}) => withAgentJob(event, req.requestId, async signal => {
  let file, name;
  if (req.reference_id) { const meta = await chatVideos.get(req.reference_id); file = meta.path; name = meta.name; }
  else {
    const media = Array.isArray(req.project?.media) ? req.project.media.find(m => m.id === req.media_id) : null;
    if (!media || media.type !== 'video') throw new Error('Choose a video from the media library or an attached reference video.');
    file = media.path; name = media.name;
  }
  const { summarize } = require('./media/editStyle.cjs');
  const value = await editStyle().analyze(file, { speech: req.speech !== false, signal,
    onProgress: p => { if (!event.sender.isDestroyed()) event.sender.send('agent:referenceProgress', { requestId: req.requestId, progress: p }); } });
  return { ok: true, name, cached: value.cached, fingerprint: summarize(value, { transcriptFrom: Math.max(0, Number(req.transcript_from_sec) || 0) }), source: { path: file, width: value.frame.width, height: value.frame.height, duration: value.duration_sec } };
}));
ipcMain.handle('agent:annotateScene',async(event,req)=>{
  try{
    const media=req?.project?.media?.find(m=>m.id===req.media_id);if(!media)throw new Error('Unknown media source.');
    const index=sceneAnalysis.read(req.analysis_id),shot=index?.shots.find(s=>s.id===req.shot_id);
    if(!shot||index.fingerprint!==fileFingerprint(media.path))throw new Error('The source analysis is stale. Analyse the current source again.');
    const frames=agentFrames.evidence(event.sender.id,req.frame_ids,req.requestId);
    if(frames.some(f=>f.source==='timeline'||f.media_id!==media.id||f.fingerprint!==index.fingerprint||f.source_time_sec<shot.start_sec||(!(['image'].includes(media.type))&&f.source_time_sec>=shot.end_sec)))throw new Error('Evidence must show the same source shot and current source file.');
    const active=settings.getActive();
    return {shot:sceneAnalysis.annotate(req.analysis_id,req.shot_id,{description:req.description,tags:req.tags,evidence:frames.map(f=>({source_time_sec:f.source_time_sec,image_hash:f.image_hash,source_fingerprint:f.fingerprint})),provider:frames[0].presentedProvider||active.provider,model:frames[0].presentedModel||active.model})};
  }catch(error){return {error:error.message};}
});
ipcMain.handle('agent:step', async (event, req) => {
  const key = agentRequestKey(event, req?.requestId);
  if (externalHolder()) return { ok: false, error: externalHolder() };
  if (agentRequests.has(key)) return { ok: false, error: 'This assistant request is already running.' };
  const controller = new AbortController();
  agentRequests.set(key, controller);
  const onDestroyed = () => controller.abort();
  event.sender.once('destroyed', onDestroyed);
  try {
    const fb = require("./agents/aifallback.cjs");
    const active = settings.getActive();
    const first = fb.TOOL_PROVIDERS.includes(req.provider) || localAgents.isProvider(req.provider) ? req.provider : active.provider;
    if (localAgents.isProvider(first)) throw new Error('SDK editing now uses native tools. Restart ClipCraft to load the updated editor.');
    const keys = settings.getPublic().keys || {};
    const order = fb.TOOL_PROVIDERS.includes(first) ? fb.fallbackOrder(first, (p) => p === 'ollama' || !!keys[p]) : [first];
    // SDK choices are explicit: never silently send their conversations to an API
    // provider (or launch a local SDK as an API provider's fallback).
    const images=agentFrames.images(event.sender.id,req.frameIds||[]);
    await chatImages.validate(req.chatImageIds || []);
    const contents = await chatImages.hydrate(req.contents);
    const onSearch = search => {
      if (!event.sender.isDestroyed()) event.sender.send('agent:search', { ...search, requestId: req.requestId });
    };
    const { result, provider, failed } = await fb.withFallback(order, (p) => settings.getActive(p), (cfg) => ai.agentStep(cfg, { ...req, contents, images, onSearch, signal: controller.signal }));
    agentFrames.markPresented(event.sender.id,req.frameIds,req.requestId,provider,settings.getActive(provider).model);
    return {
      ok: true, ...result, provider, model: settings.getActive(provider).model,
      fellBack: failed.map((f) => ({ provider: f.provider, name: fb.NAMES[f.provider], reason: f.reason })),
    };
  } catch (e) {
    if (controller.signal.aborted || e.name === 'AbortError') return { ok: false, canceled: true };
    return { ok: false, error: e.message, link: e.link, linkLabel: e.linkLabel, suggestModel: e.suggestModel };
  } finally {
    agentRequests.delete(key);
    if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', onDestroyed);
  }
});
// Native SDK tasks keep their provider loop in the main process. Editor tools
// are routed back to exactly the renderer/request that owns the transaction.
ipcMain.handle('agent:nativeToolResult', (event, req) => {
  const job = nativeRuns.get(agentRequestKey(event, req?.requestId));
  const pending = job?.pending.get(req?.callId);
  if (!pending || job.controller.signal.aborted) return false;
  job.pending.delete(req.callId); job.lifetime.touch(); pending.resolve(req.result); return true;
});
ipcMain.handle('agent:runNative', async (event, req) => {
  const key = agentRequestKey(event, req?.requestId);
  if (nativeRuns.has(key) || agentRequests.has(key)) return { ok:false, error:'This assistant request is already running.' };
  if (externalHolder()) return { ok:false, error:externalHolder() };
  if (!localAgents.isProvider(req?.provider) || typeof req.requestId !== 'string' || !req.requestId || typeof req.sessionKey !== 'string' || !req.sessionKey || !Array.isArray(req.tools) || req.tools.length > 120) return { ok:false, error:'Invalid native editor request.' };
  const job = { controller:new AbortController(), pending:new Map(), calls:0 };
  nativeRuns.set(key, job);
  const stop = () => job.controller.abort();
  event.sender.once('destroyed', stop);
  const ownerId = event.sender.id;
  if (!nativeOwners.has(ownerId)) {
    nativeOwners.add(ownerId);
    event.sender.once('destroyed', () => { nativeOwners.delete(ownerId); localAgents.closeNativeOwner(`${ownerId}:`); });
  }
  job.lifetime = activityTimeout(() => {
    job.failure = { code:'edit_timeout', error:'The assistant made no tool progress for 30 minutes. Completed edits were kept. Continue from the current timeline.' };
    stop();
  }, 30 * 60 * 1000);
  const onAbort = () => {
    agentRequests.get(key)?.abort();
    for (const pending of job.pending.values()) pending.reject(Object.assign(new Error('Stopped.'), {name:'AbortError'}));
    job.pending.clear();
    if (!event.sender.isDestroyed()) event.sender.send('agent:nativeStop', {requestId:req.requestId, ...(job.failure ? {error:job.failure} : {})});
  };
  job.controller.signal.addEventListener('abort', onAbort, {once:true});
  const invoke = (name,args) => {
    checkAbort(job.controller.signal);
    job.lifetime.touch();
    if (event.sender.isDestroyed()) throw new Error('The editor window closed.');
    if (++job.calls > 240) { job.failure = {code:'edit_limit',error:'The assistant reached its tool-call limit. Completed edits were kept. Continue from the current timeline.'}; job.controller.abort(); throw new Error(job.failure.error); }
    const callId = require('node:crypto').randomUUID();
    return new Promise((resolve,reject) => {
      job.pending.set(callId,{resolve,reject});
      event.sender.send('agent:nativeTool',{requestId:req.requestId,callId,name,args});
    });
  };
  try {
    const {validateToolCall} = await import('../shared/toolArguments.mjs');
    const { tools, aliases } = require('./agents/contract.cjs').wireTools(req.tools);
    const cfg = settings.getActive(req.provider);
    job.cfg = cfg;
    job.report = require('./agents/runReport.cjs').createRunReport({ dir:crashDir(), provider:cfg.provider, model:cfg.model, webResearch:require('./agents/research.cjs').enabled(cfg) });
    const attached = await chatImages.native(req.prompt, req.history, req.chatImageIds || []);
    const result = await localAgents.runEditorNative(cfg, {
      sessionKey:`${event.sender.id}:${req.sessionKey}`, tools, system:req.system, context:typeof req.context === 'string' ? req.context.slice(0, 4000) : '', ...attached,
      signal:job.controller.signal,
      onSearch:search=>{if(!event.sender.isDestroyed())event.sender.send('agent:nativeProgress',{requestId:req.requestId,event:{type:'tool',id:`native-web-${search.id}`,name:'web_search',label:search.query?`Searching web: ${search.query}`:'Searching the web',status:search.status}});},
      onTool:require('./agents/toolResult.cjs').createToolCaller({ tools, aliases, validateToolCall, report:job.report, invoke, agentFrames,
        ownerId:event.sender.id, requestId:req.requestId, provider:cfg.provider, model:cfg.model, checkAbort:()=>checkAbort(job.controller.signal) }),
      isComplete:async()=>!!(await invoke('__native_status',{})).ready,
    });
    checkAbort(job.controller.signal);
    job.report?.finish({ outcome:'completed', tokenUsage:result.tokenUsage });
    return {ok:true,...result,provider:cfg.provider,model:cfg.model};
  } catch(error) {
    const canceled = !job.failure && (job.controller.signal.aborted || error.name === 'AbortError');
    job.report?.finish({ outcome:canceled ? 'canceled' : 'failed' });
    if(job.failure)return {ok:false,...job.failure};
    if(canceled)return {ok:false,canceled:true};
    return {ok:false,error:error.message};
  } finally {
    job.lifetime.dispose();
    // Provider failure/cleanup is not a user pressing Stop. Preserve the error
    // response while canceling any unfinished editor jobs.
    job.controller.signal.removeEventListener('abort',onAbort);
    if (job.pending.size || agentRequests.has(key)) { agentRequests.get(key)?.abort(); job.controller.abort(); }
    nativeRuns.delete(key);
    for(const pending of job.pending.values())pending.reject(new Error('The native task ended.'));
    job.pending.clear();
    if(!event.sender.isDestroyed())event.sender.removeListener('destroyed',stop);
  }
});
// ---- External agents over MCP (docs/design/external-agent-mcp.md): an outside agent edits through
// ClipCraft's MCP server (HTTP on 127.0.0.1) while ClipCraft is open; one agent at a time, never
// together with CraftAI. UI tests install into a temporary home, never the user's agents. ----
const externalHome = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'agent-home') : require('node:os').homedir();
const externalAgents = require('./agents/external/host.cjs').createExternalAgents({ ipcMain, getWindow: () => win, settings,
  version: app.getVersion(), agentFrames, reportDir: crashDir,
  installer: { home: externalHome, searchDirectories: localAgents.searchDirectories,
    env: process.env.FVE_SMOKE ? { ...process.env, CLAUDE_CONFIG_DIR: path.join(externalHome, '.claude'), CODEX_HOME: path.join(externalHome, '.codex') } : process.env } });
// CraftAI may start unless an outside agent is working; an idle one gives the editor back.
const externalHolder = () => { const name = externalAgents.yieldToCraft(); return name ? `${name} is working in ClipCraft. Wait until it finishes, or disconnect it (top bar), to use CraftAI.` : null; };
ipcMain.handle('agent:openSource', async (_event, value) => {
  const { webSourceUrl } = await import('../shared/webSource.mjs');
  const url = webSourceUrl(value);
  if (!url) return { error: 'Source links must be HTTP or HTTPS URLs.' };
  await shell.openExternal(url);
  return { ok: true };
});
const { runImageJobs } = require("./agents/imageJobs.cjs");
const { fitImageFrame, validateImageFrame } = require("./media/imageFrame.cjs");
async function generateSceneImage(cfg, req, signal) {
  if (!req || !/^\d{1,4}:\d{1,4}$/.test(req.ratio || '')) return { error: 'Provide the project aspect ratio for the scene image.' };
  validateImageFrame(req.width, req.height);
  const image = await localAgents.generateImage(cfg, { prompt: req.prompt, ratio: req.ratio, width: req.width, height: req.height,
    referencePaths: req.referencePaths || [], transparentBackground: req.transparentBackground === true,
    outputDir: path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'codex-images'), signal });
  if (signal.aborted) return { canceled: true, error: 'Image generation stopped.' };
  const framed = await fitImageFrame(image.path, { width: req.width, height: req.height, signal });
  if (signal.aborted) return { canceled: true, error: 'Image generation stopped.' };
  const [media] = await probeAll([framed.path]);
  if (!media || media.error || media.type !== 'image') return { error: 'Codex produced an image that ClipCraft could not read.' };
  if (media.width !== req.width || media.height !== req.height) return { error: 'The generated image does not match the project dimensions.' };
  const title = String(req.prompt).trim().split(/\s+/).slice(0, 7).join(' ').replace(/[\\/:*?"<>|]+/g, '');
  return { ...media, name: `${title || 'Generated scene'}.png`, origin: 'codex-image',
    generation: { provider: 'codex-sdk', skill: 'imagegen', prompt: image.prompt,
      width: req.width, height: req.height, nativeWidth: framed.nativeWidth, nativeHeight: framed.nativeHeight } };
}
function registerImageHandler(channel, batch = false) {
  ipcMain.handle(channel, async (event, req) => {
    const key = agentRequestKey(event, req?.requestId);
    if (nativeRuns.get(key)?.controller.signal.aborted) return { canceled:true, error:'Image generation stopped.' };
    if (agentRequests.has(key)) return { error: 'This assistant request is already running.' };
    const controller = new AbortController();
    agentRequests.set(key, controller);
    const onDestroyed = () => controller.abort();
    event.sender.once('destroyed', onDestroyed);
    const started = Date.now();
    let latest = { completed:0, failed:0, active:0, total:batch ? req?.scenes?.length || 0 : 1 };
    const progress = value => {
      const { result, ...summary } = value;
      latest = summary;
      if (!controller.signal.aborted && !event.sender.isDestroyed()) event.sender.send('agent:imageProgress', {
        requestId:req?.requestId, batchId:req?.batchId, ...summary, elapsed_sec:Math.floor((Date.now()-started)/1000), ...(result ? { result } : {}),
      });
    };
    const heartbeat = setInterval(() => progress(latest), 1000);
    try {
      const cfg = nativeRuns.get(key)?.cfg || settings.getActive();
      if (cfg.provider !== 'codex-sdk') return { error: 'Choose Codex SDK in Settings to generate images with its installed imagegen skill.' };
      if (batch) return { results: await runImageJobs(req?.scenes, scene => generateSceneImage(cfg, scene, controller.signal), controller.signal, progress) };
      progress({ ...latest, index:0, status:'running', active:1 });
      const result = await generateSceneImage(cfg, req, controller.signal);
      progress({ ...latest, index:0, status:result.error?'error':'done', completed:1, failed:result.error?1:0, active:0 });
      return result;
    } catch (e) {
      if (controller.signal.aborted || e.name === 'AbortError') return { canceled: true, error: 'Image generation stopped.' };
      return { error: e.message };
    } finally {
      clearInterval(heartbeat);
      agentRequests.delete(key);
      if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', onDestroyed);
    }
  });
}
registerImageHandler('agent:generateImage');
registerImageHandler('agent:generateImages', true);
// All editor analysis jobs share the request's cancellation owner, including
// FFmpeg decoding, downloads, Whisper inference and cloud transcription.
async function withAgentJob(event, requestId, run) {
  const key = agentRequestKey(event, requestId || `job-${require('crypto').randomUUID()}`);
  if (nativeRuns.get(key)?.controller.signal.aborted) return {ok:false,canceled:true,error:'Editing stopped.'};
  if (agentRequests.has(key)) return { ok: false, error: 'This assistant request is already running.' };
  const controller = new AbortController(); agentRequests.set(key, controller);
  const destroyed = () => controller.abort(); event.sender.once('destroyed', destroyed);
  try { const result = await run(controller.signal); checkAbort(controller.signal); return result; }
  catch (error) {
    return { ok: false, error: controller.signal.aborted ? 'Assistant job stopped.' : error.message,
      ...(controller.signal.aborted || error.name === 'AbortError' ? { canceled: true } : {}) };
  } finally {
    agentRequests.delete(key);
    if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', destroyed);
  }
}
ipcMain.handle('agent:silences', (event, project, opts = {}) => withAgentJob(event, opts.requestId,
  async signal => ({ ok: true, silences: await detectSilences(project, { ...opts, signal }),
    audible: require('./media/ffmpeg.cjs').audibleIntervals(project, { source: opts.source || 'all', clip_ids: opts.clip_ids }) })));
// Beat grid and loudness of the rendered timeline mix (or selected sources), timeline seconds.
const rhythm = () => require('./audio/rhythm.cjs').createRhythmService({ renderAudio: renderTimelineAudio, ffmpegPath: require('./media/ffmpeg.cjs').ffmpegPath });
ipcMain.handle('agent:beats', (event, project, opts = {}) => withAgentJob(event, opts.requestId, signal => rhythm().beats(project, { ...opts, signal })));
ipcMain.handle('agent:refineCuts', (event, project, opts = {}) => withAgentJob(event, opts.requestId, signal => require('./audio/speechCuts.cjs').refineCuts(project,
  { spans: opts.spans, source: opts.source, clip_ids: opts.clip_ids, signal, renderAudio: renderTimelineAudio, ffmpegPath: require('./media/ffmpeg.cjs').ffmpegPath,
    // Each candidate sound is recognized on its own to confirm it is a hesitation.
    verify: (files, jobSignal) => whisper.transcribeClips(whisperDir(), files, { language: opts.language && opts.language !== 'auto' ? opts.language : 'en', signal: jobSignal }) })));
ipcMain.handle('agent:loudness', (event, project, opts = {}) => withAgentJob(event, opts.requestId, signal => rhythm().loudness(project, { ...opts, signal })));
ipcMain.handle('agent:mediaJob', (event, req = {}) => withAgentJob(event, req.requestId, signal => {
  if (req.action === 'track') {
    const frames = agentFrames.evidence(event.sender.id, req.frame_ids, req.requestId);
    if (frames.some(f => f.presentedVia)) throw Error('Tracking needs the starting frame inspected on its own (inspect_frames source clip), not a contact-sheet cell.');
    if (frames.length !== 1 || frames.some(f => f.source === 'timeline' || f.media_id !== req.item?.id || f.fingerprint !== fileFingerprint(req.item.path)
      || Math.abs(f.source_time_sec - req.from) > .05)) throw Error('Inspect and present the raw source at this clip’s starting frame in the current request before tracking.');
  }
  return require('./agents/editorMedia.cjs').runEditorMediaJob(req, { signal, cacheDir: mediaCacheDir(), probeAll });
}));
ipcMain.handle('agent:fileJob', (event, req = {}) => withAgentJob(event, req.requestId, signal =>
  require('./agents/editorFiles.cjs').runEditorFileJob(req, { signal, probeAll, outputDir: app.getPath('downloads'),
    choosePaths: async pick => {
      const result = await dialog.showOpenDialog(win, { title: pick === 'folder' ? 'Choose media folder for CraftAI' : 'Choose media for CraftAI',
        properties: pick === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
        ...(pick === 'folder' ? {} : { filters: [{ name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] }] }),
      });
      return result.canceled ? [] : result.filePaths;
    },
  })));

ipcMain.handle('agent:reviewRendered', (event, req = {}) => withAgentJob(event, req.requestId, async signal => {
  const output = agentExportOutputs.get(req.file);
  if (!output || output.owner !== event.sender.id || output.requestId !== req.requestId || output.revision !== req.revision) throw Error('Review requires a rendered output from this editor request and revision.');
  if (output.fingerprint !== fileFingerprint(req.file)) throw Error('The rendered file changed before review. Render the section again.');
  const result = await require('./agents/renderReview.cjs').inspectRenderedVideo(req.file, { signal, sampleTimes: req.sample_times });
  if (output.fingerprint !== fileFingerprint(req.file)) throw Error('The rendered file changed during review.');
  const frames = result.frames.map(frame => agentFrames.addRendered(event.sender.id, frame.bytes, {
    revision: req.revision, time_sec: output.timelineStart + frame.render_time_sec, render_time_sec: frame.render_time_sec,
    label: `Encoded section image at timeline ${output.timelineStart + frame.render_time_sec}s; sampled still, not continuous playback or audio.`,
  }));
  return { ...result, frames, revision: req.revision, semantic_audio_review: false, continuous_semantic_video_review: false };
}));

// Motion graphics: a component the agent wrote, rendered in the locked-down sandbox
// (electron/graphics/) into a transparent video plus a transparent preview copy. Sample frames are
// registered like inspected frames, so the model sees what it drew.
let graphicsService;
const graphics = () => graphicsService ||= new (require('./graphics/service.cjs').GraphicsService)({
  root: path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'graphics'), ffmpegPath: require('./media/ffmpeg.cjs').ffmpegPath, probe,
  renderGraphic: require('./graphics/render.cjs').renderGraphic,
});
ipcMain.handle('agent:renderGraphic', (event, req = {}) => withAgentJob(event, req.requestId, async signal => {
  let last = 0;
  const result = await graphics().render(req, { signal, sampleTimes: req.sample_times_sec, onProgress: (done, total) => {
    const now = Date.now(); if ((now - last < 150 && done < total) || event.sender.isDestroyed()) return; last = now;
    event.sender.send('agent:graphicProgress', { requestId: req.requestId, done, total });
  } });
  const start = Number.isFinite(req.start_sec) ? req.start_sec : 0;
  const frames = result.samples.map(sample => agentFrames.addRendered(event.sender.id, sample.bytes, { revision: req.revision, time_sec: start + sample.time_sec, render_time_sec: sample.time_sec, width: sample.width, height: sample.height,
    label: `Graphic frame at ${sample.time_sec}s of the graphic (timeline ${Math.round((start + sample.time_sec) * 1000) / 1000}s), drawn over neutral grey: grey is transparent.` }));
  const { samples, media, ...rest } = result;
  return { ok: true, ...rest, media: { ...media, path: result.file }, frames };
}));

// The editor re-rendering a graphic (inspector fields, a new canvas size, missing cached files): the
// same sandbox and cache, no sample frames. One render per window at a time; a newer one replaces it.
const graphicJobs = new Map();
ipcMain.handle('graphics:render', async (event, req = {}) => {
  // One render per window and purpose (the inspector, each automatic re-render): a newer one replaces it.
  const jobKey = `${event.sender.id}:${String(req.requestId || 'editor').slice(0, 80)}`;
  graphicJobs.get(jobKey)?.abort();
  const controller = new AbortController(); graphicJobs.set(jobKey, controller);
  let last = 0;
  try {
    const { samples, media, ...rest } = await graphics().render(req, { signal: controller.signal, samples: false, onProgress: (done, total) => {
      const now = Date.now(); if ((now - last < 150 && done < total) || event.sender.isDestroyed()) return; last = now;
      event.sender.send('agent:graphicProgress', { requestId: req.requestId || 'editor', done, total });
    } });
    return { ok: true, ...rest, media: { ...media, path: rest.file } };
  } catch (error) { return { ok: false, error: controller.signal.aborted ? 'Graphic render replaced or stopped.' : error.message, ...(controller.signal.aborted ? { canceled: true } : {}) }; }
  finally { if (graphicJobs.get(jobKey) === controller) graphicJobs.delete(jobKey); }
});
// The graphics an open project uses (cache keys), per window: never removed by the cache limit or Clear.
const graphicsOwners = new Set();
ipcMain.handle('graphics:inUse', (event, keys = []) => {
  const owner = event.sender.id;
  graphics().setInUse(owner, (Array.isArray(keys) ? keys : []).filter(k => typeof k === 'string' && /^[a-f0-9]{8,64}$/.test(k)).slice(0, 2000));
  if (!graphicsOwners.has(owner)) { graphicsOwners.add(owner); event.sender.once('destroyed', () => { graphicsOwners.delete(owner); graphics().setInUse(owner, []); }); }
  return true;
});
ipcMain.handle('graphics:usage', () => graphics().usage());
ipcMain.handle('graphics:clear', () => graphics().clear());
// Which graphics lost their cached files (moved user data, cleaned disk): the editor draws them again.
// Only paths inside the graphics folder are checked.
ipcMain.handle('graphics:missing', (_event, items = []) => {
  const root = path.resolve(path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'graphics')) + path.sep;
  const inside = file => typeof file === 'string' && path.resolve(file).startsWith(root);
  return (Array.isArray(items) ? items.slice(0, 500) : []).filter(i => i && [i.path, i.preview].some(f => inside(f) && !fs.existsSync(f)) || (i && !inside(i.path))).map(i => i.id);
});

ipcMain.handle('captions:status', () => whisper.status(whisperDir()));
let transcriptService;
const getTranscriptService = () => transcriptService ||= require("./audio/audioAnalysis.cjs").createTranscriptService({
  cacheDir: path.join(process.env.FVE_SMOKE || app.getPath('userData'), 'transcript-cache'), whisperDir: whisperDir(),
  whisper, cloud: cloudCaptions, fetchImpl: net.fetch, getKey: service => settings.getServiceKey(service),
});
function runCaptionAnalysis(event, project, opts) {
  return withAgentJob(event, opts.requestId, signal => getTranscriptService().run(project, opts, { signal,
    onProgress: (stage, progress) => { if (!event.sender.isDestroyed()) event.sender.send('captions:progress', { stage, progress }); },
  }));
}
// Both UI captions and agent speech reads reuse source-fingerprinted transcripts.
ipcMain.handle('captions:run', (event, project, opts = {}) => runCaptionAnalysis(event, project, { ...opts, engine: 'local' }));

ipcMain.handle('shell:show', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('shell:open', (_e, file) => shell.openPath(file));

// Cloud results retain the same measured-word shape as local transcripts.
ipcMain.handle('captions:runCloud', (event, project, opts = {}) => runCaptionAnalysis(event, project, { ...opts, engine: 'cloud' }));

// Test a cloud caption key: the typed key when given, otherwise the saved one.
ipcMain.handle('captions:testCloud', async (_e, provider, keyOverride) => {
  try {
    const meta = cloudCaptions.PROVIDERS[provider];
    if (!meta) return { error: `Unknown caption provider: ${provider}` };
    const key = String(keyOverride || '').trim() || settings.getServiceKey(meta.service);
    if (!key) return { error: `No ${meta.name} key to test — paste one or save one first.` };
    await cloudCaptions.testConnection({ provider, key, fetchImpl: net.fetch });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Native menus. macOS gets a standard menu bar (app, File, Edit, View, Window) whose
// editor commands go to the renderer; Windows and Linux use ClipCraft's own top bar,
// so the default developer menu (Reload, DevTools) is removed.
function sendCommand(command) { if (win && !win.isDestroyed()) win.webContents.send('app:command', command); }
function installMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  const dev = !!process.env.VITE_DEV_SERVER_URL;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { label: 'About ClipCraft', click: () => sendCommand('about') },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Command+,', click: () => sendCommand('settings') },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'Home', click: () => sendCommand('home') },
      { label: 'Open Project…', click: () => sendCommand('open') },
      { type: 'separator' },
      // Shown without registering: the editor's own (remappable) shortcuts handle these keys.
      { label: 'Save', accelerator: 'Command+S', registerAccelerator: false, click: () => sendCommand('save') },
      { label: 'Save As…', accelerator: 'Command+Alt+S', registerAccelerator: false, click: () => sendCommand('saveAs') },
      { type: 'separator' },
      { label: 'Import Media…', click: () => sendCommand('import') },
      { label: 'Export…', click: () => sendCommand('export') },
      { type: 'separator' }, { role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'togglefullscreen' },
      ...(dev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
    ] },
    { role: 'windowMenu' },
  ]));
}
// Native message boxes replace the page's alert/confirm. UI tests stub the page
// functions, so in test runs the renderer falls back to them.
ipcMain.on('dialog:messageSync', (event, req = {}) => {
  if (process.env.FVE_SMOKE || !win || win.isDestroyed()) { event.returnValue = { unavailable: true }; return; }
  const text = String(req.message || '').slice(0, 4000), [first, ...rest] = text.split('\n');
  const confirm = req.kind === 'confirm';
  const choice = dialog.showMessageBoxSync(win, { type: confirm ? 'question' : 'warning', message: first, detail: rest.join('\n').trim() || undefined,
    buttons: confirm ? [String(req.confirmLabel || 'OK').slice(0, 40), 'Cancel'] : ['OK'], defaultId: 0, cancelId: confirm ? 1 : 0, noLink: true });
  event.returnValue = { confirmed: confirm ? choice === 0 : true };
});

app.whenReady().then(() => {
  installMenu();
  createWindow();
  externalAgents.start().then((r) => { if (!r.ok) logCrash('external agents', { message: r.error }); });
  telemetry.start();
  // Find the graphics card's video encoder now (a short test encode), so the first export does not wait for it.
  setTimeout(() => require("./media/ffmpeg.cjs").pickEncoder(), 4000);
  // Screen recording (Media > Record screen).
  require("./recording/screenrec.cjs").install({ app, getWin: () => win, ffmpegPath: require("./media/ffmpeg.cjs").ffmpegPath, probeAll });
});
app.on('window-all-closed', () => app.quit());
