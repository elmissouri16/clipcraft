// Video stabilization (like CapCut's): FFmpeg's vid.stab, in two passes over the clip's part of the file. Pass 1
// (vidstabdetect) measures the camera shake frame by frame; pass 2 (vidstabtransform) moves each frame against it
// along a smoothed path and zooms in just enough to hide the moving borders. The result is a new video file (the
// clip's range only, full quality), cached by file, range and level, that the clip then plays; the original
// stays untouched, so turning stabilization off gives the clip its original back.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// smoothing: frames averaged on each side for the camera path (more = steadier, more zoom); shakiness / accuracy
// of the analysis; zoom: extra zoom in percent on top of the automatic one; optzoom: 2 lets the transform pick
// the best per-frame zoom instead of one static zoom for the whole clip.
//
// Tuned 2026-11-01 against a ground-truth fixture (a still detailed scene shaken by a known analytic path;
// jitter = RMS frame-step of the recovered camera path via sub-pixel NCC, 720p, baseline 3.94 px): the old
// recommended (shakiness 7 / smoothing 20 / optzoom 1) left 0.12 px of jitter; shakiness 10 + smoothing 30 +
// optzoom 2 leaves 0.05 px, and adding the 3% static zoom 0.04 px. Heavier smoothing (60) is WORSE (0.14 px):
// the virtual camera lags the shake and the lag itself reads as jitter. Minimal (measured 0.66 px) stays the
// gentle option. For reference ffmpeg's deshake leaves 1.26 px on the same fixture. The old suite's
// "~25-36%" was its metric — mean frame difference over testsrc2, whose own content moves — not the
// stabilizer; scripts/test-stabilize.cjs now measures the camera path itself.
const LEVELS = {
  minimal: { name: 'Minimal crop', smoothing: 10, shakiness: 5, accuracy: 12, zoom: 0, optzoom: 1 },
  recommended: { name: 'Recommended', smoothing: 30, shakiness: 10, accuracy: 15, zoom: 0, optzoom: 2 },
  most: { name: 'Most stable', smoothing: 30, shakiness: 10, accuracy: 15, zoom: 3, optzoom: 2 },
};

const num = (v) => Number(v.toFixed(3)).toString();

function outFile(item, from, to, level, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|stab2|${num(from)}|${num(to)}|${level}`).digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-stab.mp4`);
}

// Runs FFmpeg in `cwd`; onTime(seconds done) from its progress output; isCanceled() stops it.
function run(ffmpegPath, args, cwd, onTime, isCanceled) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { cwd, windowsHide: true });
    let err = '';
    const timer = setInterval(() => { if (isCanceled()) p.kill(); }, 200);
    p.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m) onTime(Number(m[1]) / 1e6);
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('error', reject);
    p.on('close', (code) => {
      clearInterval(timer);
      if (isCanceled()) {
        const e = new Error('Canceled.');
        e.canceled = true;
        reject(e);
      } else if (code === 0) resolve();
      else {
        const memory = /malloc|cannot allocate memory|out of memory/i.test(err);
        reject(new Error(memory ? 'Not enough memory to stabilize this clip (is disk C: full? Windows needs free space there).'
          : `Stabilization failed: ${err.trim().split('\n').pop() || `FFmpeg exited with ${code}`}`));
      }
    });
  });
}

// item: { path, duration, hdr }; from / to: the clip's range in source seconds. Returns the stabilized file.
// onProgress(fraction 0..1) over both passes.
async function stabilize(item, { from = 0, to, level = 'recommended', cacheDir, ffmpegPath, toSdr = () => '', onProgress = () => {}, isCanceled = () => false }) {
  const L = LEVELS[level] || LEVELS.recommended;
  const a = Math.max(0, from);
  const b = Math.min(to ?? item.duration, item.duration || Infinity);
  const len = Math.max(0.1, b - a);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = outFile(item, a, b, level, cacheDir);
  if (fs.existsSync(out)) return out;
  // vid.stab's file options take plain names (a Windows path with "C:" would need filter escaping): FFmpeg runs in
  // the cache folder and the motion file has a simple name there.
  const trf = `${path.basename(out, '.mp4')}.trf`;
  const part = `${path.basename(out, '.mp4')}.part.mp4`;
  const sdr = toSdr(item);
  const input = ['-ss', num(a), '-t', num(len), '-i', item.path];
  try {
    await run(ffmpegPath, [...input, '-an', '-vf', `${sdr ? `${sdr.replace(/^,/, '')},` : ''}vidstabdetect=shakiness=${L.shakiness}:accuracy=${L.accuracy}:result=${trf}`,
      '-f', 'null', '-'], cacheDir, (t) => onProgress(Math.min(0.5, (t / len) * 0.5)), isCanceled);
    await run(ffmpegPath, [...input, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `${sdr ? `${sdr.replace(/^,/, '')},` : ''}vidstabtransform=input=${trf}:smoothing=${L.smoothing}:optzoom=${L.optzoom ?? 1}:zoom=${L.zoom}:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3,format=yuv420p`,
      ...(sdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', part],
    cacheDir, (t) => onProgress(Math.min(0.99, 0.5 + (t / len) * 0.5)), isCanceled);
    fs.renameSync(path.join(cacheDir, part), out);
    onProgress(1);
    return out;
  } finally {
    fs.rmSync(path.join(cacheDir, trf), { force: true });
    fs.rmSync(path.join(cacheDir, part), { force: true });
  }
}

module.exports = { stabilize, LEVELS, outFile };
