// Audio-accurate edges for transcript-driven cuts. Whisper word times can be
// off by 0.1–0.3 s, so a cut placed from the transcript alone may clip the
// neighbouring word and leave part of the filler. Each cut edge is snapped to
// the middle of the nearest real pause (10 ms energy envelope); a span with no
// clean pause near either edge is skipped rather than risking a clipped word.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SR = 16000, HOP = 160; // 10 ms frames
const aborted = () => Object.assign(new Error('Audio analysis stopped.'), { name: 'AbortError' });

function envelope(samples) {
  const out = new Float32Array(Math.floor(samples.length / HOP));
  for (let f = 0; f < out.length; f++) {
    let s = 0;for (let i = f * HOP, end = i + HOP; i < end; i++) s += samples[i] * samples[i];
    out[f] = 10 * Math.log10(s / HOP + 1e-10);
  }
  return out;
}

// Silent runs (frame ranges) inside [a, b) frames, at least minFrames long.
function pauses(env, a, b, threshold, minFrames) {
  const out = [];let start = -1;
  for (let f = a; f <= b; f++) {
    const quiet = f < b && env[f] < threshold;
    if (quiet && start < 0) start = f;
    if (!quiet && start >= 0) { if (f - start >= minFrames) out.push({ start, end: f }); start = -1; }
  }
  return out;
}

// Local quiet threshold and voiced runs (merged across dips under 30 ms) in [a, b) frames.
function voicedRuns(env, a, b) {
  const local = [...env.slice(a, b)].sort((x, y) => x - y);
  const floor = local[Math.floor(local.length * 0.1)], peak = local[Math.floor(local.length * 0.98)];
  // Quiet = well below the local speech level and near the local floor.
  const threshold = Math.max(floor + 6, Math.min(peak - 22, floor + 18));
  const runs = [];let start = -1;
  for (let f = a; f <= b; f++) {
    const voiced = f < b && env[f] >= threshold;
    if (voiced && start < 0) start = f;
    if (!voiced && start >= 0) { const last = runs.at(-1); if (last && start - last.end < 3) last.end = f; else runs.push({ start, end: f }); start = -1; }
  }
  return { runs, threshold, peak };
}

// Short sounds between pauses near a filler's transcript time: [{ start, end, before, after }] (seconds).
function wordCandidates(env, span, reach = 0.7) {
  const center = (span.start + span.end) / 2;
  const a = Math.max(0, Math.floor((center - reach - 0.6) * 100)), b = Math.min(env.length, Math.ceil((center + reach + 0.6) * 100));
  if (b - a < 10) return [];
  const { runs, peak } = voicedRuns(env, a, b);
  if (peak < -50) return [];
  const out = [];
  for (let i = 1; i + 1 < runs.length; i++) {
    const r = runs[i], len = (r.end - r.start) / 100, mid = (r.start + r.end) / 200;
    if (len < 0.08 || len > 0.8 || Math.abs(mid - center) > reach) continue;
    // A hesitation's decay continues below the threshold: end later into the
    // following pause (never within 30 ms of the next word), start a little early.
    const gapBefore = r.start - runs[i - 1].end, gapAfter = runs[i + 1].start - r.end;
    out.push({ start: r.start / 100, end: r.end / 100, before: (runs[i - 1].end + gapBefore * 0.45) / 100, after: Math.min(r.end + gapAfter * 0.65, runs[i + 1].start - 3) / 100 });
  }
  return out;
}

const HESITATION = /^(u+[mh]+|a+h+|e+r+m*|h+m+|m+h*m*|e+h+|e+u+h+|uhhuh|mhm|ا+م+|ا+ه+|ه+م+|إ+م+|أ+م+|ا+)$/;
// Whisper's reading of an isolated clip counts only when every token is a hesitation;
// "[BLANK_AUDIO]" also appears for word fragments, so it is not proof.
const isHesitation = text => { const words = String(text || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[\p{P}\p{S}]/gu, '').split(/\s+/).filter(Boolean); return words.length > 0 && words.every(w => HESITATION.test(w)); };

// Edge mode (multi-word spans such as retakes): each edge snaps to a real pause.
function refineEdges(env, span, { tolerance = 0.3, min_pause_sec = 0.03, max_voiced_sec = 1.2 } = {}) {
  const frames = env.length, minFrames = Math.max(1, Math.round(min_pause_sec * 100));
  const a = Math.max(0, Math.floor((span.start - tolerance - 0.2) * 100)), b = Math.min(frames, Math.ceil((span.end + tolerance + 0.2) * 100));
  if (b - a < 5) return { skip: 'outside the audio' };
  const { threshold, peak } = voicedRuns(env, a, b);
  if (peak < -50) return { skip: 'no audible speech here' };
  const gaps = pauses(env, a, b, threshold, minFrames).map(g => ({ ...g, mid: (g.start + g.end) / 200 }));
  // The pause before speech ends where that speech starts: rank pauses by their end.
  const nearest = t => gaps.filter(g => Math.abs(g.end / 100 - t) <= tolerance || (g.start / 100 <= t && g.end / 100 >= t)).sort((x, y) => Math.abs(x.end / 100 - t) - Math.abs(y.end / 100 - t))[0];
  // The redo of a retake follows a noticeable pause: for the end edge take the
  // longest pause shortly before/around the kept take (ties: nearest).
  const lead = gaps.filter(g => g.mid >= span.end - 0.5 && g.mid <= span.end + tolerance && g.end - g.start >= 8);
  const longest = Math.max(0, ...lead.map(g => g.end - g.start));
  const after = lead.filter(g => g.end - g.start >= longest * 0.8).sort((x, y) => Math.abs(x.end / 100 - span.end) - Math.abs(y.end / 100 - span.end))[0] || nearest(span.end);
  const before = nearest(span.start);
  if (!before) return { skip: 'no clean pause before it' };
  if (!after) return { skip: 'no clean pause after it' };
  if (after.start <= before.end) return { skip: 'not found in the audio near its transcript time' };
  let voiced = 0;for (let f = before.end; f < after.start; f++) if (env[f] >= threshold) voiced++;
  if (voiced < 4) return { skip: 'not found in the audio near its transcript time' };
  if (voiced / 100 > max_voiced_sec) return { skip: 'pauses around it enclose too much speech' };
  return { start: before.mid, end: after.mid, voiced_sec: voiced / 100 };
}

const wavBytes = (samples, from, to) => {
  const a = Math.max(0, Math.floor(from * SR)), b = Math.min(samples.length, Math.ceil(to * SR)), pad = Math.round(0.4 * SR), n = b - a + pad;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = a; i < b; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + (i - a) * 2);
  return buf;
};

// spans: [{ start, end, kind? }] in seconds (transcript estimates of the speech to
// remove). kind 'word' = a single filler: Whisper's word times drift by up to
// ~0.5 s, so nearby short sounds between pauses are each recognized on their
// own (verify) and only one heard as a hesitation is cut, pause to pause.
// Other spans snap each edge to a real pause. Returns { start, end } or { skip }.
async function refineSpans(samples, spans, { verify, tmpDir, ...options } = {}) {
  const env = envelope(samples), out = spans.map(span => span.kind === 'word' ? null : refineEdges(env, span, options));
  const words = spans.map((span, i) => ({ span, i })).filter(({ span }) => span.kind === 'word');
  if (!words.length) return out;
  if (!verify) { for (const { i } of words) out[i] = { skip: 'audio check unavailable' }; return out; }
  const unique = new Map();
  const candidates = words.map(({ span }) => wordCandidates(env, span).map(c => { const key = `${c.start}:${c.end}`; if (!unique.has(key)) unique.set(key, { ...c, key }); return unique.get(key); }));
  const list = [...unique.values()];
  if (list.length) {
    const files = list.map((c, n) => { const file = path.join(tmpDir, `clip-${n}.wav`); fs.writeFileSync(file, wavBytes(samples, c.start - 0.04, c.end + 0.04)); return file; });
    const texts = await verify(files);
    list.forEach((c, n) => { c.heard = texts[n] || ''; c.hesitation = isHesitation(texts[n]); });
  }
  const used = new Set();
  words.forEach(({ span, i }, k) => {
    const center = (span.start + span.end) / 2;
    const best = candidates[k].filter(c => c.hesitation && !used.has(c.key)).sort((x, y) => Math.abs((x.start + x.end) / 2 - center) - Math.abs((y.start + y.end) / 2 - center))[0];
    if (!best) { out[i] = { skip: candidates[k].length ? 'not confirmed as a hesitation in the audio' : 'no short sound between pauses near its transcript time' }; return; }
    used.add(best.key);
    out[i] = { start: best.before, end: best.after, voiced_sec: Math.round((best.end - best.start) * 100) / 100, heard: best.heard };
  });
  return out;
}

const decode = (ffmpegPath, wav, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(aborted());
  const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { windowsHide: true, ...(signal ? { signal } : {}) });
  const chunks = [];let err = '';
  p.stdout.on('data', c => chunks.push(c));
  p.stderr.on('data', d => { err = (err + d).slice(-2000); });
  p.on('error', e => reject(e.name === 'AbortError' ? aborted() : e));
  p.on('close', code => {
    if (signal?.aborted) return reject(aborted());
    if (code !== 0) return reject(new Error(err || 'Audio decoding failed.'));
    const buf = Buffer.concat(chunks);
    resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
  });
});

async function refineCuts(project, { spans, source = 'all', clip_ids, signal, renderAudio, ffmpegPath, verify, ...options } = {}) {
  if (!Array.isArray(spans) || spans.length > 500 || spans.some(s => !Number.isFinite(s?.start) || !Number.isFinite(s?.end) || s.end < s.start)) throw new Error('Give up to 500 valid spans.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-cuts-'));
  try {
    const wav = await renderAudio(project, path.join(tmp, 'a.wav'), { source, clip_ids, signal });
    const ranges = await refineSpans(await decode(ffmpegPath, wav, signal), spans, { ...options, tmpDir: tmp, verify: verify && (files => verify(files, signal)) });
    if (signal?.aborted) throw aborted();
    return { ok: true, ranges };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { refineCuts, refineSpans, wordCandidates, isHesitation, envelope, SR };
