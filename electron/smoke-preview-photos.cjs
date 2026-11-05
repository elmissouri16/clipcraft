const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PHOTO_IDS } = require('../scripts/fetch-preview-photos.cjs');

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
  const ready = `document.querySelectorAll('.home-frame-img').length === 5 && [...document.querySelectorAll('.home-frame-img')].every(img => img.complete && img.naturalWidth > 0)`;
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await until(ready);
    result.homePhotos = await q(`[...document.querySelectorAll('.home-frame-img')].map(img => ({url:img.getAttribute('src'),width:img.naturalWidth,height:img.naturalHeight}))`);
    assert.ok(result.homePhotos.every((photo) => photo.url.startsWith('./preview/') && photo.width === 640));
    result.decodedPhotos = await q(`Promise.all(${JSON.stringify(PHOTO_IDS)}.map(id => new Promise(resolve => {
      const img = new Image(); img.onload = () => resolve({id,width:img.naturalWidth,height:img.naturalHeight});
      img.onerror = () => resolve({id,error:'Image failed to decode'}); img.src='./preview/p'+id+'.jpg';
    })))`);
    assert.ok(result.decodedPhotos.every((photo) => photo.width === 640 && photo.height === 400));
    await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(dir, 'home-photos.png'), (await win.capturePage()).toPNG());

    // Force a failed local image without removing the user's cached files.
    await q(`document.querySelector('.home-frame-img').src='./preview/missing-preview-for-test.jpg'`);
    await until(`document.querySelector('.home-frame-img').src.startsWith('data:image/jpeg') && document.querySelector('.home-frame-img').naturalWidth === 320`);
    result.fallbackDecoded = true;
    fs.writeFileSync(path.join(dir, 'home-fallback.png'), (await win.capturePage()).toPNG());
    await q(`document.querySelector('.home-frame-card').click()`);
    await until(`!!document.querySelector('.topbar')`);
    await q(`document.querySelector('.welcome-go')?.click()`);
    assert.equal(await q('window.__fve.exportData().project.ratio'), '16:9');
    await q(`document.querySelector('button[aria-label="Projects"]').click()`);
    await until(ready);
    assert.ok(await q(`[...document.querySelectorAll('.home-frame-img')].every(img => img.getAttribute('src').startsWith('./preview/'))`));
    result.presetNavigation = true;
    result.photosRestoredOnReturn = true;
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.ok = false; result.error = error.stack;
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
