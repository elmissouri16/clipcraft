// FVE_SMOKE_MODE=filters: the Filters tab shows the clip with each look (not black tiles), a filter and its
// intensity change the clip, a LUT tile works, and the export matches the player.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require('./ffmpeg.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function filtersSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const until = async (js, ms) => { for (let t = 0; t < ms; t += 500) { if (await q(js)) return true; await wait(500); } return false; };
  const playerMean = async () => {
    const r = await q(`(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.35), y: Math.round(b.top + b.height * 0.35), width: Math.round(b.width * 0.3), height: Math.round(b.height * 0.3) }; })()`);
    const bmp = (await win.capturePage(r)).toBitmap();
    const s = [0, 0, 0];
    for (let i = 0; i < bmp.length; i += 4) { s[0] += bmp[i + 2]; s[1] += bmp[i + 1]; s[2] += bmp[i]; }
    return s.map((v) => Math.round(v / (bmp.length / 4)));
  };
  win.show();
  win.moveTop();
  await wait(800);
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
  result.before = await playerMean();
  await q(`[...document.querySelectorAll('.left .tile')].find((t) => t.querySelector('.tile-label').textContent === 'Teal & Orange').click()`);
  await wait(1200);
  result.filtered = await playerMean();
  await q(`(() => { const el = [...document.querySelectorAll('.left .filter-k input[type=range]')][0];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '60'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(1200);
  result.clip = await q(`(() => { const c = window.__fve.exportData().project.videoClips[0]; return { filter: c.filter, k: c.filterIntensity }; })()`);
  result.at60 = await playerMean();
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
  result.export = s.map((v) => Math.round(v / (buf.length / 3)));
  result.exportSize = [info.width, info.height];
};
