// Narration of several lines from one speech request: the lines are read as one passage, with a
// clear pause between them, and the audio is cut back into one clip per line at those pauses. One
// request instead of one per line keeps a narration under the provider's per-minute request limit,
// uses a fraction of its daily requests, and keeps one continuous delivery. When the pauses do not
// match the lines (the voice ran two lines together), each line is spoken on its own instead.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { spawn } = require('../system/childProcesses.cjs');

const MAX_LINES = 40;
const BETWEEN = 'Read each paragraph as its own line, with a clear pause of about one second between paragraphs.';
const weight = (text) => Math.max(1, String(text).replace(/[\s\p{P}]/gu, '').length);

// Silences in a WAV as [{ start, end }] seconds, and its duration.
async function findPauses(ffmpegPath, wav, signal) {
  const log = await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-i', wav, '-af', 'silencedetect=noise=-40dB:d=0.18', '-f', 'null', '-'], { windowsHide: true, ...(signal ? { signal } : {}) });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (error) => { if (error.name !== 'AbortError') reject(error); });
    p.on('close', (code) => signal?.aborted ? reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' })) : code === 0 ? resolve(err) : reject(new Error('Could not measure the narration pauses.')));
  });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  const pauses = [];
  let open = null;
  for (const line of log.split(/\r?\n/)) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (a) open = Math.max(0, Number(a[1]));
    const b = /silence_end:\s*([\d.]+)/.exec(line);
    if (b && open !== null) { pauses.push({ start: open, end: Number(b[1]) }); open = null; }
  }
  if (open !== null) pauses.push({ start: open, end: duration });
  return { pauses, duration };
}

// Where each line's speech starts and ends: [{ from, to }], or null when the pauses do not fit the
// lines. Picks the N-1 pauses (in order) that are long and lie near where each line should end by
// its share of the text, then checks every line's length against its share.
function planLines({ pauses, duration }, texts) {
  const n = texts.length;
  if (!(duration > 0) || !n) return null;
  const lead = pauses.find((p) => p.start <= 0.01)?.end ?? 0;
  const tail = pauses.find((p) => p.end >= duration - 0.01 && p.start > lead)?.start ?? duration;
  const span = tail - lead;
  if (!(span > 0)) return null;
  if (n === 1) return [{ from: lead, to: tail }];
  const inner = pauses.filter((p) => p.start > lead + 0.05 && p.end < tail - 0.05 && p.end - p.start >= 0.2);
  if (inner.length < n - 1) return null;
  const w = texts.map(weight), total = w.reduce((a, b) => a + b, 0);
  const expected = []; // where boundary k should fall
  for (let k = 0, acc = 0; k < n - 1; k++) { acc += w[k]; expected.push(lead + (span * acc) / total); }
  const unit = span / n;
  const score = (p, k) => Math.min(p.end - p.start, 1.6) - (3 * Math.abs((p.start + p.end) / 2 - expected[k])) / unit;
  // best[k][j]: best total choosing boundary k at pause j (pauses strictly increasing).
  const m = inner.length, best = Array.from({ length: n - 1 }, () => new Array(m).fill(-Infinity)), from = Array.from({ length: n - 1 }, () => new Array(m).fill(-1));
  for (let j = 0; j < m; j++) best[0][j] = score(inner[j], 0);
  for (let k = 1; k < n - 1; k++) {
    let run = -Infinity, arg = -1;
    for (let j = k; j < m; j++) {
      if (best[k - 1][j - 1] > run) { run = best[k - 1][j - 1]; arg = j - 1; }
      if (arg >= 0) { best[k][j] = run + score(inner[j], k); from[k][j] = arg; }
    }
  }
  let j = -1, top = -Infinity;
  for (let x = 0; x < m; x++) if (best[n - 2][x] > top) { top = best[n - 2][x]; j = x; }
  if (j < 0) return null;
  const picks = new Array(n - 1);
  for (let k = n - 2; k >= 0; k--) { picks[k] = inner[j]; j = from[k][j]; }
  const lines = texts.map((_, i) => ({ from: i ? picks[i - 1].end : lead, to: i < n - 1 ? picks[i].start : tail }));
  const speech = lines.reduce((a, l) => a + (l.to - l.from), 0);
  const fits = lines.every((l, i) => {
    const want = (speech * w[i]) / total, got = l.to - l.from;
    return got > 0.15 && (want < 1.2 ? Math.abs(got - want) < 1.4 : got / want > 0.45 && got / want < 2.2);
  });
  return fits ? lines : null;
}

// One WAV per line with a little breath around the speech.
async function cutLines(ffmpegPath, wav, lines, duration, files, signal) {
  for (let i = 0; i < lines.length; i++) {
    const start = Math.max(0, lines[i].from - 0.06), end = Math.min(duration, lines[i].to + 0.15);
    const tmp = `${files[i]}.${crypto.randomUUID()}.part.wav`;
    try {
      await new Promise((resolve, reject) => execFile(ffmpegPath, ['-v', 'error', '-y', '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', wav,
        '-c:a', 'pcm_s16le', tmp], { windowsHide: true, ...(signal ? { signal } : {}) }, (e) => (e ? reject(signal?.aborted ? Object.assign(new Error('Stopped.'), { name: 'AbortError' }) : new Error('Could not cut the narration into lines.')) : resolve())));
      fs.renameSync(tmp, files[i]);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
}

// lines: [text]. speak(text, style) -> WAV path (the provider's own request, cache and limits).
// Resolves { files, mode: 'one_request' | 'per_line', requests }.
async function speakLines({ ffmpegPath, outDir, lines, style = '', cacheKey, speak, signal }) {
  const texts = (Array.isArray(lines) ? lines : []).map((t) => String(t ?? '').trim());
  if (texts.length < 2) throw new Error('Give at least two lines; use add_voiceover for one.');
  if (texts.length > MAX_LINES) throw new Error(`Give at most ${MAX_LINES} lines per narration.`);
  if (texts.some((t) => !t)) throw new Error('Every narration line needs text.');
  const delivery = [String(style || '').trim(), BETWEEN].filter(Boolean).join(' ');
  const hash = crypto.createHash('sha256').update(JSON.stringify([cacheKey, delivery, texts])).digest('hex').slice(0, 20);
  const files = texts.map((_, i) => path.join(outDir, `narration-${hash}-${String(i + 1).padStart(2, '0')}.wav`));
  if (files.every((f) => fs.existsSync(f))) return { files, mode: 'one_request', requests: 0, cached: true };
  const whole = await speak(texts.join('\n\n'), delivery);
  const measured = await findPauses(ffmpegPath, whole, signal);
  const plan = planLines(measured, texts);
  if (plan) {
    fs.mkdirSync(outDir, { recursive: true });
    await cutLines(ffmpegPath, whole, plan, measured.duration, files, signal);
    return { files, mode: 'one_request', requests: 1 };
  }
  // The pauses did not line up with the lines: speak each line on its own.
  const each = [];
  for (const t of texts) each.push(await speak(t, String(style || '').trim()));
  return { files: each, mode: 'per_line', requests: 1 + texts.length };
}

module.exports = { speakLines, planLines, findPauses, MAX_LINES, BETWEEN };
