// Voice Enhancer (clip Audio tab, like CapCut's / Adobe's enhance): cleans a clip's voice
// locally with the filters the bundled FFmpeg actually ships. Inventory of this build:
// afftdn / anlmdn / arnndn / highpass / lowpass / equalizer / acompressor / agate / dynaudnorm /
// loudnorm / speechnorm all exist — but arnndn needs external RNNoise model files (not bundled),
// dynaudnorm / loudnorm / speechnorm are normalizers (they RAISE the noise floor in pauses, the
// opposite of cleaning), and anlmdn measured ~0 dB on a noisy fixture. So the chain is:
//   highpass (rumble) -> afftdn (FFT denoise) -> [Strong: agate (gentle downward expansion)]
//   -> EQ (mud cut + presence) -> acompressor (even levels, modest makeup).
// afftdn only works when its noise floor (nf) sits near the recording's real floor (measured:
// the default -50 does nothing on a -29 dB floor; nf a touch under the floor removes 10+ dB),
// so the render first measures the clip: the 5th-percentile 50 ms window RMS of the range is
// the noise estimate, and nf / the gate threshold derive from it per file, per range.
//
// Architecture mirrors detach.cjs: a content-hash cached WAV of the clip's range [from, to]
// (48 kHz stereo PCM). The clip stores clip.enhance = { on, strength, path, from, to }; the
// preview plays the cached file in place of the clip's own sound and the export uses it as the
// clip's audio source, so both hear exactly the same thing. If the clip is re-trimmed, the
// stored from/to no longer match and the enhancement is inert until re-run (the UI says so).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const num = (v) => Number(v.toFixed(3)).toString();
const STRENGTHS = ['light', 'standard', 'strong'];

// The filter chain for a strength, given the measured noise floor (dBFS) of the range.
// Exported for scripts/test-enhance.cjs, which measures the same fixture end to end.
function chainFor(strength, noiseDb) {
  const nf = Math.round(Math.min(-24, Math.max(-70, noiseDb - 2)));
  const eq = (mud, pres) => [
    `equalizer=f=300:width_type=o:width=1.5:g=${mud}`,
    `equalizer=f=3200:width_type=o:width=1.5:g=${pres}`,
  ];
  if (strength === 'light') {
    return ['highpass=f=70', `afftdn=nr=8:nf=${nf}`, ...eq(-2, 2),
      'acompressor=threshold=0.3:ratio=2:attack=20:release=200:makeup=1.15'].join(',');
  }
  if (strength === 'strong') {
    const gateThr = Math.min(0.25, Math.max(0.008, 2.5 * Math.pow(10, noiseDb / 20)));
    return ['highpass=f=90', `afftdn=nr=26:nf=${nf}`,
      `agate=threshold=${num(gateThr)}:ratio=4:attack=5:release=160`, ...eq(-3, 3),
      'acompressor=threshold=0.24:ratio=4:attack=12:release=160:makeup=1.45'].join(',');
  }
  return ['highpass=f=80', `afftdn=nr=16:nf=${nf}`, ...eq(-3, 3),
    'acompressor=threshold=0.26:ratio=3:attack=15:release=180:makeup=1.3'].join(',');
}

// The noise estimate of a range: decode it (mono f32) and take the 5th-percentile 50 ms window
// RMS in dBFS. Quiet pauses dominate the low percentiles of real speech; pure loud content just
// yields a high estimate, which the clamps in chainFor keep safe.
function measureNoise(ffmpegPath, item, from, to, isCanceled = () => false) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-v', 'error', '-ss', num(from), '-t', num(Math.max(0.1, to - from)),
      '-i', item.path, '-map', '0:a:0', '-vn', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { windowsHide: true });
    const timer = setInterval(() => { if (isCanceled()) p.kill(); }, 200);
    const WIN = 2400; // 50 ms at 48 kHz
    let sums = [];
    let cur = 0;
    let cnt = 0;
    let tail = Buffer.alloc(0);
    p.stdout.on('data', (d) => {
      const buf = tail.length ? Buffer.concat([tail, d]) : d;
      const usable = buf.length - (buf.length % 4);
      for (let i = 0; i < usable; i += 4) {
        const v = buf.readFloatLE(i);
        cur += v * v;
        if (++cnt === WIN) { sums.push(cur / WIN); cur = 0; cnt = 0; }
      }
      tail = buf.subarray(usable);
    });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
    p.on('error', reject);
    p.on('close', (code) => {
      clearInterval(timer);
      if (isCanceled()) {
        const e = new Error('Canceled.');
        e.canceled = true;
        return reject(e);
      }
      if (code !== 0 || !sums.length) return reject(new Error(`Could not measure the clip's sound. ${err.trim().split('\n').pop() || ''}`.trim()));
      sums.sort((a, b) => a - b);
      const p5 = sums[Math.min(sums.length - 1, Math.floor(sums.length * 0.05))];
      resolve(10 * Math.log10(p5 + 1e-12));
    });
  });
}

function outFile(item, from, to, strength, noiseDb, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1')
    .update(`${item.path}|${st.size}|${st.mtimeMs}|enhance2|${strength}|${num(from)}|${num(to)}|nf${Math.round(noiseDb)}`)
    .digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-enhance-${strength}.wav`);
}

function run(ffmpegPath, args, cwd, onTime, isCanceled, len) {
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
      else reject(new Error(`Voice enhancement failed: ${err.trim().split('\n').pop() || `FFmpeg exited with ${code}`}`));
    });
  });
}

// item: { path, duration, hasAudio }; from / to: the clip's range in source seconds.
// Returns the cached enhanced WAV covering exactly [from, to].
async function enhance(item, { from = 0, to, strength = 'standard', cacheDir, ffmpegPath, onProgress = () => {}, isCanceled = () => false }) {
  if (!STRENGTHS.includes(strength)) throw new Error(`Unknown enhance strength: ${strength}`);
  const a = Math.max(0, from);
  const b = Math.min(to ?? item.duration, item.duration || Infinity);
  const len = Math.max(0.1, b - a);
  fs.mkdirSync(cacheDir, { recursive: true });
  const noiseDb = await measureNoise(ffmpegPath, item, a, b, isCanceled);
  const out = outFile(item, a, b, strength, noiseDb, cacheDir);
  if (fs.existsSync(out)) { onProgress(1); return { path: out, noiseDb }; }
  const part = `${path.basename(out, '.wav')}.part.wav`;
  const args = ['-ss', num(a), '-t', num(len), '-i', item.path,
    '-map', '0:a:0', '-vn', '-af', chainFor(strength, noiseDb), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-y', part];
  try {
    await run(ffmpegPath, args, cacheDir, (t) => onProgress(Math.min(0.99, t / len)), isCanceled, len);
    fs.renameSync(path.join(cacheDir, part), out);
    onProgress(1);
    return { path: out, noiseDb };
  } finally {
    fs.rmSync(path.join(cacheDir, part), { force: true });
  }
}

module.exports = { enhance, chainFor, measureNoise, STRENGTHS };
