// FVE_SMOKE_MODE=textanimword: word-by-word unit mode end to end — apply Slide Up through the Text
// Animations browser, switch its unit to "Word by word", then export through the real pipeline. The
// runner (scripts/test-textanim-word-export.cjs) pixel-checks the exported frames: word 1 must be
// entering while word 2 is not on screen yet. Needs <dir>/project.json with text clip 't1' at 0.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function textanimWordSmoke(win, dir, result) {
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
  await q(`window.__fve.select({ track: 'text', id: 't1' }); window.__fve.seek(2)`);
  await wait(400);

  // Text inspector > Animation tab, In section.
  await click('.text-inspector .seg-tabs button', 'Animation');
  await wait(400);

  // Apply Slide Up through its tile (exact title: name + tuned duration).
  await q(`[...document.querySelectorAll('.tan .tpl-btn')].find((b) => b.title === 'Slide Up · 0.5s').click()`);
  await wait(250);
  result.unitButtons = await q(`document.querySelectorAll('.tan-unit button').length`);

  // Switch the unit to Word by word, exactly like a user.
  await click('.tan-unit button', 'Word by word');
  await wait(250);
  result.animIn = (await clip()).animIn;
  await shot('textanimword-panel.png', '.inspector');

  // Mid-animation frame in the player: seek to 0.1 s of the 0.5 s entrance — word 1 mid-rise, word 2
  // not started. The screenshot is evidence for a human; the runner asserts on the export's pixels.
  await q(`window.__fve.seek(0.1)`);
  await wait(700);
  await shot('textanimword-mid.png');

  // Full UI export (text frames + FFmpeg) — the export lands at <dir>/ui-export.mp4 in smoke mode.
  await q(`window.__fve.exportNow()`);
  for (let i = 0; i < 240; i++) {
    await wait(500);
    const st = await q(`document.querySelector('.modal h3')?.textContent || ''`);
    if (/complete|failed/i.test(st)) { result.exportStatus = st; break; }
  }
  result.exportError = await q(`document.querySelector('.error-log')?.textContent || null`);
};
