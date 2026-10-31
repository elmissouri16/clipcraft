// FVE_SMOKE_MODE=textanim: the Text Animations browser end to end — apply Slide Up Smooth and Fade Out
// through the real inspector UI, then export through the real pipeline. The runner
// (scripts/test-textanim-export.cjs) pixel-checks the exported frames: the text must enter from below.
// Needs <dir>/project.json with a text clip 't1' starting at 0.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function textanimSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name, sel) => {
    const rect = sel ? await q(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`) : null;
    fs.writeFileSync(path.join(dir, name), (await (rect ? win.capturePage(rect) : win.capturePage())).toPNG());
  };
  const click = (sel, text) => q(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const clip = () => q(`window.__fve.exportData().project.textClips.find((c) => c.id === 't1')`);

  win.setContentSize(1440, 900);
  await wait(800);
  // The app starts on the Home screen: enter the editor through a preset card first, then load.
  await q(`document.querySelector('[aria-label="New 16:9 project"]').click()`);
  await wait(600);
  await q(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
  await wait(800);
  await q(`window.__fve.select({ track: 'text', id: 't1' }); window.__fve.seek(1.5)`);
  await wait(400);

  // Text inspector > Animation tab: the composer browser with its category folders.
  await click('.text-inspector .seg-tabs button', 'Animation');
  await wait(400);
  result.categories = await q(`document.querySelectorAll('.tan-cat').length`);
  result.tiles = await q(`document.querySelectorAll('.tan .tpl-item').length`);
  result.headers = await q(`[...document.querySelectorAll('.tan-cat-head span:first-of-type')].map((s) => s.textContent)`);

  // Apply Slide Up Smooth through the tile, exactly like a user.
  await q(`[...document.querySelectorAll('.tan .tpl-btn')].find((b) => b.title.startsWith('Slide Up Smooth')).click()`);
  await wait(250);
  result.animIn = (await clip()).animIn;

  // Out section: Fade Out.
  await click('.text-inspector .seg-tabs.small button', 'Out');
  await wait(400);
  result.outTiles = await q(`document.querySelectorAll('.tan .tpl-item').length`);
  await q(`[...document.querySelectorAll('.tan .tpl-btn')].find((b) => b.title.startsWith('Fade Out')).click()`);
  await wait(250);
  result.animOut = (await clip()).animOut;
  await shot('textanim-panel.png', '.inspector');

  // Mid-animation frame in the player (0.25 s into a 0.7 s entrance: text below its rest position).
  await q(`window.__fve.seek(0.25)`);
  await wait(700);
  await shot('textanim-mid.png');

  // Full UI export (text frames + FFmpeg) — the export lands at <dir>/ui-export.mp4 in smoke mode.
  await q(`window.__fve.exportNow()`);
  for (let i = 0; i < 240; i++) {
    await wait(500);
    const st = await q(`document.querySelector('.modal h3')?.textContent || ''`);
    if (/complete|failed/i.test(st)) { result.exportStatus = st; break; }
  }
  result.exportError = await q(`document.querySelector('.error-log')?.textContent || null`);
};
