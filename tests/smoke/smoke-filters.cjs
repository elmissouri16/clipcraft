// FVE_SMOKE_MODE=filters: the Filters tab shows the clip with each look (not black tiles), clicking a tile
// sets the clip's filter and the player shows it (Black & White collapses the chroma of the colour bars),
// the intensity slider scales it, "Whole video" puts the look on the Effects track so an overlay picture takes it
// without any clip filter, and the export applies that layer the same way. Throws on the first failed check.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require("../../electron/media/ffmpeg.cjs");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function filtersSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const until = async (js, ms) => { for (let t = 0; t < ms; t += 500) { if (await q(js)) return true; await wait(500); } return false; };
  // Mean colour and mean chroma (max(r,g,b) - min(r,g,b)) of the middle of the player.
  const playerStats = async () => {
    const r = await q(`(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.35), y: Math.round(b.top + b.height * 0.35), width: Math.round(b.width * 0.3), height: Math.round(b.height * 0.3) }; })()`);
    // Whole-page capture, then crop: a region capture of the live WebGL player can land on an
    // all-black frame. An all-black crop is retried a few times before it counts as the picture.
    let stats = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const shot = await win.capturePage();
      const k = shot.getSize().width / (await q('window.innerWidth')); // device pixels per CSS pixel
      const img = shot.crop({ x: Math.round(r.x * k), y: Math.round(r.y * k), width: Math.round(r.width * k), height: Math.round(r.height * k) });
      fs.writeFileSync(path.join(dir, `player-crop-${playerStats.n = (playerStats.n || 0) + 1}.png`), img.toPNG());
      const bmp = img.toBitmap();
      const s = [0, 0, 0]; let c = 0;
      for (let i = 0; i < bmp.length; i += 4) { const B = bmp[i], G = bmp[i + 1], R = bmp[i + 2]; s[0] += R; s[1] += G; s[2] += B; c += Math.max(R, G, B) - Math.min(R, G, B); }
      const n = bmp.length / 4;
      stats = { mean: s.map((v) => Math.round(v / n)), chroma: Math.round(c / n), attempt };
      if (s[0] + s[1] + s[2] > 0) break;
      await wait(400);
    }
    return stats;
  };
  const check = (ok, what) => { if (!ok) throw new Error(what); (result.checks ||= []).push(what); };
  const setIntensity = async (v) => {
    await q(`(() => { const el = [...document.querySelectorAll('.left .filter-k input[type=range]')][0];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${v}'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(1200);
  };
  win.show();
  win.moveTop();
  await wait(800);
  // The app opens on the home screen: enter the editor first.
  if (!await until(`!!window.__fve && !!document.querySelector('.home-frame-card')`, 30000)) throw new Error('home screen did not appear');
  await q(`document.querySelector('.home-frame-card').click()`);
  if (!await until(`!!document.querySelector('.topbar')`, 30000)) throw new Error('editor did not open');
  await q(`document.querySelector('.welcome-go')?.click()`);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  project.videoClips = project.videoClips.slice(0, 1).map((c) => ({ ...c, filter: 'none', effects: [], transition: null }));
  Object.assign(project, { overlayClips: [], effectClips: [], stickerClips: [], textClips: [], markers: [] });
  await q(`window.__fve.load(${JSON.stringify(project)})`);
  await wait(1500);
  const id = project.videoClips[0].id;
  await q(`window.__fve.seek(1); window.__fve.select({ track: 'video', id: '${id}' }); window.__fve.tab('filters')`);
  await wait(2500);
  // Tiles: how many, and how bright each preview is (black tiles were the bug).
  result.tiles = await q(`[...document.querySelectorAll('.left .tile')].map((t) => {
    const c = t.querySelector('canvas'); if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
    return [t.querySelector('.tile-label').textContent, Math.round(s / (d.length / 16) / 3)]; })`);
  check(result.tiles.length >= 40 && result.tiles.every((t) => t && t[1] > 20), `filter tiles render the clip, none black (${result.tiles.length} tiles)`);
  // Black & White (saturation -100) is unmistakable on the colour bars: chroma collapses in the
  // player, scales with the intensity slider, and collapses in the export the same way.
  result.before = await playerStats();
  await q(`[...document.querySelectorAll('.left .tile')].find((t) => t.querySelector('.tile-label').textContent === 'Black & White').click()`);
  await wait(1200);
  result.bw = await playerStats();
  result.clip = await q(`(() => { const c = window.__fve.exportData().project.videoClips[0]; return { filter: c.filter, k: c.filterIntensity }; })()`);
  check(result.clip.filter === 'bw', `clicking a tile sets the clip's filter (${result.clip.filter})`);
  check(result.before.chroma > 100 && result.bw.chroma < result.before.chroma * 0.1, `the player shows the filter: chroma ${result.before.chroma} -> ${result.bw.chroma}`);
  await setIntensity(50);
  result.at50 = await playerStats();
  result.clip50 = await q(`window.__fve.exportData().project.videoClips[0].filterIntensity`);
  check(result.clip50 === 50, `the intensity slider writes filterIntensity (${result.clip50})`);
  check(result.at50.chroma > result.before.chroma * 0.3 && result.at50.chroma < result.before.chroma * 0.7, `50% intensity shows half the effect: chroma ${result.at50.chroma} of ${result.before.chroma}`);
  await setIntensity(100);

  // Whole video: the content on an overlay over a main clip without a filter (the common layout: a
  // background on the main track, the pictures above it). "Whole video" puts the look on the
  // Effects track; the overlay goes grey although no clip carries a filter.
  await q(`[...document.querySelectorAll('.left .tile')].find((t) => t.querySelector('.tile-label').textContent === 'None').click()`);
  await wait(400);
  await q(`window.__fve.dispatch({ type: 'addOverlayClip', mediaId: '${project.media[0].id}', clipId: 'ovl', at: 0 })`);
  await wait(1200);
  result.overlayBefore = await playerStats();
  check(result.overlayBefore.chroma > 100, `with the clip filter removed the picture is in colour again (chroma ${result.overlayBefore.chroma})`);
  await q(`[...document.querySelectorAll('.left .filter-scope button')].find((b) => b.textContent.trim() === 'Whole video').click()`);
  await wait(300);
  await q(`[...document.querySelectorAll('.left .tile')].find((t) => t.querySelector('.tile-label').textContent === 'Black & White').click()`);
  await wait(1500);
  result.whole = await playerStats();
  result.layer = await q(`(() => { const p = window.__fve.exportData().project; const e = (p.effectClips || []).find((x) => String(x.fx).startsWith('filter:')); return e ? { fx: e.fx, start: e.start, duration: e.duration, overlayFilter: (p.overlayClips.find((c) => c.id === 'ovl') || {}).filter || 'none', mainFilter: p.videoClips[0].filter } : null; })()`);
  check(result.layer && result.layer.fx === 'filter:bw' && result.layer.start === 0 && result.layer.duration >= 6, `Whole video adds a filter layer over the timeline (${JSON.stringify(result.layer)})`);
  check(result.layer.overlayFilter === 'none' && result.layer.mainFilter === 'none', 'no clip carries the filter itself');
  check(result.whole.chroma < result.overlayBefore.chroma * 0.1, `the overlay picture takes the whole-video look in the player: chroma ${result.overlayBefore.chroma} -> ${result.whole.chroma}`);
  check(await q(`[...document.querySelectorAll('.timeline .clip, .tl-clip, [class*="clip"]')].some((el) => /Black & White filter/.test(el.textContent))`), 'the Effects track shows the layer as "Black & White filter"');
  await setIntensity(50);
  result.whole50 = await playerStats();
  result.layer50 = await q(`window.__fve.exportData().project.effectClips.find((x) => String(x.fx).startsWith('filter:')).strength`);
  check(result.layer50 === 0.5 && result.whole50.chroma > result.overlayBefore.chroma * 0.3 && result.whole50.chroma < result.overlayBefore.chroma * 0.7, `the intensity slider sets the layer strength (${result.layer50}) and halves the effect (chroma ${result.whole50.chroma})`);
  await setIntensity(100);
  fs.writeFileSync(path.join(dir, 'filters-tab.png'), (await win.capturePage()).toPNG());

  const out = path.join(dir, 'ui-export.mp4');
  fs.rmSync(out, { force: true });
  await q('window.__fve.exportNow()');
  result.exportDone = await until(`!!document.querySelector('.modal-icon.ok, .modal-icon.error')`, 300000);
  result.exportResult = await q(`document.querySelector('#export-title')?.textContent || ''`);
  const info = await probe(out);
  const buf = execFileSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-vf', `crop=iw*0.3:ih*0.3:iw*0.35:ih*0.35`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e8 });
  const s = [0, 0, 0];
  for (let i = 0; i < buf.length; i += 3) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
  let c = 0; for (let i = 0; i < buf.length; i += 3) c += Math.max(buf[i], buf[i + 1], buf[i + 2]) - Math.min(buf[i], buf[i + 1], buf[i + 2]);
  result.export = { mean: s.map((v) => Math.round(v / (buf.length / 3))), chroma: Math.round(c / (buf.length / 3)) };
  result.exportSize = [info.width, info.height];
  const srcBuf = execFileSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', project.media.find((m) => m.id === project.videoClips[0].mediaId).path, '-frames:v', '1', '-vf', `scale=${info.width}:${info.height},crop=iw*0.3:ih*0.3:iw*0.35:ih*0.35`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e8 });
  let sc = 0; for (let i = 0; i < srcBuf.length; i += 3) sc += Math.max(srcBuf[i], srcBuf[i + 1], srcBuf[i + 2]) - Math.min(srcBuf[i], srcBuf[i + 1], srcBuf[i + 2]);
  result.sourceChroma = Math.round(sc / (srcBuf.length / 3));
  check(result.exportDone && /complete/i.test(result.exportResult), `the export finishes (${result.exportResult})`);
  check(result.sourceChroma > 100 && result.export.chroma < 15, `the export applies the whole-video filter like the player: chroma ${result.sourceChroma} (source) -> ${result.export.chroma} (export)`);
};
