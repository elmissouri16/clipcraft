// FVE_SMOKE_MODE=lut: a bundled LUT alone on a clip; the export must match FFmpeg's own lut3d filter applied to the
// same source frame (an independent reference for the GPU LUT pass).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require('./ffmpeg.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function lutSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const until = async (js, ms) => { for (let t = 0; t < ms; t += 500) { if (await q(js)) return true; await wait(500); } return false; };
  win.show();
  await wait(800);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  const file = process.env.FVE_LUT || 'slay-04-film.cube';
  project.videoClips = project.videoClips.slice(0, 1).map((c) => ({ ...c, filter: 'none', effects: [], transition: null, grade: { lut: { ref: { bundled: file }, name: 'x', intensity: 100 } } }));
  Object.assign(project, { overlayClips: [], effectClips: [], stickerClips: [], textClips: [], markers: [] });
  await q(`window.__fve.load(${JSON.stringify(project)})`);
  await wait(1500);
  const out = path.join(dir, 'ui-export.mp4');
  fs.rmSync(out, { force: true });
  await q('window.__fve.exportNow()');
  result.exportDone = await until(`!!document.querySelector('.modal-icon.ok, .modal-icon.error')`, 300000);
  result.exportResult = await q(`document.querySelector('#export-title')?.textContent || ''`);
  const info = await probe(out);
  const m = project.media.find((x) => x.id === project.videoClips[0].mediaId);
  // FFmpeg runs in the LUT folder so the filter gets a plain file name (no drive letter to escape).
  const lutPath = file;
  const grab = (args) => execFileSync(ffmpegPath, ['-v', 'error', ...args, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1e8, cwd: path.join(__dirname, '..', 'shared', 'luts') });
  const ours = grab(['-ss', '1', '-i', out, '-vf', `scale=${info.width}:${info.height}`]);
  const ref = grab(['-ss', String(project.videoClips[0].in + 1), '-i', m.path, '-vf', `scale=${info.width}:${info.height},format=rgb24,lut3d=file='${lutPath}':interp=trilinear`]);
  const plain = grab(['-ss', String(project.videoClips[0].in + 1), '-i', m.path, '-vf', `scale=${info.width}:${info.height}`]);
  const mean = (buf, x0, y0, x1, y1) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(y0 * info.height); y < Math.floor(y1 * info.height); y += 2) for (let x = Math.floor(x0 * info.width); x < Math.floor(x1 * info.width); x += 2) {
      const i = (y * info.width + x) * 3;
      s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; n++;
    }
    return s.map((v) => Math.round(v / n));
  };
  const areas = [[0.05, 0.05, 0.3, 0.3], [0.35, 0.35, 0.65, 0.65], [0.6, 0.6, 0.95, 0.95], [0.05, 0.6, 0.3, 0.95]];
  result.ours = areas.map((a) => mean(ours, ...a));
  result.ffmpegLut3d = areas.map((a) => mean(ref, ...a));
  result.withoutLut = areas.map((a) => mean(plain, ...a));
};
