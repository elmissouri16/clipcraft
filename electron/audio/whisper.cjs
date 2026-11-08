// Auto captions with whisper.cpp (open-source, runs locally on the CPU).
// The binary and model are downloaded once on first use into `dir` (the app's user-data folder).
// Every step is written to `dir/last-run.log` so failures can be diagnosed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const RELEASE_BASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/';
// Downloadable engines for Windows and Linux. macOS uses a native whisper-cli
// installation; the CLI and its dynamic libraries must stay together.
const BINARIES = {
  'win32-x64': { file: 'whisper-bin-x64.zip', exe: 'whisper-cli.exe' },
  'linux-x64': { file: 'whisper-bin-ubuntu-x64.tar.gz', exe: 'whisper-cli' },
  'linux-arm64': { file: 'whisper-bin-ubuntu-arm64.tar.gz', exe: 'whisper-cli' },
};
const binSpec = () => BINARIES[`${process.platform}-${process.arch}`] || null;
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// Speech models, each downloaded on first use. base: small and fast, fine for clear English or French.
// turbo: large-v3-turbo (5-bit), much better at Arabic and Darija, about 4x bigger and several times slower on
// the CPU. Size and SHA-256 as published on Hugging Face.
const MODELS = {
  base: { file: 'ggml-base.bin', size: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' },
  // Moroccan Darija: amineouaki/whisper-medium-darija-combined (Apache-2.0), converted to whisper.cpp and 5-bit;
  // published with its license and the conversion steps at huggingface.co/MedHachim/whisper-medium-darija-ggml.
  darija: {
    file: 'ggml-medium-darija-q5_0.bin', size: 539212484, sha256: '1271472614bae20fdf0d7f99be18ce2b881036f6a26df501fbfc3bdde48888ce',
    url: 'https://huggingface.co/MedHachim/whisper-medium-darija-ggml/resolve/main/ggml-medium-darija-q5_0.bin', pieces: true,
  },
};
const modelOf = (id) => MODELS[id] || MODELS.base;
// A model can live outside whisper.cpp's repo (url), and `pieces: true` marks one fine-tuned without timestamps:
// it places words evenly over each 30 s window, so it gets the audio in short pieces cut at pauses instead.
const modelUrl = (M) => M.url || MODEL_BASE_URL + M.file;
const PIECE_MAX = 8; // seconds; measured on Darija: word times within 0.2 s of large-v3-turbo's

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

function resolveCli(dir, { platform = process.platform, env = process.env } = {}) {
  const exe = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const binDir = path.join(dir, 'bin');
  const managed = fs.existsSync(binDir) ? findFile(binDir, exe) : null;
  const runnable = (file) => {
    try {
      if (!fs.statSync(file).isFile()) return false;
      fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return true;
    } catch { return false; }
  };
  if (managed && runnable(managed)) return managed;
  if (platform !== 'darwin') return null;
  // Finder-launched apps often have only /usr/bin:/bin on PATH. Check both
  // Homebrew prefixes explicitly, for Apple Silicon and Intel installations.
  const candidates = [
    env.CLIPCRAFT_WHISPER_CLI,
    ...(env.PATH || '').split(path.delimiter).filter(Boolean).map((p) => path.join(p, exe)),
    '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli',
  ];
  return candidates.find((file) => file && path.isAbsolute(file) && runnable(file)) || null;
}

function paths(dir, modelId) {
  const binDir = path.join(dir, 'bin');
  return {
    binDir,
    cli: resolveCli(dir),
    model: path.join(dir, modelOf(modelId).file),
    log: path.join(dir, 'last-run.log'),
  };
}

const modelReady = (dir, id) => {
  const f = paths(dir, id).model;
  return fs.existsSync(f) && fs.statSync(f).size === modelOf(id).size;
};

// installed: the engine and the base model are there; models: which models are downloaded; available: the ones
// that can be used (downloaded, or with a place to download them from).
function status(dir) {
  const p = paths(dir);
  const models = Object.fromEntries(Object.keys(MODELS).map((id) => [id, modelReady(dir, id)]));
  const available = Object.keys(MODELS).filter((id) => models[id] || MODELS[id].url !== null);
  return { installed: !!p.cli && models.base, models, available };
}

// Appends a timestamped line to last-run.log (started fresh by install()).
function logLine(dir, text) {
  try {
    fs.appendFileSync(paths(dir).log, `[${new Date().toISOString()}] ${text}\n`, 'utf8');
  } catch {
    // Logging must never break captions.
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

async function download(dir, url, dest, onProgress, expected, signal) {
  signal?.throwIfAborted();
  logLine(dir, `download ${url}`);
  const res = await fetch(url, { redirect: 'follow', ...(signal ? { signal } : {}) });
  logLine(dir, `  -> HTTP ${res.status}, ${res.headers.get('content-type')}, ${res.headers.get('content-length')} bytes`);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}). Check your internet connection and try again.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (total) onProgress?.(done / total);
      cb(null, chunk);
    },
  });
  const tmp = `${dest}.${crypto.randomUUID()}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp), ...(signal ? [{ signal }] : []));
    logLine(dir, `  -> wrote ${done} bytes`);
    if (expected && done !== expected.size) throw new Error(`The speech model download was incomplete (${done} of ${expected.size} bytes). Check your internet connection and try again.`);
    if (expected?.sha256 && await sha256File(tmp) !== expected.sha256) throw new Error('The speech model download failed its checksum. Please try again.');
    signal?.throwIfAborted();
    fs.renameSync(tmp, dest);
    return done;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Downloads whisper-cli and the model (base or turbo) if they are missing. onProgress(stage, fraction).
async function install(dir, onProgress, modelId = 'base', signal) {
  signal?.throwIfAborted();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(paths(dir).log, '', 'utf8');
  logLine(dir, `install: dir=${dir} model=${modelId}`);
  const p = paths(dir, modelId);
  const M = modelOf(modelId);
  if (!p.cli) {
    const spec = binSpec();
    if (!spec) throw new Error(process.platform === 'darwin'
      ? 'Local captions need whisper-cli. Install whisper.cpp with Homebrew (brew install whisper-cpp), then try again. For a custom location, set CLIPCRAFT_WHISPER_CLI to the full executable path.'
      : `No caption engine is available for ${process.platform}-${process.arch}.`);
    const pack = path.join(dir, spec.file);
    await download(dir, RELEASE_BASE + spec.file, pack, (f) => onProgress?.('engine', f), undefined, signal);
    fs.mkdirSync(p.binDir, { recursive: true });
    if (process.platform === 'win32') {
      // Windows 10+ ships bsdtar, which extracts .zip files.
      await new Promise((resolve, reject) =>
        execFile(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-xf', pack, '-C', p.binDir], { windowsHide: true, ...(signal ? { signal } : {}) }, (e) => (e ? reject(e) : resolve()))
      );
    } else {
      await new Promise((resolve, reject) =>
        execFile('tar', ['-xzf', pack, '-C', p.binDir], { ...(signal ? { signal } : {}) }, (e) => (e ? reject(new Error(`Could not extract the caption engine (${e.message}).`)) : resolve()))
      );
    }
    fs.rmSync(pack, { force: true });
  }
  const size = fs.existsSync(p.model) ? fs.statSync(p.model).size : -1;
  logLine(dir, `model: ${p.model} size=${size}`);
  if (size !== M.size) {
    if (size >= 0) fs.rmSync(p.model, { force: true });
    if (M.url === null) throw new Error('This speech model is not available for download yet.');
    await download(dir, modelUrl(M), p.model, (f) => onProgress?.('model', f), M, signal);
  }
  if (!paths(dir).cli) throw new Error(`${binSpec()?.exe || 'whisper-cli'} not found after extraction.`);
  logLine(dir, `install ok: cli=${paths(dir).cli}`);
}

// Runs whisper-cli once. Resolves { code, log }.
// onFile(n) is called as whisper-cli starts its n-th input file (0-based).
function runCli(cli, args, onProgress, onFile, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cli, args, { windowsHide: true, cwd: path.dirname(cli), ...(signal ? { signal } : {}) });
    let log = '';
    const onData = (d) => {
      const s = d.toString();
      log += s;
      const m = /progress\s*=\s*(\d+)%/g;
      let x;
      while ((x = m.exec(s))) onProgress?.(Number(x[1]) / 100);
      const f = /processing '/g;
      while (f.exec(s)) onFile?.(files++);
    };
    let files = 0;
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', error => { if (error.name !== 'AbortError') reject(error); });
    proc.on('close', code => signal?.aborted ? reject(Object.assign(new Error('Transcription stopped.'), { name: 'AbortError' })) : resolve({ code, log }));
  });
}

// Word timings (seconds) for one segment of whisper's full JSON. Tokens starting with a space begin a
// new word; punctuation sticks to the previous one. Token text can split multi-byte characters
// (e.g. Arabic), so the words' text comes from the segment text when the counts agree; otherwise the
// segment duration is shared out by word length.
function segmentWords(s, seg) {
  const words = [];
  for (const t of s.tokens || []) {
    if (/^\[_/.test(t.text) || !t.offsets) continue;
    const from = t.offsets.from / 1000;
    const to = t.offsets.to / 1000;
    if (!words.length || /^\s/.test(t.text)) words.push({ text: t.text.trim(), start: from, end: to });
    else {
      words[words.length - 1].text += t.text;
      words[words.length - 1].end = to;
    }
  }
  const real = words.filter((w) => w.text);
  const textWords = seg.text.split(/\s+/).filter(Boolean);
  if (real.length === textWords.length && real.every((w, i) =>
    Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start
    && w.start >= seg.start && w.end <= seg.end + 0.001 && (!i || w.start >= real[i - 1].start))) {
    // Whisper sometimes reports a zero-length token. Give only that word a
    // short span before the next word and mark it estimated; every other word
    // keeps its measured timing instead of the whole segment being spread out.
    return real.map((w, i) => {
      if (w.end > w.start) return { ...w, text: textWords[i], timing: 'measured' };
      const next = real.slice(i + 1).find((x) => x.start > w.start)?.start ?? seg.end;
      const end = Math.min(w.start + 0.08, next, seg.end);
      const start = end > w.start ? w.start : Math.max(seg.start, i ? real[i - 1].start : seg.start, end - 0.04);
      return { ...w, text: textWords[i], start, end: Math.max(end, start + 0.001), timing: 'estimated' };
    });
  }
  const total = textWords.reduce((n, w) => n + w.length, 0) || 1;
  let t = seg.start;
  return textWords.map((w) => {
    const d = ((seg.end - seg.start) * w.length) / total;
    const out = { text: w, start: t, end: t + d, timing: 'estimated' };
    t += d;
    return out;
  });
}

// Pieces of a WAV cut in the middle of pauses, at most PIECE_MAX seconds each: [{ file, at, from, to }] (seconds:
// where the piece starts, and where its speech starts and ends, i.e. without the pauses at its edges).
async function cutAtPauses(wav, signal) {
  signal?.throwIfAborted();
  const { ffmpegPath } = require("../media/ffmpeg.cjs");
  const log = await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.25', '-f', 'null', '-'], { windowsHide: true, ...(signal ? { signal } : {}) });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', error => { if (error.name !== 'AbortError') reject(error); });
    p.on('close', () => signal?.aborted ? reject(Object.assign(new Error('Transcription stopped.'), { name: 'AbortError' })) : resolve(err));
  });
  const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const dur = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0;
  const pauses = [];
  const re = /silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g;
  for (let m; (m = re.exec(log));) pauses.push([Number(m[1]), Number(m[2])]);
  const mids = pauses.map(([a, b]) => (a + b) / 2);
  const pauseAt = (t) => pauses.find(([a, b]) => t >= a - 0.01 && t <= b + 0.01);
  const cuts = [0];
  while (dur - cuts[cuts.length - 1] > PIECE_MAX) {
    const from = cuts[cuts.length - 1];
    const inside = mids.filter((x) => x > from + 1 && x <= from + PIECE_MAX);
    cuts.push(inside.length ? inside[inside.length - 1] : from + PIECE_MAX);
  }
  cuts.push(dur);
  const dir = wav.replace(/\.wav$/i, '-pieces');
  fs.mkdirSync(dir, { recursive: true });
  const pieces = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const file = path.join(dir, `${String(i).padStart(4, '0')}.wav`);
    await new Promise((resolve, reject) => execFile(ffmpegPath, ['-v', 'error', '-y', '-ss', String(cuts[i]), '-t', String(cuts[i + 1] - cuts[i]),
      '-i', wav, '-c:a', 'pcm_s16le', file], { windowsHide: true, ...(signal ? { signal } : {}) }, (e) => (e ? reject(e) : resolve())));
    const from = Math.max(cuts[i], pauseAt(cuts[i])?.[1] ?? cuts[i]);
    const to = Math.min(cuts[i + 1], pauseAt(cuts[i + 1])?.[0] ?? cuts[i + 1]);
    pieces.push({ file, at: cuts[i], ...(to - from > 0.2 ? { from, to } : { from: cuts[i], to: cuts[i + 1] }) });
  }
  return pieces;
}

const isNoise = (text) => !text || /^\[.*\]$|^\(.*\)$/.test(text);

// Segments of whisper's full JSON.
function readSegments(json) {
  return (json.transcription || [])
    .map((s) => {
      const seg = { start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() };
      seg.words = segmentWords(s, seg);
      seg.word_timing = seg.words.every(w => w.timing === 'measured') ? 'measured' : 'estimated';
      // A segment can include leading silence (e.g. an audio clip that starts later on the timeline).
      if (seg.words.length && seg.words[0].start - seg.start > 0.3) seg.start = Math.max(0, seg.words[0].start - 0.1);
      return seg;
    })
    .filter((s) => !isNoise(s.text) && s.end > s.start);
}

// Segments of one piece (see cutAtPauses) for a model without reliable timestamps: its words are spread over the
// piece's speech by length, since speech between two pauses a few seconds apart goes at a fairly even pace.
// Measured on Darija against large-v3-turbo's own word times.
function readPiece(json, piece) {
  const segs = (json.transcription || []).map((s) => s.text.trim()).filter((t) => !isNoise(t));
  const words = segs.flatMap((text, seg) => text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, seg })));
  const weight = (w) => [...w].length + 1;
  const total = words.reduce((n, w) => n + weight(w.text), 0);
  let t = piece.from;
  for (const w of words) {
    const d = ((piece.to - piece.from) * weight(w.text)) / total;
    Object.assign(w, { start: t, end: t + d });
    t += d;
  }
  return segs
    .map((text, i) => {
      const ws = words.filter((w) => w.seg === i).map(({ text: x, start, end }) => ({ text: x, start, end, timing: 'estimated' }));
      return ws.length ? { start: ws[0].start, end: ws[ws.length - 1].end, text, words: ws, word_timing: 'estimated' } : null;
    })
    .filter(Boolean);
}

// Short, readable reason from a whisper-cli log.
function failureReason(log) {
  const lines = log.split(/\r?\n/).filter((l) => /error|failed|invalid|not all tensors|bad magic|out of memory/i.test(l));
  return lines.slice(-3).join('\n') || 'whisper-cli stopped without an error message.';
}

// Transcribes a 16 kHz mono WAV. Returns [{ start, end, text }] in seconds.
// If whisper-cli cannot create its context (exit code 3), retries with conservative settings
// (CPU only, no flash attention, fewer threads, greedy decoding). If the model itself is corrupt
// (hash mismatch), it is deleted and an error with code MODEL_DAMAGED is thrown so the caller
// can download it again and retry.
// Recognizes short clips in one whisper-cli run (the model loads once): the
// texts let editorial cuts confirm which sound is really a hesitation.
async function transcribeClips(dir, files, { language = 'en', model = 'base', signal } = {}) {
  signal?.throwIfAborted();
  const p = paths(dir, model);
  if (!p.cli || !fs.existsSync(p.model)) throw new Error('The local speech engine is not installed.');
  const threads = Math.max(1, Math.min(8, os.cpus().length - 1));
  const { code, log } = await runCli(p.cli, ['-m', p.model, ...files.flatMap(f => ['-f', f]), '-l', language, '-ojf', '-nt', '-t', String(threads)], undefined, undefined, signal);
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(failureReason(log));
  return files.map(f => { try { return JSON.parse(fs.readFileSync(`${f}.json`, 'utf8')).transcription.map(t => t.text).join(' ').trim(); } catch { return ''; } });
}

// Verbatim transcripts keep hesitations ("um", "uh") that Whisper otherwise
// tends to clean up: a disfluent initial prompt biases decoding toward them.
// Editorial tools use it to find fillers; captions keep the clean default.
const VERBATIM_PROMPT = 'Umm, uh, so, like, I mean... er, okay. Hmm, uh-huh.';
async function transcribe(dir, wav, { language = 'auto', maxLen = 42, model = 'base', verbatim = false, signal } = {}, onProgress) {
  signal?.throwIfAborted();
  const p = paths(dir, model);
  const outBase = wav.replace(/\.wav$/i, '');
  const threads = Math.max(1, Math.min(8, os.cpus().length - 1));
  // One whisper-cli run for all the pieces (the model loads once); each writes <piece>.json.
  const pieces = modelOf(model).pieces ? await cutAtPauses(wav, signal) : null;
  const inputs = pieces ? pieces.flatMap((x) => ['-f', x.file]) : ['-f', wav, '-of', outBase];
  const base = ['-m', p.model, ...inputs, '-l', language, '-ojf', '-pp'];
  // Pieces are short: an audio window of PIECE_MAX (not Whisper's 30 s) cuts the encoder's work about 3.5x.
  if (pieces) base.push('-ac', String(Math.ceil((((PIECE_MAX + 0.5) / 30) * 1500) / 64) * 64));
  if (maxLen > 0) base.push('-ml', String(maxLen), '-sow');
  if (verbatim) base.push('--prompt', VERBATIM_PROMPT);
  // Progress over all the pieces: which piece whisper-cli is on, plus its own 0-100 % for that piece.
  let done = 0;
  const progress = pieces ? (f) => onProgress?.(Math.min(1, (done + f) / pieces.length)) : onProgress;
  const onFile = pieces ? (n) => { done = n; onProgress?.(n / pieces.length); } : undefined;
  const attempts = [
    ['-t', String(threads)],
    ['-t', String(Math.min(4, threads)), '-ng', '-nfa', '-bs', '1', '-bo', '1'],
  ];
  let full = '';
  for (let i = 0; i < attempts.length; i++) {
    const args = [...base, ...attempts[i]];
    done = 0;
    const { code, log } = await runCli(p.cli, args, progress, onFile, signal);
    signal?.throwIfAborted();
    full += log;
    logLine(dir, `attempt ${i + 1}: whisper-cli ${args.join(' ')}\n${log}\n--- exit code ${code}`);
    if (code === 0) {
      if (!pieces) return readSegments(JSON.parse(fs.readFileSync(outBase + '.json', 'utf8')));
      return pieces.flatMap((x) => readPiece(JSON.parse(fs.readFileSync(`${x.file}.json`, 'utf8')), x));
    }
    if (code !== 3) break;
    if (/failed to load model|bad magic|invalid model|not all tensors/i.test(log)) {
      const hash = await sha256File(p.model).catch((e) => `unreadable (${e.message})`);
      logLine(dir, `model sha256=${hash} expected=${modelOf(model).sha256}`);
      if (hash !== modelOf(model).sha256) {
        fs.rmSync(p.model, { force: true });
        const e = new Error('The speech model file was damaged.');
        e.code = 'MODEL_DAMAGED';
        throw e;
      }
    }
  }
  throw new Error(`Auto captions failed.\n${failureReason(full)}\n\nFull log: ${p.log}`);
}

module.exports = {
  VERBATIM_PROMPT, transcribeClips, status, install, transcribe, MODELS, cutAtPauses, readPiece, readSegments, resolveCli };
