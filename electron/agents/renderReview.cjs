// Local measurements of a completed render. No network, inference service or
// transcription download. Candidates describe signals, never editing intent.
const { spawn } = require('node:child_process');
const ff = require('../media/ffmpeg.cjs');
const { sourceFrame } = require('./agentFrames.cjs');
const round = value => Math.round(value * 1000) / 1000;
const db = value => Math.max(-120, Math.round(20 * Math.log10(Math.max(1e-6, value)) * 10) / 10);
const stop = signal => { if (signal?.aborted) throw Object.assign(Error('Rendered review stopped.'), { name: 'AbortError' }); };

function decode(args, signal, consume, line = () => {}) {
  stop(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(ff.ffmpegPath, ['-hide_banner', '-nostats', ...args], { signal, windowsHide: true });
    let tail = '', pending = '', failed = false;
    child.stdout.on('data', bytes => {
      if (failed) return;
      try { consume(bytes); } catch (error) { failed = true;child.kill('SIGKILL');reject(error); }
    });
    child.stderr.on('data', bytes => {
      tail = (tail + bytes).slice(-3000);pending += bytes;
      const lines = pending.split(/\r?\n/);pending = lines.pop().slice(-4000);
      for (const text of lines) line(text);
    });
    child.once('error', reject);
    child.once('close', code => {
      if (failed) return;
      if (signal?.aborted) return reject(Object.assign(Error('Rendered review stopped.'), { name: 'AbortError' }));
      code === 0 ? resolve() : reject(Error(`The rendered file could not be decoded: ${tail.slice(-1200)}`));
    });
  });
}
async function videoSignals(file, info, signal, duration = Math.min(30, info.duration)) {
  const W = 160, H = 90, bytesPerFrame = W * H, fps = info.fps || 30;
  let pending = Buffer.alloc(0), previous, frames = 0, sum = 0, blackStart = null, stillStart = null, priorPts;
  const black = [], still = [], changes = [], gaps = [];
  const close = (list, start, end, min) => { if (start !== null && end - start >= min && list.length < 12) list.push({ start_sec: round(start), end_sec: round(end) }); };
  await decode(['-v', 'info', '-i', file, '-t', String(duration), '-map', '0:V:0', '-an', '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,format=gray,showinfo`, '-fps_mode', 'passthrough', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], signal, bytes => {
    pending = Buffer.concat([pending, bytes]);
    while (pending.length >= bytesPerFrame) {
      if (frames >= 2400) throw Error('Review decode exceeded the bounded frame count.');
      const frame = pending.subarray(0, bytesPerFrame);pending = pending.subarray(bytesPerFrame);
      let delta = 0, maximum = 0;
      for (let i = 0; i < bytesPerFrame; i++) { maximum = Math.max(maximum, frame[i]);if (previous) delta += Math.abs(frame[i] - previous[i]); }
      const time = frames / fps, change = previous ? delta / (bytesPerFrame * 255) : 0;
      if (previous) {
        sum += change;changes.push({ time_sec: round(time), normalized_difference: round(change) });
        changes.sort((a, b) => b.normalized_difference - a.normalized_difference);if (changes.length > 6) changes.pop();
      }
      if (maximum < 24) blackStart ??= time;else { close(black, blackStart, time, .2);blackStart = null; }
      if (previous && change < .0004) stillStart ??= Math.max(0, time - 1 / fps);else { close(still, stillStart, time, .5);stillStart = null; }
      previous = frame;frames++;
    }
  }, line => {
    const match = /\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([\d.e+-]+)/.exec(line);
    if (!match) return;
    const pts = Number(match[1]);
    if (priorPts !== undefined && (pts <= priorPts || pts - priorPts > 1.8 / fps) && gaps.length < 12) gaps.push({ time_sec: round(pts), gap_sec: round(pts - priorPts) });
    priorPts = pts;
  });
  if (!frames || pending.length) throw Error('The rendered video has incomplete decoded frames.');
  close(black, blackStart, frames / fps, .2);close(still, stillStart, frames / fps, .5);
  return { decoded_frames: frames, mean_adjacent_frame_difference: round(sum / Math.max(1, frames - 1)), largest_frame_changes: changes.sort((a, b) => a.time_sec - b.time_sec), black_candidates: black, still_candidates: still, timestamp_gap_candidates: gaps };
}
async function audioSignals(file, signal, duration = 30) {
  // Measure channels independently rather than summing to mono: opposite-phase
  // stereo is audible but would cancel and be falsely reported as silence.
  const rate = 48000, samplesPerSecond = rate * 2, binSize = samplesPerSecond / 2;
  let pending = Buffer.alloc(0), count = 0, squares = 0, peak = 0, clipped = 0, binCount = 0, binSquares = 0, binPeak = 0;
  const levels = [];
  const flush = () => { if (binCount) levels.push({ start_sec: round((count - binCount) / samplesPerSecond), end_sec: round(count / samplesPerSecond), rms_dbfs: db(Math.sqrt(binSquares / binCount)), peak_dbfs: db(binPeak) });binCount = 0;binSquares = 0;binPeak = 0; };
  await decode(['-v', 'error', '-i', file, '-t', String(duration), '-map', '0:a:0', '-vn', '-ac', '2', '-ar', String(rate), '-f', 'f32le', '-'], signal, bytes => {
    pending = Buffer.concat([pending, bytes]);const end = pending.length - pending.length % 4;
    for (let i = 0; i < end; i += 4) {
      if (count > samplesPerSecond * 31) throw Error('Review audio exceeded the bounded duration.');
      const v = pending.readFloatLE(i), abs = Math.abs(v);
      if (!Number.isFinite(v)) throw Error('The render contains invalid audio samples.');
      squares += v * v;peak = Math.max(peak, abs);if (abs >= .999) clipped++;
      binSquares += v * v;binPeak = Math.max(binPeak, abs);count++;binCount++;
      if (binCount === binSize) flush();
    }
    pending = pending.subarray(end);
  });
  flush();
  if (!count || pending.length) throw Error('The rendered audio could not be decoded completely.');
  const silence = [];
  for (const level of levels) if (level.rms_dbfs < -50) {
    const last = silence.at(-1);
    if (last && Math.abs(last.end_sec - level.start_sec) < .001) last.end_sec = level.end_sec;else silence.push({ start_sec: level.start_sec, end_sec: level.end_sec });
  }
  return { decoded_seconds: round(count / samplesPerSecond), peak_dbfs: db(peak), rms_dbfs: db(Math.sqrt(squares / count)), near_clipping_samples: clipped, near_clipping_fraction: round(clipped / count), levels, silence_candidates: silence.slice(0, 12), measurement: 'decoded stereo sample levels; not true-peak or semantic listening' };
}
async function inspectRenderedVideo(file, { signal, sampleTimes } = {}) {
  stop(signal);
  const info = await ff.probe(file);stop(signal);
  if (info.type !== 'video' || !(info.duration > 0) || info.fps > 60) throw Error('Review requires a rendered video at up to 60 fps.');
  const duration = Math.min(30, info.duration);
  const video = await videoSignals(file, info, signal, duration);
  const audio = info.hasAudio ? await audioSignals(file, signal, duration) : { has_audio: false, note: 'The rendered file has no audio stream.' };
  const last = Math.max(0, duration - 1 / (info.fps || 30));
  const times = sampleTimes || [0, last * .2, last * .4, last * .6, last * .8, last];
  if (!Array.isArray(times) || !times.length || times.length > 6 || times.some(t => !Number.isFinite(t) || t < 0 || t >= duration)) throw Error('Use one to six sample times inside the reviewed first 30 seconds.');
  const scale = Math.min(1, 768 / Math.max(info.width, info.height)), frames = [];
  for (const time of [...new Set(times)]) {
    stop(signal);
    const bytes = await sourceFrame({ media: { ...info, path: file }, source_time_sec: time, source: 'media', width: Math.max(2, Math.round(info.width * scale)), height: Math.max(2, Math.round(info.height * scale)) }, signal);
    frames.push({ bytes, render_time_sec: time });
  }
  stop(signal);
  return { video, audio, frames, reviewed_start_sec: 0, reviewed_end_sec: duration, full_file_duration_sec: info.duration, partial: info.duration > 30, limitations: [
    'Local signal measurements and sampled encoded images; no continuous semantic video understanding or audio listening.',
    'Black, still, silence and abrupt-change candidates may be intentional. Compare them with the timeline and requested edit.',
    'Small motion defects can be missed by sampled images and numerical signals. No external review service or video-upload API is used.',
  ] };
}
module.exports = { inspectRenderedVideo, videoSignals, audioSignals };
