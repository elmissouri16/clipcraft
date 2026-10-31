// Reverse playback for a clip's range (context menu → Reverse): FFmpeg's reverse / areverse
// filters render the clip's segment backwards into a cached derivative file. The clip then
// plays that file and remembers the original { mediaId, in, out } in clip.reversed, so choosing
// Reverse again restores the original exactly. The source file is never touched.
//
// The reverse filter holds the whole segment in memory frame by frame, so the range is capped
// at 20 seconds — longer ranges fail with that explanation rather than exhausting RAM.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_SECONDS = 20;
const num = (v) => Number(v.toFixed(3)).toString();

function outFile(item, from, to, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|rev1|${num(from)}|${num(to)}`).digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-rev.mp4`);
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
      else reject(new Error(`Reverse failed: ${err.trim().split('\n').pop() || `FFmpeg exited with ${code}`}`));
    });
  });
}

// item: { path, duration, hdr, hasAudio }; from / to: the clip's range in source seconds.
// Pure-audio items (no video stream) are rendered to an .mp4-shaped audio file the same way
// other derivative renders do it — callers pass hasVideo=false and only areverse runs.
async function reverse(item, { from = 0, to, hasVideo = true, cacheDir, ffmpegPath, toSdr = () => '', onProgress = () => {}, isCanceled = () => false }) {
  const a = Math.max(0, from);
  const b = Math.min(to ?? item.duration, item.duration || Infinity);
  const len = Math.max(0.1, b - a);
  if (len > MAX_SECONDS) {
    throw new Error(`Reverse holds the whole segment in memory, so it works on up to ${MAX_SECONDS} seconds at a time — this clip's range is ${len.toFixed(1)}s. Trim it shorter and reverse the part you need.`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = outFile(item, a, b, cacheDir);
  if (fs.existsSync(out)) return out;
  const part = `${path.basename(out, '.mp4')}.part.mp4`;
  const sdr = toSdr(item);
  const args = ['-ss', num(a), '-t', num(len), '-i', item.path];
  if (hasVideo) {
    args.push('-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `${sdr ? `${sdr.replace(/^,/, '')},` : ''}reverse,format=yuv420p`,
      ...(item.hasAudio ? ['-af', 'areverse'] : []),
      ...(sdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17',
      ...(item.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-movflags', '+faststart', '-y', part);
  } else {
    args.push('-map', '0:a:0', '-af', 'areverse', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', part);
  }
  try {
    await run(ffmpegPath, args, cacheDir, (t) => onProgress(Math.min(0.99, t / len)), isCanceled);
    fs.renameSync(path.join(cacheDir, part), out);
    onProgress(1);
    return out;
  } finally {
    fs.rmSync(path.join(cacheDir, part), { force: true });
  }
}

module.exports = { reverse, outFile, MAX_SECONDS };
