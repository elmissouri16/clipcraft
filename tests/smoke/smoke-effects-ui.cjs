// FVE_SMOKE_MODE=effects-ui: applying an effect is visible on the timeline. With a clip selected, an Effects
// tile puts the effect on that clip: a named badge appears on the clip (× removes it, clicking it opens the
// effect in the inspector) and the Effects lane shows "<name> · on clip". With nothing selected, the tile adds
// a free effect on the Effects track at the playhead, selected. Writes result.json; throws on the first failed check.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  const ff = require('../../electron/media/ffmpeg.cjs');
  const result = { checks: [] };
  const q = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (js, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(js)) return; await wait(50); } throw Error('Timeout: ' + js); };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  const capture = async (name) => { await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await wait(100); fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG()); };
  const tile = (name) => q(`[...document.querySelectorAll('.left .tile')].find((t) => t.querySelector('.tile-label')?.textContent === ${JSON.stringify(name)}).click()`);
  try {
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    const src = path.join(dir, 'source.mp4');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', src]);
    const media = { ...await ff.probe(src), id: 'm', path: src, name: 'source.mp4' };
    const project = { id: 'effects-ui', name: 'Effects UI', width: 640, height: 360, fps: 30, ratio: '16:9', background: '#000000', media: [media],
      videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
      overlayClips: [{ id: 'o', mediaId: 'm', in: 0, out: 3, speed: 1, start: 1 }], audioClips: [], textClips: [], stickerClips: [], effectClips: [] };
    await q(`window.__fve.load(${JSON.stringify(project)})`); await wait(600);

    // 1. On a selected clip.
    await q(`window.__fve.seek(2); window.__fve.select({ track: 'video', id: 'v' }); window.__fve.tab('effects')`); await wait(600);
    check('the Effects tab says the effect will go on the selected clip', await q(`/selected clip/i.test(document.querySelector('.left .fx-mode')?.textContent || '')`));
    await tile('Grain'); await wait(500);
    result.clipEffects = await q(`window.__fve.rawProject().videoClips[0].effects`);
    check('clicking a tile with a clip selected puts the effect on that clip', JSON.stringify(result.clipEffects) === '["grain"]');
    check('the tile shows as on', await q(`[...document.querySelectorAll('.left .tile')].find((t) => t.querySelector('.tile-label')?.textContent === 'Grain').getAttribute('aria-pressed') === 'true'`));
    const badge = `[...document.querySelectorAll('.clip.video .clip-tag.fx')].find((t) => t.textContent.includes('Grain'))`;
    check('the clip shows a named "Grain" badge', await q(`!!${badge}`));
    check('the Effects lane shows the effect bound to the clip', await q(`[...document.querySelectorAll('.clip.effect')].some((el) => /Grain · on clip/.test(el.textContent))`));
    await capture('effect-on-clip.png');
    await q(`${badge}.click()`); await wait(300);
    check('clicking the badge opens that effect (its lane object is selected)', await q(`document.querySelector('[data-sel-id="video|v|grain"]')?.classList.contains('selected')`));
    check('the inspector shows the effect', await q(`/Grain/.test(document.querySelector('.right, .inspector, aside.right')?.textContent || '')`));
    await q(`${badge}.querySelector('button').click()`); await wait(300);
    check('the badge’s × removes the effect from the clip', await q(`window.__fve.rawProject().videoClips[0].effects.length === 0 && !${badge}`));

    // 2. With nothing selected: a free effect at the playhead on the Effects track.
    await q(`window.__fve.select(null); window.__fve.seek(4)`); await wait(400);
    check('the Effects tab says the effect will go on the Effects track', await q(`/Effects track/.test(document.querySelector('.left .fx-mode')?.textContent || '')`));
    await tile('Blur'); await wait(500);
    result.free = await q(`(window.__fve.rawProject().effectClips || []).map((e) => ({ fx: e.fx, start: e.start, duration: e.duration }))`);
    check('clicking a tile with nothing selected adds a free effect at the playhead', result.free.length === 1 && result.free[0].fx === 'blur' && Math.abs(result.free[0].start - 4) < 0.05);
    check('the new free effect is selected on the Effects lane', await q(`!!document.querySelector('.clip.effect.selected') && /Blur/.test(document.querySelector('.clip.effect.selected').textContent)`));
    await capture('free-effect.png');
  } catch (error) { result.error = error.stack; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.quit();
};
