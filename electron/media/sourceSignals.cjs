// Streaming, bounded local measurements. These signals locate places to look;
// they do not recognize actions, emotions or the meaning of audio.
const { spawn } = require('../system/childProcesses.cjs');
const fs = require('node:fs');
const { ffmpegPath, probe, toSdr } = require('./ffmpeg.cjs');
const abortError = () => Object.assign(Error('Video indexing stopped.'), { name: 'AbortError' });
function decode(args, signal, consume, diagnostic = () => {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '', failure;
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });if (signal?.aborted) abort();
    child.stdout.on('data', bytes => { try { consume(bytes); } catch (e) { failure = e;abort(); } });
    child.stderr.on('data', bytes => { error = (error + bytes).slice(-3000);try { diagnostic(bytes.toString()); } catch (e) { failure = e;abort(); } });
    child.once('error', e => { signal?.removeEventListener('abort', abort);reject(e); });
    child.once('close', code => { signal?.removeEventListener('abort', abort);if (signal?.aborted) reject(abortError());else if (failure) reject(failure);else if (code !== 0) reject(Error(`Source processing failed. ${error}`));else resolve(); });
  });
}
const round = n => Math.round(n * 1000) / 1000;
async function scanChunk(file, start, end, hasAudio, signal) {
  const duration = end - start, input = ['-ss', String(start), '-t', String(duration), '-i', file];
  const bins = [], cuts = [], size = 96 * 54;let pending = Buffer.alloc(0), previous, count = 0, log = '';
  await decode(['-v', 'info', ...input, '-map', '0:V:0', '-an', '-vf',
    'scale=96:54:force_original_aspect_ratio=decrease,pad=96:54:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS,scdet=threshold=10,metadata=print:key=lavfi.scd.time,fps=2,format=gray',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], signal, bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= size) {
      const frame = pending.subarray(0, size);let difference = 0, light = 0;
      for (let i = 0; i < size; i++) { light += frame[i];if (previous) difference += Math.abs(frame[i] - previous[i]); }
      if (count / 2 < duration) bins.push({ time_sec: round(start + count / 2), change: round(difference / size / 255), light: round(light / size / 255) });
      previous = Buffer.from(frame);pending = pending.subarray(size);count++;
      if (count > Math.ceil(duration * 2) + 4) throw Error('Source decoder exceeded its chunk.');
    }
  }, text => {
    log += text;const lines = log.split(/\r?\n/);log = lines.pop();
    for (const line of lines) { const match = /lavfi\.scd\.time=([\d.]+)/.exec(line);if (match) { const t = start + Number(match[1]);if (t > start && t < end) cuts.push(round(t)); } }
    if (log.length > 65536 || cuts.length > 10000) throw Error('Too many shot boundaries in this chunk.');
  });
  if (!bins.length) throw Error('No video frames could be decoded in this chunk.');
  if (hasAudio) {
    let rest = Buffer.alloc(0), squares = 0, peak = 0, samples = 0, bin = 0;
    const flush = () => { if (bins[bin] && samples) { bins[bin].rms_db = round(Math.max(-120, 10 * Math.log10(Math.max(1e-12, squares / samples))));bins[bin].peak = round(peak); }bin++;squares = 0;peak = 0;samples = 0; };
    await decode(['-v', 'error', ...input, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '8000', '-f', 'f32le', '-'], signal, bytes => {
      rest = Buffer.concat([rest, bytes]);let at = 0;
      for (; at + 4 <= rest.length; at += 4) { const v = rest.readFloatLE(at);if (!Number.isFinite(v)) throw Error('Invalid decoded audio.');squares += v * v;peak = Math.max(peak, Math.abs(v));samples++;if (samples === 8000) flush(); }
      rest = Buffer.from(rest.subarray(at));if (bin > Math.ceil(duration * 2) + 4) throw Error('Audio decoder exceeded its chunk.');
    });
    flush();
  }
  return { bins, cuts: [...new Set(cuts)], sample_interval_sec: .5 };
}
async function encodePreview(file, target, start, end, signal) {
  try {
    const sdr = toSdr(await probe(file)).replace(/^,/, '');
    await decode(['-v', 'error', '-y', '-ss', String(start), '-t', String(end - start), '-i', file,
      '-map', '0:V:0', '-map', '0:a:0?', '-vf', `${sdr ? sdr + ',' : ''}scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
      '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-ac', '2', '-b:a', '96k', '-movflags', '+faststart', target], signal, () => {});
  } catch (error) { fs.rmSync(target, { force: true });throw error; }
}
module.exports = { scanChunk, encodePreview, abortError };
