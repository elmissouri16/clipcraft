// Detach audio (clip menu → Detach audio): the sound of a video clip's range is rendered
// into its own audio file, which then lives on the Audio track as a clip LINKED to the
// picture clip (the pair carries a shared linkId in the project; src/store.js keeps them
// in sync). Extraction is a plain stream render — no memory-hungry filters — so there is
// no length cap like Reverse has. Results are cached by file + range, like reverse.cjs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const num = (v) => Number(v.toFixed(3)).toString();

function outFile(item, from, to, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|detach1|${num(from)}|${num(to)}`).digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-detach.wav`);
}

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
      else reject(new Error(`Detach audio failed: ${err.trim().split('\n').pop() || `FFmpeg exited with ${code}`}`));
    });
  });
}

// item: { path, duration, hasAudio }; from / to: the clip's range in source seconds.
// The whole range is extracted (not just the audible part): the clip's in/out window on
// the Audio track then maps 1:1 onto the picture clip's window through the link offsets.
async function detach(item, { from = 0, to, cacheDir, ffmpegPath, onProgress = () => {}, isCanceled = () => false }) {
  const a = Math.max(0, from);
  const b = Math.min(to ?? item.duration, item.duration || Infinity);
  const len = Math.max(0.1, b - a);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = outFile(item, a, b, cacheDir);
  if (fs.existsSync(out)) return out;
  const part = `${path.basename(out, '.wav')}.part.wav`;
  const args = ['-ss', num(a), '-t', num(len), '-i', item.path,
    '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-y', part];
  try {
    await run(ffmpegPath, args, cacheDir, (t) => onProgress(Math.min(0.99, t / len)), isCanceled);
    fs.renameSync(path.join(cacheDir, part), out);
    onProgress(1);
    return out;
  } finally {
    fs.rmSync(path.join(cacheDir, part), { force: true });
  }
}

module.exports = { detach };
