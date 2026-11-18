// Edit fingerprints: how a finished video is edited, measured locally so the
// assistant can copy an editing style without watching the video.
//
// A reference is never sent to the model frame by frame (a 10-minute video at one
// frame per second would be ~450k tokens). Instead FFmpeg and plain arithmetic
// measure the editing in a shared vocabulary (docs/agents/edit-vocabulary.md):
// pacing, transitions, framing changes, camera moves, colour, sound and speech.
// The result is ~1–2k tokens whatever the length, plus a handful of sample times
// for one contact sheet, where the model judges what arithmetic cannot (shot
// sizes, captions, graphics).
//
// Every measurement is an estimate from low-resolution frames; the fingerprint
// says so and lists what still needs a visual review.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('../system/childProcesses.cjs');

const VERSION = 'edit-style-v2';
const MAX_SEC = 30 * 60;          // longer references: the first 30 minutes
const FPS_CAP = 30;               // analysis frame rate (cut times keep FFmpeg's precision)
const TW = 32, TH = 18;           // per-frame thumbnail for transitions, motion and colour
const CW = 96;                    // frames kept around cuts and shot ends for framing checks
const abortError = () => Object.assign(new Error('Reference analysis stopped.'), { name: 'AbortError' });
const r = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const quantile = (values, q) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

// ---- Frame helpers (RGB24 buffers) ----

// Mean absolute difference per channel, 0..255.
function mad(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i]);
  return n / a.length;
}
// Downscale an RGB frame by box averaging.
function shrink(frame, w, h, tw, th) {
  const out = new Uint8Array(tw * th * 3);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const x0 = Math.floor(x * w / tw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / tw));
    const y0 = Math.floor(y * h / th), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / th));
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += frame[(yy * w + xx) * 3 + c];
      out[(y * tw + x) * 3 + c] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}
// The region of `frame` (w x h) scaled by `scale` around (cx, cy) in 0..1, resampled to w x h.
function zoomed(frame, w, h, scale, cx, cy) {
  const out = new Uint8Array(w * h * 3), cw = w / scale, ch = h / scale;
  const x0 = Math.min(w - cw, Math.max(0, cx * w - cw / 2)), y0 = Math.min(h - ch, Math.max(0, cy * h - ch / 2));
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h - 1.001, y0 + (y + 0.5) * ch / h - 0.5), iy = Math.max(0, Math.floor(sy)), fy = sy - iy;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1.001, x0 + (x + 0.5) * cw / w - 0.5), ix = Math.max(0, Math.floor(sx)), fx = sx - ix;
      for (let c = 0; c < 3; c++) {
        const p = (yy, xx) => frame[(yy * w + xx) * 3 + c];
        const top = p(iy, ix) * (1 - fx) + p(iy, Math.min(w - 1, ix + 1)) * fx;
        const bottom = p(Math.min(h - 1, iy + 1), ix) * (1 - fx) + p(Math.min(h - 1, iy + 1), Math.min(w - 1, ix + 1)) * fx;
        out[(y * w + x) * 3 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}
// Colour summary of a frame.
function colorOf(frame) {
  let luma = 0, luma2 = 0, sat = 0, warm = 0, tint = 0;
  const n = frame.length / 3;
  for (let i = 0; i < frame.length; i += 3) {
    const R = frame[i], G = frame[i + 1], B = frame[i + 2];
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B, mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    luma += y; luma2 += y * y; sat += mx ? (mx - mn) / mx : 0; warm += R - B; tint += G - (R + B) / 2;
  }
  const m = luma / n;
  return { luma: m / 255, contrast: Math.sqrt(Math.max(0, luma2 / n - m * m)) / 255, saturation: sat / n, warmth: warm / n / 255, tint: tint / n / 255 };
}

// ---- Cut and move classification ----

// How the picture changes across a cut: the same framing (jump cut), a tighter or
// wider framing of the same picture (punch in / out), or a new shot. A and B are
// CW-wide frames just before and after the cut.
// Best zoom relating two frames: `in` = b is a tighter view of a. Coarse grid of
// scales and centres, then a local refinement around the best match.
function bestZoom(a, b, w, h, scales) {
  let best = { error: Infinity };
  const test = (scale, cx, cy) => {
    const half = 0.5 / scale;
    cx = Math.min(1 - half, Math.max(half, cx)); cy = Math.min(1 - half, Math.max(half, cy));
    const inErr = mad(zoomed(a, w, h, scale, cx, cy), b), outErr = mad(a, zoomed(b, w, h, scale, cx, cy));
    if (inErr < best.error) best = { error: inErr, kind: 'in', scale, cx, cy };
    if (outErr < best.error) best = { error: outErr, kind: 'out', scale, cx, cy };
  };
  for (const scale of scales) for (const cx of [0.3, 0.4, 0.5, 0.6, 0.7]) for (const cy of [0.3, 0.4, 0.5, 0.6, 0.7]) test(scale, cx, cy);
  for (const step of [0.05, 0.02]) {
    const { scale, cx, cy } = best;
    for (const ds of [-step * 2, 0, step * 2]) for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) if (scale + ds > 1.02) test(scale + ds, cx + dx, cy + dy);
  }
  return best;
}
// How the picture changes across a cut: the same framing (jump cut), a tighter or
// wider framing of the same picture (punch in / out), or a new shot. A and B are
// CW-wide frames just before and after the cut.
function framingChange(a, b, w, h) {
  const direct = mad(a, b);
  if (direct < 9) return { kind: 'jump', change: r(direct / 255, 3) };
  const best = bestZoom(a, b, w, h, [1.15, 1.25, 1.33, 1.5, 1.75, 2]);
  if (best.error < 16 && best.error < direct * 0.45) return { kind: best.kind === 'in' ? 'punch_in' : 'punch_out', scale: r(best.scale), change: r(direct / 255, 3) };
  // Same framing with some movement (a talking head between takes): still a jump cut.
  return { kind: direct < 20 ? 'jump' : 'cut', change: r(direct / 255, 3) };
}
// A shot's camera move from its first and last frames (CW wide): a zoom in or out,
// a change of view (pan, tilt or a moving camera), or static.
function cameraMove(first, last, w, h, energy) {
  const direct = mad(first, last), moving = energy > 0.005 ? 'moving' : 'static';
  if (direct < 4) return moving; // the same view at both ends: still, or movement that came back
  const best = bestZoom(first, last, w, h, [1.05, 1.1, 1.2, 1.35, 1.5, 1.75, 2, 2.5]);
  // Relative test: enlarging a small crop blurs it, so a strong zoom never matches exactly.
  if (best.error < direct * 0.45 && best.error < 16) return best.kind === 'in' ? 'zoom_in' : 'zoom_out';
  return direct > 6 ? 'moving' : moving;
}

// Gradual transitions in the per-frame thumbnail series: the picture changes a lot
// over a few tenths of a second without any single-frame jump. A dissolve's middle
// frame is the mix of its ends; a fade passes through black or white. Camera moves
// fail both tests. A fade-out and fade-in meeting at black are one transition.
function gradualTransitions(thumbs, diffs, fps) {
  const k = Math.max(2, Math.round(fps * 0.2)), n = thumbs.length, windowed = new Float32Array(n);
  for (let t = k; t < n - k; t++) windowed[t] = mad(thumbs[t - k], thumbs[t + k]);
  const luma = thumbs.map((t) => colorOf(t).luma);
  const found = [];
  for (let t = k; t < n - k; t++) {
    if (windowed[t] < 14 || windowed[t] < windowed[t - 1] || windowed[t] < windowed[t + 1]) continue;
    const spike = Math.max(...diffs.slice(t - k + 1, t + k + 1));
    if (spike > windowed[t] * 0.55) continue; // a hard cut explains this change
    let best = null;
    for (const h of [k, Math.round(k * 1.5), k * 2, k * 3]) {
      if (t - h < 0 || t + h >= n) continue;
      const a = thumbs[t - h], b = thumbs[t + h], ends = mad(a, b);
      const dark = Math.min(...luma.slice(t - h, t + h + 1)), light = Math.max(...luma.slice(t - h, t + h + 1));
      if (dark < 0.06 && luma[t - h] > dark + 0.08 && luma[t + h] > dark + 0.08) { best = { kind: 'fade_black', h }; break; }
      if (light > 0.94 && luma[t - h] < light - 0.08 && luma[t + h] < light - 0.08) { best = { kind: 'fade_white', h }; break; }
      const mix = a.map((v, i) => (v + b[i]) / 2);
      if (ends > 18 && mad(thumbs[t], mix) < ends * 0.3) best = { kind: 'dissolve', h };
    }
    if (!best) continue;
    // The transition's real extent: the stretch of raised frame changes around it.
    const level = Math.max(0.8, 0.3 * mean(diffs.slice(t - k + 1, t + k + 1)));
    let from = t, to = t;
    while (from > 1 && t - from < fps * 2 && (diffs[from] > level || luma[from - 1] < 0.06 || luma[from - 1] > 0.94)) from--;
    while (to + 1 < n && to - t < fps * 2 && (diffs[to + 1] > level || luma[to + 1] < 0.06 || luma[to + 1] > 0.94)) to++;
    found.push({ kind: best.kind, from, to, t });
  }
  // One transition per stretch: fades win, then the widest.
  const merged = [];
  for (const g of found.sort((x, y) => x.from - y.from)) {
    const last = merged.at(-1);
    if (last && g.from <= last.to + Math.round(fps * 0.15)) {
      const kind = last.kind.startsWith('fade') ? last.kind : g.kind.startsWith('fade') ? g.kind : last.kind;
      Object.assign(last, { kind, to: Math.max(last.to, g.to) });
    } else merged.push({ ...g });
  }
  return merged.map((g) => {
    // The moment of the transition: the darkest/brightest frame of a fade, the middle of a dissolve.
    let at = (g.from + g.to) / 2;
    if (g.kind !== 'dissolve') { const span = luma.slice(g.from, g.to + 1), pick = g.kind === 'fade_black' ? Math.min(...span) : Math.max(...span); at = g.from + span.indexOf(pick); }
    return { kind: g.kind, start_sec: g.from / fps, end_sec: g.to / fps, t: at / fps };
  });
}

// ---- Process helpers ----

function run(cmd, args, { signal, onStdout, maxErr = 4000 } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.stdout.on('data', (d) => onStdout?.(d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-maxErr); });
    p.on('error', (e) => { signal?.removeEventListener('abort', abort); reject(e); });
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(abortError());
      else if (code !== 0) reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `exit ${code}`));
      else resolve(err);
    });
  });
}

// The shared, quote-safe helper (a quote in a path closes the quoted filter value otherwise).
const escapeFilterPath = (file) => require('./ffmpeg.cjs').escapeFilterPath(file);
// Streams the video at the analysis rate and size, calling onFrame(index, rgb).
// One decode feeds both FFmpeg's scene-change detector (its times go to `sceneFile`)
// and the raw analysis frames: decoding is the expensive part (4K HEVC especially).
async function readFrames(ffmpegPath, file, { fps, w, h, seconds, signal, spawnDecoder, sceneFile, threshold }, onFrame) {
  const size = w * h * 3;
  let pending = Buffer.alloc(0), index = 0;
  const args = ['-hide_banner', '-v', 'error', '-i', file, '-t', String(seconds), '-an', '-filter_complex',
    `[0:v:0]fps=${fps},scale=320:-2,split[s][f];[s]scdet=threshold=${threshold},metadata=print:key=lavfi.scd.time:file='${escapeFilterPath(sceneFile)}',nullsink;[f]scale=${w}:${h}:flags=area,format=rgb24[o]`,
    '-map', '[o]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
  const consume = (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= size) {
      onFrame(index++, new Uint8Array(pending.buffer, pending.byteOffset, size).slice());
      pending = pending.subarray(size);
    }
  };
  if (!spawnDecoder) { await run(ffmpegPath, args, { signal, onStdout: consume }); return index; }
  // The macOS fast pipe (electron/export/framePipes.cjs) when available.
  await new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const p = spawnDecoder(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.stdout.on('data', consume);
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => { signal?.removeEventListener('abort', abort); signal?.aborted ? reject(abortError()) : code ? reject(new Error(err || `exit ${code}`)) : resolve(); });
  });
  return index;
}

async function decodeAudio(ffmpegPath, file, { sr, seconds, signal }) {
  const chunks = [];
  await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-i', file, '-t', String(seconds), '-map', '0:a:0', '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'],
    { signal, onStdout: (d) => chunks.push(d) });
  const buf = Buffer.concat(chunks);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

// ---- Aggregation ----

function pacingOf(shots, duration) {
  const lengths = shots.map((s) => s.end_sec - s.start_sec);
  const cuts = shots.slice(1).map((s) => s.start_sec);
  const part = (from, to) => {
    const inside = shots.filter((s) => s.start_sec < to && s.end_sec > from);
    const ls = inside.map((s) => Math.min(to, s.end_sec) - Math.max(from, s.start_sec)).filter((l) => l > 0.05);
    return { span_sec: r(to - from, 1), shots: inside.length, median_shot_sec: r(quantile(ls, 0.5)) };
  };
  const tenth = duration / 10;
  const curve = Array.from({ length: 10 }, (_, k) => r(cuts.filter((t) => t >= k * tenth && t < (k + 1) * tenth).length / (tenth / 60), 1));
  const m = mean(lengths), sd = Math.sqrt(mean(lengths.map((l) => (l - m) ** 2)) || 0);
  return {
    shots: shots.length, cuts_per_min: r(cuts.length / (duration / 60), 1),
    shot_sec: { median: r(quantile(lengths, 0.5)), p10: r(quantile(lengths, 0.1)), p90: r(quantile(lengths, 0.9)), mean: r(m) },
    rhythm_variation: r(m ? sd / m : 0), // 0: every shot the same length
    first_cut_sec: cuts.length ? r(cuts[0]) : null,
    opening: part(0, Math.min(duration, 5)), ending: part(Math.max(0, duration - 5), duration),
    curve_cuts_per_min: curve, // ten equal parts, start to end
  };
}

function audioOf({ beats, loudness, samples, sr, cuts }) {
  const out = { has_audio: !!samples };
  if (!samples) return out;
  Object.assign(out, loudness || {});
  // Silence: 100 ms windows under -45 dBFS.
  const win = Math.round(sr / 10);
  let silent = 0, total = 0;
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += samples[k] * samples[k];
    total++; if (Math.sqrt(s / win) < 0.0056) silent++;
  }
  out.silence_ratio = r(total ? silent / total : 0);
  if (beats && beats.tempo_confidence >= 0.3 && beats.beats.length >= 8) {
    const interval = 60 / beats.bpm, tol = 0.07;
    const near = (grid) => (t) => grid.some((b) => Math.abs(b - t) <= tol);
    const halves = beats.beats.flatMap((b, i) => (i + 1 < beats.beats.length ? [b, (b + beats.beats[i + 1]) / 2] : [b]));
    const onBeat = cuts.filter(near(beats.beats)).length, onHalf = cuts.filter(near(halves)).length;
    out.music = { bpm: beats.bpm, tempo_confidence: beats.tempo_confidence };
    out.cuts_on_beat = cuts.length ? {
      ratio: r(onBeat / cuts.length), chance: r(Math.min(1, (2 * tol) / interval)),
      half_beat_ratio: r(onHalf / cuts.length), half_beat_chance: r(Math.min(1, (4 * tol) / interval)),
      beats_per_shot_median: r(quantile(cuts.slice(1).map((t, i) => (t - cuts[i]) / interval), 0.5), 1),
    } : null;
  } else out.music = null;
  return out;
}

function speechOf(words, cuts, duration) {
  if (!words?.length) return null;
  const gaps = words.slice(1).map((w, i) => w.start - words[i].end).filter((g) => g >= 0);
  const spoken = words.reduce((n, w) => n + Math.max(0, w.end - w.start), 0);
  const inWord = cuts.filter((t) => words.some((w) => t > w.start + 0.03 && t < w.end - 0.03)).length;
  // Silence around each cut: the gap between the last word before and the first word after.
  const around = cuts.map((t) => {
    const before = words.filter((w) => w.end <= t + 0.03).at(-1), after = words.find((w) => w.start >= t - 0.03);
    return before && after ? Math.max(0, after.start - before.end) : null;
  }).filter((g) => g != null);
  return {
    words: words.length, words_per_min: r(words.length / (duration / 60), 0), speech_ratio: r(Math.min(1, spoken / duration)),
    pause_sec: { median: r(quantile(gaps, 0.5)), p90: r(quantile(gaps, 0.9)) }, long_pauses_per_min: r(gaps.filter((g) => g > 0.6).length / (duration / 60), 1),
    cuts_inside_words_ratio: cuts.length ? r(inWord / cuts.length) : null,
    gap_at_cuts_median_sec: r(quantile(around, 0.5)), // small: tight jump cuts that remove pauses
  };
}

// The words of a reference with timestamps, when speech is clear enough to read:
// the script itself (hook, structure, where cuts fall in sentences). Whisper can
// "transcribe" song lyrics or repeat itself on noise; such text is marked uncertain.
function transcriptOf(segments, { musicConfident = false, speechRatio = 0 } = {}) {
  const segs = (segments || []).filter((s) => s && typeof s.text === 'string' && s.text.trim() && Number.isFinite(s.start) && Number.isFinite(s.end));
  const words = segs.reduce((n, s) => n + s.text.trim().split(/\s+/).length, 0);
  if (words < 8) return null;
  const texts = segs.map((s) => s.text.trim().toLowerCase());
  const repeated = texts.some((t, i) => t.length > 3 && texts.filter((x, j) => j !== i && x === t).length >= 2);
  const reasons = [repeated && 'the same line repeats (a sign of misheard noise)', musicConfident && speechRatio < 0.25 && 'strong music with little speech (possibly lyrics)'].filter(Boolean);
  return { reliability: reasons.length ? 'uncertain' : 'clear', ...(reasons.length ? { why: reasons.join('; ') } : {}), words,
    segments: segs.map((s) => [r(s.start), r(s.end), s.text.trim().slice(0, 600)]) };
}

// Sound around the edit: the energy curve (music builds and drops), loud jumps,
// the level of speech against its pauses (how far music is ducked under the voice),
// and sound hits or risers at cuts (sound effects, or music accents the cut follows).
function soundOf(samples, sr, cuts, words, duration) {
  if (!samples?.length) return null;
  const hop = 256, frames = Math.floor(samples.length / hop), rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += samples[i] * samples[i]; rms[f] = Math.sqrt(s / hop); }
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-5)), fps = sr / hop, at = (t) => Math.max(0, Math.min(frames - 1, Math.round(t * fps)));
  const level = (a, b) => { const from = at(a), to = Math.max(from + 1, at(b)); let s = 0; for (let f = from; f < to; f++) s += rms[f] * rms[f]; return db(Math.sqrt(s / (to - from))); };
  // Onsets: a frame at least 6 dB above the 10 before it, above -40 dBFS.
  const onsets = [];
  for (let f = 10; f < frames; f++) {
    let prev = 0; for (let k = f - 10; k < f; k++) prev += rms[k]; prev /= 10;
    if (rms[f] > 0.01 && rms[f] > prev * 2 && (!onsets.length || f - onsets.at(-1) > fps * 0.08)) onsets.push(f);
  }
  const tenth = duration / 10;
  const energy_curve_db = Array.from({ length: 10 }, (_, k) => r(level(k * tenth, (k + 1) * tenth), 1));
  const onset_curve_per_sec = Array.from({ length: 10 }, (_, k) => r(onsets.filter((f) => f / fps >= k * tenth && f / fps < (k + 1) * tenth).length / tenth, 1));
  // Jumps: a second at least 6 dB louder than the three before it (a drop or an entrance).
  const seconds = Math.floor(duration), perSec = Array.from({ length: seconds }, (_, i) => level(i, i + 1)), jumps = [];
  for (let i = 3; i < seconds; i++) if (perSec[i] - Math.max(...perSec.slice(i - 3, i)) >= 6 && perSec[i] > -40 && (!jumps.length || i - jumps.at(-1) >= 3)) jumps.push(i);
  // Speech against its pauses.
  let voice = null;
  if (words?.length >= 8) {
    const inWords = [], gaps = [];
    for (const w of words) if (w.end - w.start > 0.08) inWords.push(level(w.start, w.end));
    for (let i = 1; i < words.length; i++) if (words[i].start - words[i - 1].end > 0.25) gaps.push(level(words[i - 1].end + 0.05, words[i].start - 0.05));
    if (inWords.length && !gaps.length) voice = { note: 'no pauses of 0.25 s or more between words: the speech runs continuously, so nothing under it can be measured' };
    else if (inWords.length) {
      const sp = quantile(inWords, 0.5), pa = quantile(gaps, 0.5);
      voice = { speech_db: r(sp, 1), pause_db: r(pa, 1), difference_db: r(sp - pa, 1), note: pa < -50 ? 'pauses are near silence: no music bed under the voice' : 'pause level is the bed (music or ambience) under the voice' };
    }
  }
  // Cuts with a sound hit (an onset within 120 ms, outside a word) or a riser (8 dB up into the cut).
  const insideWord = (t) => (words || []).some((w) => t > w.start + 0.03 && t < w.end - 0.03);
  const hits = cuts.filter((t) => onsets.some((f) => Math.abs(f / fps - t) <= 0.12 && !insideWord(f / fps))).length;
  const risers = cuts.filter((t) => t > 0.6 && level(t - 0.15, t) - level(t - 0.6, t - 0.45) >= 8).length;
  return { energy_curve_db, onset_curve_per_sec, loud_jumps_sec: jumps.slice(0, 12), voice_balance: voice,
    cut_sounds: cuts.length ? { hit_ratio: r(hits / cuts.length), hit_chance: r(Math.min(1, (onsets.length / Math.max(1, duration)) * 0.24)), riser_ratio: r(risers / cuts.length) } : null };
}

// Up to 12 sample times for a contact sheet: the opening in detail, then spread out.
function sampleTimes(shots, limit = 12) {
  const mid = (s) => r((s.start_sec + s.end_sec) / 2);
  const picks = shots.slice(0, Math.min(4, shots.length)).map((s, i) => ({ t: mid(s), shot: i }));
  const base = picks.length, rest = shots.length - base, n = Math.min(limit - base, rest);
  for (let k = 0; k < n; k++) { const i = base + Math.floor((k + 0.5) * rest / n); picks.push({ t: mid(shots[i]), shot: i }); }
  return picks.slice(0, limit);
}

// ---- The service ----

function createEditStyle({ ffmpegPath, probe, analyzeSamples, transcribe, fingerprint, spawnDecoder, cacheDir } = {}) {
  const key = (fp, options) => createHash('sha256').update(JSON.stringify([VERSION, fp, options])).digest('hex');
  const cacheFile = (k) => cacheDir && path.join(cacheDir, `${k}.json`);
  const readCache = (k) => { try { const v = JSON.parse(fs.readFileSync(cacheFile(k), 'utf8')); return v.version === VERSION && v.analysis_id === k ? v : null; } catch { return null; } };
  const writeCache = (k, v) => {
    if (!cacheDir) return;
    fs.mkdirSync(cacheDir, { recursive: true });
    const file = cacheFile(k), tmp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, file);
    const entries = fs.readdirSync(cacheDir).filter((f) => /^[a-f0-9]{64}\.json$/.test(f));
    if (entries.length > 64) entries.map((f) => ({ f, t: fs.statSync(path.join(cacheDir, f)).mtimeMs })).sort((a, b) => a.t - b.t)
      .slice(0, entries.length - 64).forEach(({ f }) => fs.rmSync(path.join(cacheDir, f), { force: true }));
  };

  async function analyze(file, { speech = true, threshold = 10, signal, onProgress } = {}) {
    const options = { speech: !!(speech && transcribe), threshold };
    const fp = fingerprint ? fingerprint(file) : null, k = fp ? key(fp, options) : null;
    const cached = k && readCache(k);
    if (cached) return { ...cached, cached: true };
    const info = await probe(file);
    if (info.type !== 'video' || !(info.duration > 0)) throw new Error('A reference must be a video with a known duration.');
    const duration = Math.min(info.duration, MAX_SEC), fps = Math.max(5, Math.min(FPS_CAP, Math.round(info.fps || 30)));
    const aspect = (info.rotation === 90 || info.rotation === 270) ? info.height / info.width : info.width / info.height;
    const cw = CW, ch = Math.max(8, Math.round(CW / aspect / 2) * 2);
    onProgress?.(0.02);

    // 2) One low-resolution pass: a thumbnail per frame, plus full analysis frames
    //    around every cut and at shot ends, taken from a short ring of recent frames.
    //    Cuts are FFmpeg's scene changes plus single-frame jumps it misses (a jump cut
    //    keeps the framing, so its scene score stays low).
    const thumbs = [], diffs = [], kept = new Map(), ring = new Map(), spikes = [];
    const sceneFile = path.join(os.tmpdir(), `clipcraft-scenes-${process.pid}-${randomUUID()}.txt`);
    const RING = 48, LAG = 16, total = Math.max(1, Math.floor(duration * fps));
    const keep = (f) => { if (ring.has(f)) kept.set(f, ring.get(f)); };
    const keepCut = (f) => { for (const d of [-3, -2, -1, 1, 2]) keep(f + d); };
    const isSpike = (t) => {
      if (t < 2 || t + 1 >= diffs.length) return false;
      const around = diffs.slice(Math.max(1, t - 15), t + 16).filter((_, i, a) => i !== Math.min(15, t - 1));
      return diffs[t] > Math.max(2.5, 3 * quantile(around, 0.5), 2 * Math.max(diffs[t - 1], diffs[t + 1]));
    };
    // Full frames are kept around every strong local change (scene changes are only
    // known after the pass); cuts without them are classified from thumbnails.
    const isChange = (t) => t > 1 && t + 1 < diffs.length && diffs[t] > 3 && diffs[t] >= diffs[t - 1] && diffs[t] >= diffs[t + 1]
      && diffs[t] > 2 * quantile(diffs.slice(Math.max(1, t - 15), t + 16), 0.5);
    let frames, rawCuts = [];
    try {
      frames = await readFrames(ffmpegPath, file, { fps, w: cw, h: ch, seconds: duration, signal, spawnDecoder, sceneFile, threshold }, (i, frame) => {
        const thumb = shrink(frame, cw, ch, TW, TH);
        diffs.push(i ? mad(thumb, thumbs[i - 1]) : 0); thumbs.push(thumb);
        ring.set(i, frame); ring.delete(i - RING);
        if (i === 3) keep(2);
        const t = i - LAG;
        if (t > 0) { if (isSpike(t)) spikes.push(t); if (isSpike(t) || isChange(t)) keepCut(t); }
        if (i % 300 === 0) onProgress?.(0.05 + 0.6 * Math.min(1, i / total));
      });
      rawCuts = fs.readFileSync(sceneFile, 'utf8').split(/\r?\n/).map((line) => /^lavfi\.scd\.time=([\d.]+)/.exec(line)).filter(Boolean).map((m) => Number(m[1]));
    } finally { fs.rmSync(sceneFile, { force: true }); }
    if (frames < 2) throw new Error('The reference has no readable video frames.');
    for (let t = Math.max(1, frames - LAG); t < frames; t++) { if (isSpike(t)) spikes.push(t); keepCut(t); }
    keep(frames - 4);
    // Scene changes at FFmpeg's times, plus single-frame jumps it did not report.
    const sceneFrames = rawCuts.map((t) => Math.round(t * fps));
    const candidates = [...rawCuts.map((t, i) => ({ t, f: sceneFrames[i] })),
      ...spikes.filter((f) => !sceneFrames.some((g) => Math.abs(g - f) <= 2)).map((f) => ({ t: f / fps, f }))]
      .filter((c) => c.t > 0.05 && c.t < duration - 0.05).sort((a, b) => a.t - b.t);

    // 3) Transitions: gradual ones replace the cut candidates inside them.
    const gradual = gradualTransitions(thumbs, diffs, fps).filter((g) => g.t < duration);
    const transitions = gradual.map((g) => ({ t: r(g.t), kind: g.kind, duration_sec: r(g.end_sec - g.start_sec), from: g.start_sec, to: g.end_sec }));
    for (const c of candidates) {
      if (gradual.some((g) => c.t >= g.start_sec - 0.1 && c.t <= g.end_sec + 0.1)) continue;
      const a = kept.get(c.f - 2) || kept.get(c.f - 3), b = kept.get(c.f + 1) || kept.get(c.f + 2);
      const ta = thumbs[Math.max(0, c.f - 2)], tb = thumbs[Math.min(thumbs.length - 1, c.f + 1)];
      transitions.push({ t: r(c.t, 3), ...(a && b ? framingChange(a, b, cw, ch) : framingChange(ta, tb, TW, TH)) });
    }
    transitions.sort((x, y) => x.t - y.t);
    // A "jump" with almost no change is usually a false boundary (flash, lighting): drop it.
    const real = transitions.filter((x) => !(x.kind === 'jump' && x.change < 0.008));

    // 4) Shots. Camera moves compare a shot's first and last frames (thumbnails when
    //    no full frame was kept, e.g. next to a gradual transition); a gradual
    //    transition's blended frames belong to neither shot.
    const edges = [0, ...real.map((x) => x.t), duration];
    const clean = [{ to: 0 }, ...real, { from: duration }];
    const shots = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const start = edges[i], end = edges[i + 1];
      if (end - start < 0.04) continue;
      const cs = clean[i].to ?? clean[i].t, ce = clean[i + 1].from ?? clean[i + 1].t;
      const f0 = Math.min(thumbs.length - 1, Math.round(cs * fps) + 2), f1 = Math.max(f0, Math.min(thumbs.length - 1, Math.round(ce * fps) - 3));
      const inner = diffs.slice(f0 + 1, f1 + 1);
      const energy = inner.length ? mean(inner) / 255 : 0;
      const first = kept.get(f0) || kept.get(f0 + 1), last = kept.get(f1) || kept.get(f1 - 1);
      const color = colorOf(thumbs[Math.round((f0 + f1) / 2)]);
      const move = (f1 - f0) / fps < 0.7 ? (energy > 0.005 ? 'moving' : 'static')
        : first && last ? cameraMove(first, last, cw, ch, energy) : cameraMove(thumbs[f0], thumbs[f1], TW, TH, energy);
      shots.push({ start_sec: r(start, 3), end_sec: r(end, 3), into: i ? real[i - 1].kind : 'start', energy: r(energy, 4), move,
        color: Object.fromEntries(Object.entries(color).map(([kk, v]) => [kk, r(v, 3)])) });
    }
    onProgress?.(0.7);

    // 5) Sound: loudness, silence, tempo, cuts against the beat; speech when available.
    let samples = null, beats = null, loudness = null, words = null, segments = null, speechNote = null;
    if (info.hasAudio) {
      samples = await decodeAudio(ffmpegPath, file, { sr: 11025, seconds: duration, signal }).catch(() => null);
      if (samples?.length) {
        try { beats = analyzeSamples(samples, { sr: 11025 }); } catch { beats = null; }
        const log = await run(ffmpegPath, ['-hide_banner', '-nostats', '-i', file, '-t', String(duration), '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { signal, maxErr: 20000 }).catch(() => '');
        const summary = log.slice(log.lastIndexOf('Summary:')), num = (re) => { const m = re.exec(summary); return m ? Number(m[1]) : null; };
        loudness = { integrated_lufs: num(/I:\s*(-?[\d.]+)\s*LUFS/), loudness_range_lu: num(/LRA:\s*(-?[\d.]+)\s*LU/) };
      } else samples = null;
      onProgress?.(0.8);
      if (options.speech && samples) {
        try {
          // Segments with words (or plain words from older adapters).
          const got = await transcribe(file, { seconds: duration, signal });
          segments = got.some((x) => Array.isArray(x.words)) ? got : null;
          words = segments ? segments.flatMap((x) => x.words || []) : got;
        }
        catch (error) { if (error.name === 'AbortError') throw error; speechNote = `Speech was not measured: ${error.message.split('\n')[0]}`; }
      }
    }
    if (signal?.aborted) throw abortError();
    const cuts = real.map((x) => x.t);
    const count = (kind) => real.filter((x) => x.kind === kind).length;
    const colorStat = (field) => { const v = shots.map((s) => s.color[field]); return { median: r(quantile(v, 0.5), 3), spread: r(quantile(v, 0.9) - quantile(v, 0.1), 3) }; };
    const moved = (m) => shots.filter((s) => s.move === m).length;
    const punches = real.filter((x) => x.kind === 'punch_in' || x.kind === 'punch_out');
    const top = Math.min(...thumbs.slice(0, 50).map((t) => colorOf(t.subarray(0, TW * 3 * 2)).luma)), bottom = Math.min(...thumbs.slice(0, 50).map((t) => colorOf(t.subarray(t.length - TW * 3 * 2)).luma));
    const value = {
      version: VERSION, analysis_id: k, duration_sec: r(info.duration, 2), analyzed_sec: r(duration, 2),
      frame: { width: info.width, height: info.height, aspect: r(aspect, 3), fps: r(info.fps, 2), letterbox: top < 0.03 && bottom < 0.03 && mean(shots.map((s) => s.color.luma)) > 0.12 },
      pacing: pacingOf(shots, duration),
      transitions: { cut: count('cut'), jump: count('jump'), punch_in: count('punch_in'), punch_out: count('punch_out'), dissolve: count('dissolve'), fade_black: count('fade_black'), fade_white: count('fade_white'),
        list: real.slice(0, 200).map(({ from, to, ...x }) => x) },
      framing: { punch_ratio: r(cuts.length ? punches.length / cuts.length : 0), jump_ratio: r(cuts.length ? count('jump') / cuts.length : 0),
        punch_scale_median: r(quantile(punches.map((p) => p.scale), 0.5)), zoom_in_shots: moved('zoom_in'), zoom_out_shots: moved('zoom_out') },
      motion: { energy_median: r(quantile(shots.map((s) => s.energy), 0.5), 4), static_ratio: r(moved('static') / shots.length), moving_ratio: r(moved('moving') / shots.length) },
      color: { luma: colorStat('luma'), contrast: colorStat('contrast'), saturation: colorStat('saturation'), warmth: colorStat('warmth'), tint: colorStat('tint'),
        black_and_white_ratio: r(shots.filter((s) => s.color.saturation < 0.04).length / shots.length) },
      audio: { ...audioOf({ beats, loudness, samples, sr: 11025, cuts }), ...(samples ? { sound: soundOf(samples, 11025, cuts, words, duration) } : {}) },
      speech: speechOf(words, cuts, duration),
      transcript: segments ? transcriptOf(segments, { musicConfident: (beats?.tempo_confidence || 0) >= 0.6, speechRatio: speechOf(words, cuts, duration)?.speech_ratio || 0 }) : null,
      shots: shots.slice(0, 300),
      samples: sampleTimes(shots),
      needs_visual_review: ['shot sizes and subjects', 'captions and on-screen text (font, position, colour, word-by-word)', 'graphics, stickers and overlays', 'speed ramps and effects'],
      limitations: [
        'Measured from low-resolution frames: cut kinds, camera moves and colour are estimates, not proof.',
        'Gradual transitions other than dissolves and fades (wipes, slides, glitches) count as cuts or are missed.',
        info.duration > MAX_SEC ? `Only the first ${MAX_SEC / 60} minutes were analysed.` : null,
        speechNote, options.speech ? null : 'Speech pacing was not measured.',
      ].filter(Boolean),
    };
    if (k) writeCache(k, value);
    onProgress?.(1);
    return { ...value, cached: false };
  }
  return { analyze };
}

// A compact view for the assistant: the fingerprint without per-shot detail.
// The transcript is paged: up to ~12k characters from `transcriptFrom` seconds.
const TRANSCRIPT_CHARS = 12000;
function summarize(value, { shots = 24, transcriptFrom = 0 } = {}) {
  const { shots: all, transitions, transcript, ...rest } = value;
  const { list, ...counts } = transitions;
  let page = null;
  if (transcript) {
    const segs = transcript.segments.filter((s) => s[1] > transcriptFrom), kept = [];
    let chars = 0;
    for (const seg of segs) { chars += seg[2].length + 16; if (chars > TRANSCRIPT_CHARS && kept.length) break; kept.push(seg); }
    const next = kept.length < segs.length ? segs[kept.length][0] : null;
    page = { reliability: transcript.reliability, ...(transcript.why ? { why: transcript.why } : {}), words: transcript.words,
      segments: kept, ...(next != null ? { next_from_sec: next, note: 'More transcript follows: call again with transcript_from_sec.' } : {}) };
  }
  return { ...rest, transcript: page, transitions: counts, transition_times: list.slice(0, 60).map((x) => [x.t, x.kind]),
    shots_sample: all.slice(0, shots).map((s) => [s.start_sec, s.end_sec, s.into, s.move]) };
}

module.exports = { createEditStyle, summarize, framingChange, cameraMove, gradualTransitions, pacingOf, speechOf, audioOf, soundOf, transcriptOf, colorOf, zoomed, shrink, mad, VERSION };
