// FVE_SMOKE_MODE=textsmooth: the Smooth text-animation set end to end — the Animation browser must
// LEAD with the Smooth category; 'Chars Slide Up' is applied through the real tile; the project also
// carries a Decode clip and a Settle Up clip (animIn in project.json). The runner
// (scripts/test-textsmooth-export.cjs) measures the exported frames: staggered rise, cycling decode
// glyphs, and the settle overshoot above the rest position.
// Needs <dir>/project.json with text clips 't1' (0s), 't2' (3s, decode), 't3' (6s, settleUp).
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function textsmoothSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const click = (sel, text) => q(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const clip = () => q(`window.__fve.exportData().project.textClips.find((c) => c.id === 't1')`);

  win.setContentSize(1440, 900);
  await wait(800);
  await q(`document.querySelector('[aria-label="New 16:9 project"]').click()`);
  await wait(600);
  await q(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
  await wait(800);
  await q(`window.__fve.select({ track: 'text', id: 't1' }); window.__fve.seek(1.5)`);
  await wait(400);

  await click('.text-inspector .seg-tabs button', 'Animation');
  await wait(400);
  result.headers = await q(`[...document.querySelectorAll('.tan-cat-head span:first-of-type')].map((s) => s.textContent)`);
  result.tiles = await q(`document.querySelectorAll('.tan .tpl-item').length`);

  await q(`[...document.querySelectorAll('.tan .tpl-btn')].find((b) => b.title.startsWith('Chars Slide Up')).click()`);
  await wait(250);
  result.animIn = (await clip()).animIn;

  await q(`window.__fve.exportNow()`);
  for (let i = 0; i < 240; i++) {
    await wait(500);
    const st = await q(`document.querySelector('.modal h3')?.textContent || ''`);
    if (/complete|failed/i.test(st)) { result.exportStatus = st; break; }
  }
  result.exportError = await q(`document.querySelector('.error-log')?.textContent || null`);
};
