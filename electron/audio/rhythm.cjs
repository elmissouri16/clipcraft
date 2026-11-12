// Beat tracking and loudness measurement for CraftAI. Audio is rendered from
// the timeline (selected sources keep their absolute placement), so all times
// are timeline seconds. Beat tracking: log-spectral-flux onset envelope, tempo
// from its autocorrelation, then dynamic-programming beat placement. Downbeats
// are an estimate (strongest 4-beat phase), reported as such.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const SR = 11025, FRAME = 512, HOP = 128;
const aborted = () => Object.assign(new Error('Audio analysis stopped.'), { name: 'AbortError' });

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Onset strength per hop: positive change of log magnitude spectrum (30 Hz–5 kHz).
function onsetEnvelope(samples, sr = SR) {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const win = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
  const lo = Math.floor(30 * FRAME / sr), hi = Math.min(FRAME / 2, Math.ceil(5000 * FRAME / sr));
  const env = new Float64Array(frames), re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  let prev = new Float64Array(hi - lo);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) { re[i] = samples[f * HOP + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float64Array(hi - lo);let flux = 0;
    for (let k = lo; k < hi; k++) { mag[k - lo] = Math.log1p(1000 * Math.hypot(re[k], im[k])); if (f) flux += Math.max(0, mag[k - lo] - prev[k - lo]); }
    env[f] = flux; prev = mag;
  }
  // Remove the slowly varying level so sustained loud passages do not dominate.
  const out = new Float64Array(frames), w = 32;
  for (let f = 0; f < frames; f++) {
    let s = 0, n = 0;for (let k = Math.max(0, f - w); k <= Math.min(frames - 1, f + w); k++) { s += env[k]; n++; }
    out[f] = Math.max(0, env[f] - s / n);
  }
  const max = out.reduce((m, v) => Math.max(m, v), 0) || 1;
  return out.map(v => v / max);
}

function estimateTempo(env, fps) {
  const minLag = Math.round(fps * 60 / 200), maxLag = Math.round(fps * 60 / 55);
  let best = { lag: 0, score: -Infinity };const scores = [];
  for (let lag = minLag; lag <= maxLag && lag < env.length; lag++) {
    let s = 0;for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    s /= env.length - lag;
    // Prefer common tempos (log-Gaussian around 120 BPM) to avoid half/double errors.
    const bpm = 60 * fps / lag, weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    scores.push({ lag, s, w: s * weight });
    if (s * weight > best.score) best = { lag, score: s * weight };
  }
  const mean = scores.reduce((n, x) => n + x.s, 0) / Math.max(1, scores.length);
  const peak = scores.find(x => x.lag === best.lag)?.s || 0;
  return { period: best.lag, bpm: best.lag ? 60 * fps / best.lag : 0, confidence: mean > 0 ? Math.min(1, Math.max(0, (peak / mean - 1) / 3)) : 0 };
}

function trackBeats(env, period, tightness = 100) {
  const n = env.length, score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0, arg = -1;
    for (let prev = t - Math.round(2 * period); prev <= t - Math.round(period / 2); prev++) {
      if (prev < 0) continue;
      const v = score[prev] - tightness * Math.log((t - prev) / period) ** 2;
      if (v > best || arg < 0) { best = v; arg = prev; }
    }
    score[t] = env[t] + (arg >= 0 ? best : 0); back[t] = arg;
  }
  // Start from the best-scoring frame in the last period and walk back.
  let t = n - 1, top = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > top) { top = score[i]; t = i; }
  const beats = [];
  while (t >= 0) { beats.push(t); t = back[t]; }
  return beats.reverse();
}

function analyzeSamples(samples, { sr = SR, offset_sec = 0 } = {}) {
  const fps = sr / HOP, env = onsetEnvelope(samples, sr);
  if (env.length < fps * 3) throw new Error('Select at least 3 seconds of audio for beat analysis.');
  const energy = Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / Math.max(1, samples.length));
  if (energy < 1e-4) throw new Error('The selected audio is silent.');
  const tempo = estimateTempo(env, fps);
  if (!tempo.period) throw new Error('No steady tempo was found.');
  const frames = trackBeats(env, tempo.period);
  // A flux peak lands when the attack is ~3/4 into the frame (calibrated on
  // synthetic click tracks: mean error under 3 ms, worst under 10 ms).
  const time = f => offset_sec + (f * HOP + FRAME * 0.75) / sr;
  const beats = frames.map(f => ({ t: time(f), strength: env[f] }));
  // Downbeat phase: the 4-beat grouping whose beats carry the most onset energy.
  let phase = 0, bestPhase = -1;
  for (let k = 0; k < 4; k++) { const s = beats.filter((_, i) => i % 4 === k).reduce((n, b) => n + b.strength, 0); if (s > bestPhase) { bestPhase = s; phase = k; } }
  const r3 = n => Math.round(n * 1000) / 1000;
  // Strong onsets (accents/hits) for cutting on impacts rather than every beat.
  const accents = [];
  for (let f = 1; f < env.length - 1; f++) if (env[f] > 0.45 && env[f] >= env[f - 1] && env[f] > env[f + 1] && (!accents.length || f - accents.at(-1) > fps * 0.25)) accents.push(f);
  return {
    bpm: Math.round(tempo.bpm * 10) / 10, tempo_confidence: Math.round(tempo.confidence * 100) / 100,
    beats: beats.map(b => r3(b.t)), downbeats: beats.filter((_, i) => i % 4 === phase).map(b => r3(b.t)),
    accents: accents.map(f => r3(time(f))), downbeat_method: 'estimated 4/4 phase from onset strength',
  };
}

// analyzeSamples takes about half a second per five minutes of audio. On a worker thread the main
// process (every window's IPC) keeps responding meanwhile; the result is analyzeSamples' own.
const analyzeInWorker = (samples, opts, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(aborted());
  const copy = new Float32Array(samples); // its own buffer: handed to the worker without a second copy
  const worker = new Worker(__filename, { workerData: { role: 'rhythm' } });
  let settled = false;
  const settle = (fn, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', stop); worker.terminate(); fn(value); };
  const stop = () => settle(reject, aborted());
  signal?.addEventListener('abort', stop, { once: true });
  worker.once('message', (m) => (m.error ? settle(reject, Object.assign(new Error(m.error), { name: m.name })) : settle(resolve, m.result)));
  worker.once('error', (e) => settle(reject, e));
  worker.once('exit', (code) => { if (!settled) settle(reject, new Error(`Beat analysis stopped (${code}).`)); });
  worker.postMessage({ samples: copy, opts }, [copy.buffer]);
});
if (!isMainThread && workerData?.role === 'rhythm') {
  parentPort.once('message', ({ samples, opts }) => {
    try { parentPort.postMessage({ result: analyzeSamples(samples, opts) }); }
    catch (e) { parentPort.postMessage({ error: e.message, name: e.name }); }
  });
}

const decode = (ffmpegPath, wav, { start, duration, signal }) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(aborted());
  const args = ['-hide_banner', '-loglevel', 'error', ...(start ? ['-ss', String(start)] : []), ...(duration ? ['-t', String(duration)] : []), '-i', wav, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
  const p = spawn(ffmpegPath, args, { windowsHide: true, ...(signal ? { signal } : {}) });
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

function parseLoudness(log) {
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const num = re => { const m = re.exec(summary); return m ? Number(m[1]) : null; };
  return { integrated_lufs: num(/I:\s*(-?[\d.]+)\s*LUFS/), loudness_range_lu: num(/LRA:\s*(-?[\d.]+)\s*LU/), true_peak_db: num(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/) };
}

function createRhythmService({ renderAudio, ffmpegPath }) {
  const withWav = async (project, opts, run) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-rhythm-'));
    try {
      const wav = await renderAudio(project, path.join(tmp, 'a.wav'), { source: opts.source || 'all', clip_ids: opts.clip_ids, signal: opts.signal });
      return await run(wav);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  };
  return {
    async beats(project, opts = {}) {
      const start = Math.max(0, Number(opts.start_sec) || 0), end = Number(opts.end_sec);
      const duration = Number.isFinite(end) && end > start ? Math.min(end - start, 600) : 600;
      return withWav(project, opts, async wav => ({ ok: true, ...await analyzeInWorker(await decode(ffmpegPath, wav, { start, duration, signal: opts.signal }), { offset_sec: start }, opts.signal), analyzed_sec: duration }));
    },
    async loudness(project, opts = {}) {
      return withWav(project, opts, wav => new Promise((resolve, reject) => {
        if (opts.signal?.aborted) return reject(aborted());
        const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { windowsHide: true, ...(opts.signal ? { signal: opts.signal } : {}) });
        let log = '';
        p.stderr.on('data', d => { log = (log + d).slice(-20000); });
        p.on('error', e => reject(e.name === 'AbortError' ? aborted() : e));
        p.on('close', code => opts.signal?.aborted ? reject(aborted()) : code === 0 ? resolve({ ok: true, ...parseLoudness(log), note: 'Measured on the 16 kHz analysis mix; true peak is approximate.' }) : reject(new Error(log.slice(-1500))));
      }));
    },
  };
}

module.exports = { createRhythmService, analyzeSamples, onsetEnvelope, estimateTempo, parseLoudness, SR };
