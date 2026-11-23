// Detach audio (clip menu → Detach audio): the sound of a video clip's range is rendered
// into its own audio file, which then lives on the Audio track as a clip LINKED to the
// picture clip (the pair carries a shared linkId in the project; src/state/store.js keeps them
// in sync). Extraction is a plain stream render — no memory-hungry filters — so there is
// no length cap like Reverse has. Results are cached by file + range, like reverse.cjs.
const crypto = require('crypto');
// Temporary names carry this process's tag: two running instances never write the same partial file.
const PART_TAG = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const fs = require('fs');
const path = require('path');
const { spawn } = require('../system/childProcesses.cjs');
const { t } = require('../system/i18n.cjs');

// Seek, length and cache key use microsecond precision: a range rounded to milliseconds could
// render a file shorter than the clip, which the link check then refuses.
const exact = (v) => Number(v.toFixed(6)).toString();
const RATE = 48000;

function outFile(item, from, to, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|detach4|${item.channels || 0}|${exact(from)}|${exact(to)}`).digest('hex').slice(0, 16);
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
      else reject(new Error(t('main.detach_audio_failed', { reason: err.trim().split('\n').pop() || t('main.ffmpeg_exited_with', { code }) })));
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
  const part = `${path.basename(out, '.wav')}.${PART_TAG}.part.wav`;
  // The file starts at the range's first source second even when the audio stream starts later
  // (recorded WebM): that lead-in is kept as silence, so the sound stays with its picture.
  // The result is padded with silence (a sound stream that ends before its picture) and cut to
  // exactly the clip's length rounded UP to a whole sample, so the file is never shorter.
  const samples = Math.ceil(len * RATE - 1e-6);
  const pan = item.channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : '';
  const args = ['-ss', exact(a), '-t', exact(len), '-i', item.path,
    '-map', '0:a:0', '-vn', '-af', `${pan}aresample=${RATE}:async=1:min_hard_comp=0.1:first_pts=0,apad=whole_len=${samples},atrim=end_sample=${samples}`,
    '-c:a', 'pcm_s16le', '-ar', String(RATE), '-ac', '2', '-y', part];
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
