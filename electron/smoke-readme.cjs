// FVE_SMOKE_MODE=readme: screenshots and GIF frames of the real app for the README (docs/media is built from them
// by scripts/readme-media.cjs). Needs <dir>/project.json (a showcase project). Frames go to <dir>/gif/<name>/.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function readmeShots(win, dir, result) {
  const run = (js) => win.webContents.executeJavaScript(js);
  const q = run;
  const until = async (js, ms = 60000) => { for (let t = 0; t < ms; t += 300) { if (await q(js)) return true; await wait(300); } return false; };
  const rectOf = (sel) => q(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const out = path.join(dir, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const snap = async (name, sel) => fs.writeFileSync(path.join(out, `${name}.png`), (await (sel ? win.capturePage(await rectOf(sel)) : win.capturePage())).toPNG());
  const record = async (name, sel, seconds, fps, during) => {
    const fdir = path.join(dir, 'gif', name);
    fs.rmSync(fdir, { recursive: true, force: true });
    fs.mkdirSync(fdir, { recursive: true });
    const rect = sel ? await rectOf(sel) : null;
    const n = Math.round(seconds * fps);
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      if (during) await during(i, n);
      const img = await (rect ? win.capturePage(rect) : win.capturePage());
      fs.writeFileSync(path.join(fdir, `${String(i).padStart(4, '0')}.png`), img.toPNG());
      const due = t0 + ((i + 1) * 1000) / fps;
      if (due > Date.now()) await wait(due - Date.now());
    }
    result[name] = { frames: n, realSeconds: (Date.now() - t0) / 1000 };
  };
  const side = (t) => q(`[...document.querySelectorAll('.side-btn')].find((b) => b.textContent.trim() === ${JSON.stringify(t)}).click()`);
  // Hovers one tile (by its label) so its live preview plays.
  const hoverTile = (label) => q(`(() => {
    document.querySelectorAll('.tile').forEach((t) => t.dispatchEvent(new PointerEvent('pointerleave')));
    const t = [...document.querySelectorAll('.tile')].find((x) => x.querySelector('.tile-label') && x.querySelector('.tile-label').textContent === ${JSON.stringify(label)});
    t.scrollIntoView({ block: 'center' });
    t.dispatchEvent(new PointerEvent('pointerenter'));
  })()`);
  const tour = (labels) => async (i, n) => {
    const k = Math.floor((i / n) * labels.length);
    if (i === 0 || Math.floor(((i - 1) / n) * labels.length) !== k) await hoverTile(labels[k]);
  };

  win.setContentSize(1440, 860);
  await wait(1200);
  await q(`localStorage.removeItem('clipcraft.layout')`);
  await run(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
  await wait(1000);
  await until(`!window.__fve.exportData().project.media.some((m) => m.optimizing) && window.__fve.exportData().project.media.filter((m) => m.thumb).length >= 6`, 180000);

  // Title and caption from the text templates.
  await q(`window.__fve.tab('text')`);
  await wait(800);
  const addTpl = async (name, at, patch) => {
    await q(`window.__fve.select(null); window.__fve.seek(${at})`);
    await wait(200);
    await q(`[...document.querySelectorAll('.tpl-item')].find((t) => t.querySelector('.tpl-name').textContent === ${JSON.stringify(name)}).querySelector('.tpl-btn').click()`);
    await wait(300);
    await q(`(() => { const p = window.__fve.exportData().project; const c = p.textClips[p.textClips.length - 1]; window.__fve.dispatch({ type: 'update', track: 'text', id: c.id, patch: ${JSON.stringify(patch)} }); })()`);
  };
  await addTpl('Big Title', 0.2, { text: 'ClipCraft', start: 0.2, duration: 3.4, y: 0.42 });
  await addTpl('Hormozi', 4.4, { text: 'FREE FOREVER · NO WATERMARK', start: 4.3, duration: 3.4, y: 0.82 });
  await q('window.__fve.select(null)');

  // 1) The whole app.
  await q(`window.__fve.tab('effects'); window.__fve.seek(2.6)`);
  await wait(1500);
  await snap('hero');

  // 2) Playback across the animated transitions.
  await q('window.__fve.seek(2.4)');
  await wait(800);
  await q('window.__fve.play()');
  await record('playback', '.stage', 6.5, 10);
  await q('window.__fve.pause()');

  // 3) Live effect and transition tiles.
  await q(`window.__fve.tab('effects')`);
  await wait(800);
  await snap('effects-panel', '.left');
  await record('effects', '.left', 7.5, 10, tour(['VHS Noise', 'Snow Storm', 'Fire Burn', 'Limelight', 'Striped Erosion']));
  await q(`window.__fve.tab('transitions')`);
  await wait(800);
  await record('transitions', '.left', 8, 10, tour(['Comic Cut', 'Phone Reveal', 'Mosaic Wipe', 'Finger Swipe', 'Brush Cuts']));
  await q(`document.querySelectorAll('.tile').forEach((t) => t.dispatchEvent(new PointerEvent('pointerleave')))`);

  // 4) Moving, resizing and rotating the green-screen cat in the player.
  await q(`window.__fve.seek(2.6); window.__fve.select({ track: 'overlay', id: 'o1' })`);
  await wait(900);
  const box = await q(`(() => { const r = document.querySelector('.tbox').getBoundingClientRect(); const h = document.querySelector('.tbox-handle.se').getBoundingClientRect(); const ro = document.querySelector('.tbox-rotate').getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, hx: h.left + 5, hy: h.top + 5, rx: ro.left + ro.width / 2, ry: ro.top + ro.height / 2 }; })()`);
  const ev = (type, x, y, target) => q(`(${target ? `document.querySelector(${JSON.stringify(target)})` : 'window'}).dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, button: 0, clientX: ${x}, clientY: ${y} }))`);
  const steps = [];
  for (let i = 0; i <= 20; i++) steps.push(['move', box.cx - 200 * Math.sin((i / 20) * Math.PI), box.cy - 50 * Math.sin((i / 20) * Math.PI * 2)]);
  for (let i = 0; i <= 14; i++) steps.push(['scale', box.hx + 70 * Math.sin((i / 14) * Math.PI), box.hy + 40 * Math.sin((i / 14) * Math.PI)]);
  for (let i = 0; i <= 14; i++) steps.push(['rotate', box.rx + 60 * Math.sin((i / 14) * Math.PI), box.ry]);
  let mode = null;
  await record('player-edit', '.stage', steps.length / 10 + 0.6, 10, async (i) => {
    const step = steps[i];
    if (!step) {
      if (mode) { await ev('pointerup', 0, 0); mode = null; }
      return;
    }
    const [m, x, y] = step;
    if (m !== mode) {
      if (mode) await ev('pointerup', x, y);
      const start = m === 'move' ? [box.cx, box.cy, '.tbox'] : m === 'scale' ? [box.hx, box.hy, '.tbox-handle.se'] : [box.rx, box.ry, '.tbox-rotate'];
      await ev('pointerdown', start[0], start[1], start[2]);
      mode = m;
    }
    await ev('pointermove', x, y);
  });
  await q(`window.__fve.dispatch({ type: 'undo' }); window.__fve.dispatch({ type: 'undo' }); window.__fve.dispatch({ type: 'undo' })`);

  // 5) Clip panel: chroma key and masks.
  await q(`window.__fve.select({ track: 'overlay', id: 'o1' })`);
  await wait(400);
  await q(`[...document.querySelectorAll('.clip-inspector .seg-tabs button')].find((b) => b.textContent === 'Remove BG').click()`);
  await wait(400);
  await snap('inspector-chroma', '.inspector');
  await q(`[...document.querySelectorAll('.clip-inspector .seg-tabs button')].find((b) => b.textContent === 'Mask').click()`);
  await wait(400);
  await snap('inspector-mask', '.inspector');

  // 6) Library panels.
  await q(`window.__fve.select(null); window.__fve.tab('text')`);
  await wait(900);
  await snap('text-templates', '.left');
  await q(`window.__fve.tab('audio')`);
  await until(`document.querySelectorAll('.lib-row').length > 3`, 20000);
  await wait(600);
  await snap('audio-music', '.left');
  await side('Text to speech');
  await wait(800);
  await snap('text-to-speech', '.left');
  await q(`window.__fve.tab('media')`);
  await wait(400);
  await snap('media', '.left');

  // 7) Timeline with the Effects lane and a selected transition, then the right-click menu.
  await q(`window.__fve.select({ track: 'transition', id: 'v2' }); window.__fve.seek(3.6)`);
  await wait(700);
  await snap('timeline', '.timeline');
  await snap('transition-panel', '.inspector');
  await q(`(() => { const el = [...document.querySelectorAll('[data-lane="video"] .clip.video')][2]; const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 20 })); })()`);
  await wait(400);
  await snap('context-menu');
  await q(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await wait(300);

  // 8) CraftAI and Settings.
  await q(`document.querySelector('.pilot-fab').click()`);
  await wait(700);
  await snap('craftpilot', '.pilot-panel');
  await q(`document.querySelector('.pilot-fab').click()`);
  await wait(300);
  await q(`document.querySelector('[aria-label="Settings"]').click()`);
  await wait(700);
  await snap('settings', '.modal.settings');
};
