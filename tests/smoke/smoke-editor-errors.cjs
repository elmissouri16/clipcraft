// Failures inside the editor must not blank it or wedge it (tests/unit/editor/test-editor-errors-ui.cjs).
// The app runs without WebGL 2. A saved clip slower than a media element can play (0.05x) and a
// shader transition both draw without an error; an error thrown inside the preview is held by the
// editor's error boundary, autosave keeps running behind it, and Try again brings the editor back.
// An assistant export running when the interface crashes is dropped, so the next export may start.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ffmpegPath, probe } = require('../../electron/media/ffmpeg.cjs');

module.exports = async (win, app, dir) => {
  const q = (code) => win.webContents.executeJavaScript(code), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (code, tries = 250) => { for (let i = 0; i < tries; i++) { if (await q(code)) return; await wait(40); } throw Error('Timeout: ' + code); };
  const result = { checks: [], errors: [] }, check = (name, ok, detail) => { assert.ok(ok, `${name}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`); result.checks.push(name); };
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') result.errors.push(String(e.message).slice(0, 300)); });
  try {
    const file = path.join(dir, 'clip.mp4');
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=4', '-pix_fmt', 'yuv420p', file]);
    const media = { id: 'm1', name: 'clip.mp4', path: file, ...(await probe(file)) };
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    check('the app runs without WebGL 2', await q('!document.createElement("canvas").getContext("webgl2")'));
    const clip = (id, extra) => ({ id, mediaId: 'm1', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, ...extra });
    const project = { id: 'preview-errors', name: 'Preview errors', ratio: '16:9', width: 640, height: 360, fps: 30, media: [media],
      videoClips: [clip('c1'), clip('c2', { out: 0.1, speed: 0.05, transition: { type: 'dissolve', duration: 0.5 } })], overlayClips: [], audioClips: [], textClips: [] };
    await q(`window.__fve.load(${JSON.stringify(project)})`);
    await until('window.__fve.rawProject().id === "preview-errors"');
    for (const at of [1.8, 1.7, 3]) { await q(`window.__fve.seek(${at})`); await wait(400); }
    check('a 0.05x clip and a shader transition without WebGL 2 leave the editor up', await q('!!document.querySelector(".topbar") && !document.querySelector(".error-boundary")'));
    check('the slow clip plays at the slowest rate a media element accepts', await q('[...document.querySelectorAll("video")].some(v => v.playbackRate === 0.0625)'));
    await q('window.__fve.seek(1.75)'); await wait(400);
    check('the transition falls back to a cross-fade drawn by the slots', await q('[...document.querySelectorAll("canvas")].some(c => (c.dataset.renderError || "").startsWith("Could not render a transition"))'));

    // A render error inside the editor: the media element's rate setter throws while the preview syncs.
    await q('window.__fve.seek(0.5)'); await wait(300);
    await q(`window.__restoreRate = (() => { const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', { configurable: true, get: d.get, set() { throw new Error('test: playbackRate refused'); } });
      return () => Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', d); })(); true`);
    await q('window.__fve.dispatch({ type: "update", track: "video", id: "c1", patch: { speed: 2 } })');
    await until('!!document.querySelector(".error-boundary")');
    check('the editor shows the error message instead of a blank window', await q('!document.querySelector(".topbar") && document.querySelector(".error-boundary h3")?.textContent === "Something went wrong" && !!document.querySelector(".error-boundary .btn-primary")'));
    check('the project stays open behind the message', await q('window.__fve.rawProject().id === "preview-errors" && window.__fve.rawProject().videoClips[0].speed === 2'));
    await q('window.__fve.dispatch({ type: "update", track: "video", id: "c2", patch: { volume: 0.5 } })');
    await until('window.api.slotRead("preview-errors").then(s => s?.project?.videoClips?.[1]?.volume === 0.5)', 150);
    check('autosave keeps writing the project while the message shows', true);
    fs.writeFileSync(path.join(dir, 'error-boundary.png'), (await win.capturePage()).toPNG());
    await q('window.__restoreRate(); document.querySelector(".error-boundary .btn-primary").click(); true');
    await until('!!document.querySelector(".topbar") && !document.querySelector(".error-boundary")');
    await q('window.__fve.seek(0.5)'); await wait(300);
    check('Try again brings the editor back', await q('!!document.querySelector(".topbar") && !document.querySelector(".error-boundary")'));
    check('the error went to the crash log console', result.errors.some((m) => m.includes('Interface error in the editor') && m.includes('test: playbackRate refused')));

    // The interface crashes while an assistant export holds the export slot; the window reloads.
    const first = await q('window.api.agentExportBegin({ requestId: "crash-export-1", name: "crash test" })');
    check('an assistant export starts', !!first?.frameDir && !first.error, first);
    check('a second export is refused while it runs', /already running/.test((await q('window.api.agentExportBegin({ requestId: "crash-export-2", name: "crash test" })'))?.error || ''));
    const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.webContents.forcefullyCrashRenderer();
    await reloaded; await until('!!window.__fve');
    const after = await q('window.api.agentExportBegin({ requestId: "crash-export-3", name: "crash test" })');
    check('after the interface crash the next export can start', !!after?.frameDir && !after.error, after);
    check('the crashed export\'s frame folder is gone', !fs.existsSync(first.frameDir));
    await q(`window.api.exportAbort(${JSON.stringify(after.frameDir)})`);
    const unexpected = result.errors.filter((m) => !m.includes('test: playbackRate refused') && !/The above error occurred|playbackRate refused/.test(m));
    check('no other renderer errors', !unexpected.length, unexpected);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
