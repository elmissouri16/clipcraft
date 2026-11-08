const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PHOTO_IDS } = require("../../scripts/fetch-preview-photos.cjs");

module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const result = { errors: [] };
  const q = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js) => {
    for (let i = 0; i < 150; i++) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3 && /Uncaught|TypeError|ReferenceError/.test(message)) result.errors.push(message);
  });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    // The bundled preview photos (used by effect, mask and title previews) all decode.
    result.decodedPhotos = await q(`Promise.all(${JSON.stringify(PHOTO_IDS)}.map(id => new Promise(resolve => {
      const img = new Image(); img.onload = () => resolve({id,width:img.naturalWidth,height:img.naturalHeight});
      img.onerror = () => resolve({id,error:'Image failed to decode'}); img.src='./preview/p'+id+'.jpg';
    })))`);
    assert.ok(result.decodedPhotos.every((photo) => photo.width === 640 && photo.height === 400));
    // A format on Home starts a project in that format, and Projects returns to Home.
    await q(`document.querySelector('.home-frame-card').click()`);
    await until(`!!document.querySelector('.topbar')`);
    await q(`document.querySelector('.welcome-go')?.click()`);
    assert.equal(await q('window.__fve.exportData().project.ratio'), '16:9');
    await q(`document.querySelector('button[aria-label="Projects"]').click()`);
    await until(`document.querySelectorAll('.home-frame-card').length === 5`);
    result.presetNavigation = true;
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.ok = false; result.error = error.stack;
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
