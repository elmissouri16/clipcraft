// FVE_SMOKE_MODE=anim: clip animations and keyframes through the real interface, then an export.
// Needs <dir>/project.json with an overlay clip 'o1' that starts at 1 s and lasts at least 5 s.
const fs = require('fs');
const path = require('path');
const { probe } = require('./ffmpeg.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function animSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name, sel) => {
    const rect = sel ? await q(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`) : null;
    fs.writeFileSync(path.join(dir, name), (await (rect ? win.capturePage(rect) : win.capturePage())).toPNG());
  };
  const until = async (js, ms = 30000) => { for (let t = 0; t < ms; t += 250) { if (await q(js)) return true; await wait(250); } return false; };
  const o1 = () => q(`window.__fve.exportData().project.overlayClips.find((c) => c.id === 'o1')`);
  const click = (sel, text) => q(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const clickLabel = (label) => q(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
  const setVal = (sel, v) => q(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(v))}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  win.setContentSize(1440, 900);
  await wait(800);
  await q(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
  await wait(800);
  await q(`window.__fve.select({ track: 'overlay', id: 'o1' }); window.__fve.seek(2)`);
  await wait(400);
  if (process.env.FVE_EXPORT_ONLY) return exportIt();

  // Animation tab: In, Out, Combo.
  await click('.clip-inspector .ci-tabs button', 'Animation');
  await wait(300);
  result.inTiles = await q(`document.querySelectorAll('.anim-grid .tile').length`);
  await click('.anim-grid .tile', 'Zoom In');
  await wait(200);
  result.in = (await o1()).anim;
  await click('.anim-panel .seg-tabs button', 'Out');
  await wait(200);
  await click('.anim-grid .tile', 'Fade Out');
  await wait(200);
  result.inOut = (await o1()).anim;
  result.bands = await q(`[...document.querySelectorAll('.clip.overlay .anim-band')].map((b) => b.className)`);
  await q(`document.querySelector('.anim-grid .tile').dispatchEvent(new PointerEvent('pointerenter'))`);
  await shot('anim-panel.png', '.inspector');
  await click('.anim-panel .seg-tabs button', 'Combo');
  await wait(200);
  await click('.anim-grid .tile', 'Pulse');
  await wait(200);
  result.combo = (await o1()).anim;
  await click('.anim-grid .tile', 'None');
  await wait(200);
  result.none = (await o1()).anim;
  await click('.anim-panel .seg-tabs button', 'In');
  await wait(200);
  await click('.anim-grid .tile', 'Zoom In');
  await wait(200);

  // Keyframes: position at 2 s (clip time 1), then a new value at 4 s adds a second keyframe.
  await click('.clip-inspector .ci-tabs button', 'Video');
  await wait(300);
  const x0 = (await o1()).transform.x;
  await clickLabel('Add position keyframe');
  await wait(200);
  result.key1 = (await o1()).keyframes;
  await q('window.__fve.seek(4)');
  await wait(300);
  await setVal('.clip-inspector .numrow .numbox input', 200);
  await wait(200);
  result.key2 = (await o1()).keyframes;
  result.diamondOn = await q(`!!document.querySelector('[aria-label="Remove position keyframe"]')`);
  result.dots = await q(`document.querySelectorAll('.clip.overlay .kf-dot').length`);
  // Halfway between the keyframes the player shows the clip halfway (zoom-in is over by then).
  await q('window.__fve.seek(3)');
  await wait(400);
  const W = await q('window.__fve.exportData().project.width');
  result.layerAt3 = await q(`document.querySelectorAll('.slot.ov .layer')[0].style.transform`);
  result.expectX = ((x0 + 200 / W) / 2) * 100;
  result.inspectorX = await q(`document.querySelector('.clip-inspector .numrow .numbox input').value`);
  // Previous-keyframe button jumps to the first keyframe (2 s).
  await clickLabel('Previous position keyframe');
  await wait(300);
  result.afterPrev = await q('window.__fve.exportData().project && document.querySelector(".tc b").textContent');
  // Dragging the picture in the player at 3 s adds a third position keyframe.
  await q('window.__fve.seek(3)');
  await wait(400);
  await q(`(() => { const r = document.querySelector('.tbox').getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    document.querySelector('.tbox').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 40, clientY: y + 20 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 40, clientY: y + 20 })); })()`);
  await wait(300);
  result.key3 = (await o1()).keyframes;
  await shot('anim-keys.png');
  result.motion = await q(`(() => { const m = window.__fve.exportData().project.motion.o1; return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.length])); })()`);

  await exportIt();

  // Export through the app.
  async function exportIt() {
  const out = path.join(dir, 'ui-export.mp4');
  fs.rmSync(out, { force: true });
  await q('window.__fve.exportNow()');
  result.exportDone = await until(`!!document.querySelector('.modal-icon.ok, .modal-icon.error')`, 300000);
  result.exportResult = await q(`document.querySelector('#export-title')?.textContent + ' ' + (document.querySelector('.error-log')?.textContent || '')`);
  if (fs.existsSync(out)) result.exportInfo = await probe(out);
}
};
