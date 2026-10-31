// FVE_SMOKE_MODE=screenrec: Media > Record with the camera bubble (Chromium's fake camera, see main.cjs), the
// shape switch, the folding Stop bar, a screen recording and a window recording (camera added as an overlay).
// Recordings go to <dir>/recordings and are deleted at the end.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function screenrecSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const until = async (fn, ms = 30000) => { for (let t = 0; t < ms; t += 250) { if (await fn()) return true; await wait(250); } return false; };
  const others = () => BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed());
  const byFile = (name) => others().find((w) => w.webContents.getURL().endsWith(name));
  const P = () => q('window.__fve.exportData().project');
  const clickText = (sel, text) => q(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`);
  const check = (label, on) => q(`(() => { const l = [...document.querySelectorAll('.rec-pick label')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
    const i = l.querySelector('input'); if (i.checked !== ${on}) i.click(); })()`);

  await wait(800);
  await q(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
  await wait(600);
  await q(`window.__fve.tab('media')`);
  await wait(300);

  const record = async (kind, seconds) => {
    await q(`[...document.querySelectorAll('.lib-head button')].find((b) => b.textContent.trim() === 'Record').click()`);
    await until(() => q(`document.querySelectorAll('.rec-source').length > 0`));
    if (kind === 'window') {
      await clickText('.rec-tabs button', 'Windows');
      await wait(300);
      await q(`document.querySelector('.rec-source').click()`);
    }
    await check('Hide ClipCraft', kind === 'screen'); // the default: ClipCraft hides while recording
    await check('Camera', true);
    const bubble = await until(() => !!byFile('cambubble.html'), 8000);
    await wait(1500);
    const b = byFile('cambubble.html');
    const out = { bubble, camPlaying: b && await b.webContents.executeJavaScript(`(() => { const v = document.getElementById('v'); return v.readyState >= 2 && v.videoWidth > 0; })()`) };
    if (kind === 'screen') {
      await clickText('.rec-shape button', 'Square');
      await wait(400);
      // Alpha of the canvas near the shape's top-left corner (8% in, past the transparent room around it):
      // outside a circle, inside a rounded square.
      const cornerAlpha = () => byFile('cambubble.html').webContents.executeJavaScript(`(() => { const c = document.getElementById('c');
        const r = room * (window.devicePixelRatio || 1); const s = c.width - 2 * r;
        return c.getContext('2d').getImageData(Math.round(r + s * 0.08), Math.round(r + s * 0.08), 1, 1).data[3]; })()`);
      out.bubbleShape = { square: await cornerAlpha() };
      fs.writeFileSync(path.join(dir, 'rec-bubble-square.png'), (await byFile('cambubble.html').capturePage()).toPNG());
      await clickText('.rec-shape button', 'Round');
      await wait(400);
      out.bubbleShape.circle = await cornerAlpha();
      fs.writeFileSync(path.join(dir, 'rec-bubble-round.png'), (await byFile('cambubble.html').capturePage()).toPNG());
      // Size buttons on the bubble.
      const w0 = byFile('cambubble.html').getBounds().width;
      await byFile('cambubble.html').webContents.executeJavaScript(`document.getElementById('bigger').click()`);
      await wait(300);
      out.bubbleGrew = byFile('cambubble.html').getBounds().width - w0;
      // Outline and glow from the Record window: shown on the bubble, given to the camera clip.
      await q(`document.querySelector('[aria-label="Outline #ffffff"]').click()`);
      await wait(200);
      await q(`document.querySelector('[aria-label="Glow #ec4899"]').click()`);
      await wait(600);
      fs.writeFileSync(path.join(dir, 'rec-bubble-style.png'), (await byFile('cambubble.html').capturePage()).toPNG());
      // The camera picture inside the bubble (the fake camera is green): pixel at the shape's center.
      out.bubbleCenter = await byFile('cambubble.html').webContents.executeJavaScript(`(() => { const c = document.getElementById('c');
        return [...c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height * 0.4), 1, 1).data]; })()`);
      const r = await q(`(() => { const b = document.querySelector('.rec-pick').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
      fs.writeFileSync(path.join(dir, 'rec-dialog.png'), (await win.capturePage(r)).toPNG());
      await byFile('cambubble.html').webContents.executeJavaScript(`document.body.dispatchEvent(new MouseEvent('mouseover'))`);
      fs.writeFileSync(path.join(dir, 'rec-bubble.png'), (await byFile('cambubble.html').capturePage()).toPNG());
    }
    const before = (await P()).media.length;
    await clickText('.rec-pick button', 'Start recording');
    out.recording = await until(() => q(`!!document.querySelector('.rec-live')`), 15000);
    await until(() => !!byFile('recbar.html'), 5000);
    await wait(800);
    const bub = byFile('cambubble.html');
    out.bubbleWhileRecording = bub ? { visible: bub.isVisible(), minimized: bub.isMinimized(), bounds: bub.getBounds(), onTop: bub.isAlwaysOnTop() } : 'gone';
    out.display = require('electron').screen.getPrimaryDisplay().bounds;
    const bar = byFile('recbar.html');
    out.barProtected = !!bar;
    if (kind === 'screen' && bar) {
      const h0 = bar.getBounds().height;
      await bar.webContents.executeJavaScript(`document.getElementById('hide').click()`);
      await wait(400);
      const h1 = bar.getBounds().width; // folded: the window shows only the small tab
      const tab = await bar.webContents.executeJavaScript(`getComputedStyle(document.getElementById('tab')).display`);
      fs.writeFileSync(path.join(dir, 'rec-tab.png'), (await bar.capturePage()).toPNG());
      await bar.webContents.executeJavaScript(`document.getElementById('tab').click()`);
      await wait(400);
      fs.writeFileSync(path.join(dir, 'rec-bar.png'), (await bar.capturePage()).toPNG());
      out.barFold = { openHeight: h0, foldedWidth: h1, tab, reopenedWidth: bar.getBounds().width };
    }
    await wait(seconds * 1000);
    if (kind === 'screen' && bar) {
      await bar.webContents.executeJavaScript(`document.getElementById('stop').click()`); // Stop from the floating bar
    } else {
      await clickText('.rec-modal button', 'Stop');
    }
    out.saved = await until(async () => (await P()).media.length > before && !(await q(`!!document.querySelector('.rec-modal')`)), 120000);
    out.windowsLeft = others().length;
    const p = await P();
    // The bubble must not be in the screen video: at its place, the frame is not the (green) fake camera.
    const shot = p.media.slice(before).find((m) => /^Screen/.test(m.name));
    const bw = out.bubbleWhileRecording && out.bubbleWhileRecording.bounds;
    if (kind === 'screen' && shot && bw) {
      const { execFileSync } = require('child_process');
      const { ffmpegPath } = require('./ffmpeg.cjs');
      const D = out.display;
      const k = shot.width / D.width;
      const pts = [[0.5, 0.5], [0.35, 0.5], [0.5, 0.35], [0.65, 0.6]].map(([fx, fy]) => [Math.round((bw.x - D.x + bw.width * fx) * k), Math.round((bw.y - D.y + bw.height * fy) * k)]);
      if (process.env.FVE_KEEP) execFileSync(ffmpegPath, ['-y', '-v', 'error', '-ss', '1', '-i', shot.path, '-frames:v', '1', '-vf',
        `crop=${Math.round(bw.width * k * 1.3)}:${Math.round(bw.height * k * 1.3)}:${Math.max(0, Math.round((bw.x - D.x - bw.width * 0.15) * k))}:${Math.max(0, Math.round((bw.y - D.y - bw.height * 0.15) * k))}`,
        path.join(dir, 'bubble-area.png')]);
      const frame = execFileSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', shot.path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
      out.bubbleInVideo = pts.map(([x, y]) => { const i = (y * shot.width + x) * 3; return [frame[i], frame[i + 1], frame[i + 2]]; })
        .some(([r, g, b]) => g > 100 && g - Math.max(r, b) > 60);
    }
    out.added = p.media.slice(before).map((m) => ({ name: m.name.replace(/\d{4}-.*/, '…'), duration: Math.round(m.duration * 10) / 10, hasAudio: m.hasAudio }));
    const cam = p.overlayClips.find((c) => p.media.slice(before).some((m) => m.id === c.mediaId));
    out.overlay = cam ? { mask: cam.mask.type, maskW: cam.mask.w, maskH: cam.mask.h, round: cam.mask.round, stroke: cam.mask.stroke, strokeColor: cam.mask.strokeColor, glow: cam.mask.glow, glowColor: cam.mask.glowColor, transform: cam.transform } : null;
    out.frame = `${p.width}x${p.height}`;
    if (kind === 'screen') {
      // Exported, the camera must be a round bubble on the screen video (frame at 1 s in rec-result.png).
      const { execFileSync } = require('child_process');
      const { ffmpegPath, runExport } = require('./ffmpeg.cjs');
      const file = path.join(dir, 'rec-export.mp4');
      try {
        await runExport((await q('window.__fve.exportData()')).project, file, () => {}).promise;
        execFileSync(ffmpegPath, ['-y', '-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', path.join(dir, 'rec-result.png')]);
      } catch (e) {
        out.exportError = String(e.message).split(/\r?\n/).filter((l) => /error|alloc|fail/i.test(l)).slice(-2).join(' | ');
      }
      fs.rmSync(file, { force: true });
    }
    out.project = { W: p.width, H: p.height };
    out.error = await q(`document.querySelector('.rec-pick .error-text')?.textContent || ''`);
    return out;
  };

  result.screen = await record('screen', 2);
  result.window = await record('window', 2);
  // Let go of the recordings (the player holds them open), then delete them.
  await q(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
  await wait(1500);
  try { fs.rmSync(path.join(dir, 'recordings'), { recursive: true, force: true }); } catch (e) { result.cleanup = e.message; }
};
