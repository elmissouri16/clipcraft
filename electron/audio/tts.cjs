// Text to speech. Two engines:
//   - Piper voices (https://github.com/rhasspy/piper, MIT): free, run on this computer, no account. The engine and
//     each voice are optional downloads, managed in Settings > Voice, into <userData>/tts. Voices are chosen for
//     licences that allow use in videos. One runtime per platform:
//       Windows and Linux: Piper's own build (2023.11.14-2) with the voices from rhasspy/piper-voices.
//       macOS: Piper's macOS builds do not run (an x86_64 binary in the arm64 archive, and the libraries it needs are
//       missing), so the same voices run with sherpa-onnx 1.13.8 (Apache-2.0; the last line with Piper's espeak-ng
//       phonemizer built in), as packaged by sherpa-onnx (tts-models release).
//     Engine archives are checked against their SHA-256 before anything is unpacked or run.
//   - ElevenLabs (https://elevenlabs.io): online, with the user's own API key (saved encrypted in Settings).
// Pure module: the caller passes `fetch` and the folders.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { checkAbort, abortError } = require("../system/cancel.cjs");
const { spawn, execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const SHERPA_VERSION = 'v1.13.8';
const SHERPA_RELEASE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/`;
const SHERPA_VOICES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/';
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

// The engine for each platform-arch. Windows on Arm runs the x64 build through Windows' emulation.
const PIPER_WIN = { kind: 'piper', file: 'piper_windows_amd64.zip', bytes: 22477236, sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea' };
const RUNTIMES = {
  'win32-x64': PIPER_WIN,
  'win32-arm64': PIPER_WIN,
  'linux-x64': { kind: 'piper', file: 'piper_linux_x86_64.tar.gz', bytes: 26460462, sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992' },
  'linux-arm64': { kind: 'piper', file: 'piper_linux_aarch64.tar.gz', bytes: 26004717, sha256: 'fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb' },
  'darwin-arm64': { kind: 'sherpa', file: `sherpa-onnx-${SHERPA_VERSION}-osx-arm64-shared.tar.bz2`, bytes: 20314448, sha256: 'b10e5c7e2c30ea03de9c442655d14860d9edc475c6251d58a8f5f06e913a1d56' },
  'darwin-x64': { kind: 'sherpa', file: `sherpa-onnx-${SHERPA_VERSION}-osx-x64-shared.tar.bz2`, bytes: 22846038, sha256: '54aad64acee9d2d596535a6080d6f22602a720af5460e1d50461b1e1b06bee40' },
};
// Download size of one voice: Piper's .onnx, or sherpa-onnx's archive (model, tokens and espeak-ng data).
const VOICE_BYTES = { piper: 63300000, sherpa: 67200000 };

// Voices whose recordings may be used freely (CC0, public domain, CC BY). Arabic has a single Piper voice whose
// dataset states no licence; it is offered with that note.
const PIPER_VOICES = [
  { id: 'en_US-joe-medium', name: 'Joe', lang: 'English (US)', gender: 'male', license: 'CC0' },
  { id: 'en_US-norman-medium', name: 'Norman', lang: 'English (US)', gender: 'male', license: 'Public domain' },
  { id: 'en_GB-cori-medium', name: 'Cori', lang: 'English (UK)', gender: 'female', license: 'Public domain' },
  { id: 'fr_FR-siwis-medium', name: 'Siwis', lang: 'French', gender: 'female', license: 'CC BY 4.0' },
  { id: 'fr_FR-gilles-low', name: 'Gilles', lang: 'French', gender: 'male', license: 'CC0' },
  { id: 'es_ES-davefx-medium', name: 'Davefx', lang: 'Spanish', gender: 'male', license: 'CC0' },
  { id: 'de_DE-thorsten-medium', name: 'Thorsten', lang: 'German', gender: 'male', license: 'CC0' },
  { id: 'ar_JO-kareem-medium', name: 'Kareem', lang: 'Arabic', gender: 'male', license: 'Not stated (personal use)' },
];
const voiceUrl = (id) => {
  const [loc, name, quality] = id.split('-');
  return `${HF}${loc.split('_')[0]}/${loc}/${name}/${quality}/${id}.onnx`;
};

const piperRuntime = (platform = process.platform, arch = process.arch) => RUNTIMES[`${platform}-${arch}`] || null;
const NOT_SUPPORTED = 'Piper voices are not available on this computer.';

// sha256: the archive must match before it is kept (engine archives run code).
async function download(fetchImpl, url, dest, onProgress, { signal, sha256 } = {}) {
  checkAbort(signal);
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}). Check your internet connection.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const hash = crypto.createHash('sha256');
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length; hash.update(chunk);
      if (total) onProgress?.(done / total);
      cb(null, chunk);
    },
  });
  const tmp = `${dest}.${crypto.randomUUID()}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp), { signal });
    checkAbort(signal);
    if (sha256 && hash.digest('hex') !== sha256) throw new Error('The download did not match the expected file (checksum). It was not installed; try again later.');
    fs.renameSync(tmp, dest);
  } finally { fs.rmSync(tmp, { force: true }); }
}

// Unpacks into a fresh folder: Windows' own tar.exe (zip), the system tar elsewhere (gzip on Linux, bzip2 on macOS).
async function extract(archive, into, { signal, platform = process.platform } = {}) {
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  const tar = platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : fs.existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar';
  await new Promise((resolve, reject) => execFile(tar, ['-xf', archive, '-C', into], { windowsHide: true, signal },
    (e, _out, err) => (e ? reject(signal?.aborted ? abortError() : new Error(`Could not unpack ${path.basename(archive)}: ${String(err || e.message).trim().slice(0, 300)}`)) : resolve())));
}

// Where things live in <userData>/tts for a runtime.
function layout(dir, rt, platform = process.platform) {
  if (rt?.kind === 'sherpa') {
    return { engineDir: path.join(dir, 'sherpa-onnx'), exe: path.join(dir, 'sherpa-onnx', 'bin', 'sherpa-onnx-offline-tts'),
      voice: (id) => ({ dir: path.join(dir, 'voices-sherpa', id), model: path.join(dir, 'voices-sherpa', id, `${id}.onnx`), files: [path.join(dir, 'voices-sherpa', id)] }) };
  }
  return { engineDir: path.join(dir, 'piper'), exe: path.join(dir, 'piper', platform === 'win32' ? 'piper.exe' : 'piper'),
    voice: (id) => { const model = path.join(dir, 'voices', `${id}.onnx`); return { model, files: [model, `${model}.json`] }; } };
}
const voiceReady = (lay, rt, id) => rt?.kind === 'sherpa'
  ? ['tokens.txt', 'espeak-ng-data'].every((f) => fs.existsSync(path.join(lay.voice(id).dir, f))) && fs.existsSync(lay.voice(id).model)
  : fs.existsSync(lay.voice(id).model) && fs.existsSync(`${lay.voice(id).model}.json`);

function piperStatus(dir, { rt = piperRuntime(), platform = process.platform } = {}) {
  const lay = rt && layout(dir, rt, platform);
  return {
    supported: !!rt, runtime: rt?.kind || null, engineBytes: rt?.bytes || 0,
    installed: !!rt && fs.existsSync(lay.exe),
    voices: PIPER_VOICES.map((v) => ({ ...v, bytes: rt ? VOICE_BYTES[rt.kind] : 0, downloaded: !!rt && voiceReady(lay, rt, v.id) })),
  };
}

// Downloads the engine ('engine') or one voice. onProgress(fraction).
async function piperDownload(fetchImpl, dir, target, onProgress, { signal, rt = piperRuntime(), platform = process.platform } = {}) {
  checkAbort(signal);
  if (!rt) throw new Error(NOT_SUPPORTED);
  const lay = layout(dir, rt, platform);
  fs.mkdirSync(dir, { recursive: true });
  const work = path.join(dir, `.unpack-${crypto.randomUUID()}`);
  try {
    if (target === 'engine') {
      const archive = path.join(dir, rt.file);
      await download(fetchImpl, (rt.kind === 'sherpa' ? SHERPA_RELEASE : PIPER_RELEASE) + rt.file, archive, onProgress, { signal, sha256: rt.sha256 });
      try { await extract(archive, work, { signal, platform }); } finally { fs.rmSync(archive, { force: true }); }
      // Piper unpacks to piper/; sherpa-onnx to sherpa-onnx-<version>-<platform>-shared/ with ~30 programs, of
      // which only the TTS one (and its libraries) is kept.
      const top = path.join(work, rt.kind === 'sherpa' ? path.basename(rt.file, '.tar.bz2') : 'piper');
      if (rt.kind === 'sherpa') {
        for (const f of fs.readdirSync(path.join(top, 'bin'))) if (f !== 'sherpa-onnx-offline-tts') fs.rmSync(path.join(top, 'bin', f), { force: true });
        fs.rmSync(path.join(top, 'include'), { recursive: true, force: true });
      }
      if (!fs.existsSync(path.join(top, path.relative(lay.engineDir, lay.exe)))) throw new Error('The voice engine was not found after unpacking.');
      checkAbort(signal);
      fs.rmSync(lay.engineDir, { recursive: true, force: true });
      fs.renameSync(top, lay.engineDir);
      return;
    }
    if (!PIPER_VOICES.some((v) => v.id === target)) throw new Error('Unknown voice.');
    const voice = lay.voice(target);
    if (rt.kind === 'sherpa') {
      const archive = path.join(dir, `vits-piper-${target}.tar.bz2`);
      await download(fetchImpl, `${SHERPA_VOICES}vits-piper-${target}.tar.bz2`, archive, onProgress, { signal });
      try { await extract(archive, work, { signal, platform }); } finally { fs.rmSync(archive, { force: true }); }
      const top = path.join(work, `vits-piper-${target}`);
      if (!fs.existsSync(path.join(top, `${target}.onnx`)) || !fs.existsSync(path.join(top, 'tokens.txt'))) throw new Error('The voice was not found after unpacking.');
      checkAbort(signal);
      fs.mkdirSync(path.dirname(voice.dir), { recursive: true });
      fs.rmSync(voice.dir, { recursive: true, force: true });
      fs.renameSync(top, voice.dir);
    } else {
      fs.mkdirSync(path.dirname(voice.model), { recursive: true });
      await download(fetchImpl, `${voiceUrl(target)}.json`, `${voice.model}.json`, undefined, { signal });
      await download(fetchImpl, voiceUrl(target), voice.model, onProgress, { signal });
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

// Removes the engine ('engine') or one voice.
function piperRemove(dir, target, { rt = piperRuntime(), platform = process.platform } = {}) {
  if (!rt) throw new Error(NOT_SUPPORTED);
  const lay = layout(dir, rt, platform);
  if (target === 'engine') fs.rmSync(lay.engineDir, { recursive: true, force: true });
  else if (PIPER_VOICES.some((v) => v.id === target)) for (const f of lay.voice(target).files) fs.rmSync(f, { recursive: true, force: true });
  else throw new Error('Unknown voice.');
}

const keyOf = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
const run = (exe, args, { input, cwd, signal }) => new Promise((resolve, reject) => {
  const p = spawn(exe, args, { windowsHide: true, cwd, signal });
  let err = '';
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  p.on('error', (e) => reject(signal?.aborted ? abortError() : e));
  p.stdin.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`The voice engine failed: ${err.trim().split('\n').filter((l) => !/^\s*$/.test(l)).pop() || code}`))));
  p.stdin.end(input || '', 'utf8');
});

// Speaks `text` with a Piper voice into a WAV file in outDir; returns its path (cached per text and settings).
async function piperSpeak(dir, outDir, { voiceId, text, speed = 1, signal }, { rt = piperRuntime(), platform = process.platform } = {}) {
  checkAbort(signal);
  if (!rt) throw new Error(NOT_SUPPORTED);
  const clean = String(text || '').trim().slice(0, 5000);
  if (!clean) throw new Error('Type some text first.');
  if (!PIPER_VOICES.some((v) => v.id === voiceId)) throw new Error('Unknown voice.');
  const lay = layout(dir, rt, platform);
  if (!fs.existsSync(lay.exe)) throw new Error('Download the Piper voice engine first, in Settings > Voice.');
  if (!voiceReady(lay, rt, voiceId)) throw new Error('This voice is not downloaded. Download it in Settings > Voice.');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `piper-${keyOf(voiceId, speed, clean)}.wav`);
  if (fs.existsSync(out)) return out;
  const lengthScale = (1 / Math.min(2, Math.max(0.5, speed))).toFixed(3);
  const part = `${out}.part.wav`;
  try {
    if (rt.kind === 'sherpa') {
      const voice = lay.voice(voiceId);
      // The text is the last argument; a leading dash would read as an option.
      const spoken = clean.replace(/\r?\n+/g, '\n');
      await run(lay.exe, [`--vits-model=${voice.model}`, `--vits-tokens=${path.join(voice.dir, 'tokens.txt')}`, `--vits-data-dir=${path.join(voice.dir, 'espeak-ng-data')}`,
        `--vits-length-scale=${lengthScale}`, `--num-threads=${Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))}`, `--output-filename=${part}`,
        spoken.startsWith('-') ? ` ${spoken}` : spoken], { cwd: path.dirname(lay.exe), signal });
    } else {
      // One line per paragraph; Piper reads line by line.
      await run(lay.exe, ['--model', lay.voice(voiceId).model, '--length_scale', lengthScale, '--output_file', part],
        { input: `${clean.replace(/\r?\n+/g, '\n')}\n`, cwd: path.dirname(lay.exe), signal });
    }
    checkAbort(signal);
    if (!fs.existsSync(part)) throw new Error('The voice engine did not write any audio.');
    fs.renameSync(part, out);
    return out;
  } finally { fs.rmSync(part, { force: true }); }
}

// ---- ElevenLabs
const EL = 'https://api.elevenlabs.io/v1';

async function elError(res) {
  let msg = '';
  try {
    const d = await res.json();
    msg = (d.detail && (d.detail.message || d.detail.status || d.detail)) || '';
  } catch {
    // no body
  }
  if (res.status === 401) return new Error('ElevenLabs refused the API key. Check it in Settings.');
  if (/quota|credits/i.test(String(msg))) return new Error('Your ElevenLabs credits for this month are used up.');
  if (res.status === 429) return new Error('ElevenLabs is busy or your plan limit was reached. Try again in a moment.');
  return new Error(`ElevenLabs answered ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}.`);
}

async function elevenVoices(fetchImpl, key) {
  if (!key) throw new Error('Add your ElevenLabs API key in Settings.');
  let res;
  try {
    res = await fetchImpl(`${EL}/voices`, { headers: { 'xi-api-key': key, Accept: 'application/json' } });
  } catch {
    throw new Error('No internet connection.');
  }
  if (!res.ok) throw await elError(res);
  const d = await res.json();
  return (d.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    gender: v.labels && v.labels.gender,
    accent: v.labels && (v.labels.accent || v.labels.language),
    category: v.category,
  }));
}

// Credits of the key's account this month: { used, limit, left, tier, resetsAt (ms, or null) }.
async function elevenUsage(fetchImpl, key) {
  if (!key) throw new Error('Add your ElevenLabs API key in Settings.');
  let res;
  try {
    res = await fetchImpl(`${EL}/user/subscription`, { headers: { 'xi-api-key': key, Accept: 'application/json' } });
  } catch {
    throw new Error('No internet connection.');
  }
  if (!res.ok) throw await elError(res);
  const d = await res.json();
  const used = Number(d.character_count) || 0;
  const limit = Number(d.character_limit) || 0;
  return {
    used,
    limit,
    left: Math.max(0, limit - used),
    tier: d.tier || '',
    resetsAt: d.next_character_count_reset_unix ? d.next_character_count_reset_unix * 1000 : null,
  };
}

// Speaks `text` with an ElevenLabs voice into an MP3 file; returns its path (cached per text and settings).
async function elevenSpeak(fetchImpl, key, outDir, { voiceId, text, model = 'eleven_multilingual_v2', stability = 0.5, similarity = 0.75, speed = 1, signal }) {
  checkAbort(signal);
  if (!key) throw new Error('Add your ElevenLabs API key in Settings.');
  const clean = String(text || '').trim().slice(0, 5000);
  if (!clean) throw new Error('Type some text first.');
  if (!/^[A-Za-z0-9]{8,40}$/.test(String(voiceId))) throw new Error('Pick a voice first.');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `eleven-${keyOf(voiceId, model, stability, similarity, speed, clean)}.mp3`);
  if (fs.existsSync(out)) return out;
  let res;
  try {
    res = await fetchImpl(`${EL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: clean,
        model_id: model,
        voice_settings: { stability, similarity_boost: similarity, speed: Math.min(1.2, Math.max(0.7, speed)) },
      }),
    });
  } catch {
    throw new Error('No internet connection.');
  }
  if (!res.ok) throw await elError(res);
  const buf = Buffer.from(await res.arrayBuffer());
  checkAbort(signal);
  if (buf.length < 500) throw new Error('ElevenLabs sent no audio.');
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}

module.exports = { PIPER_VOICES, RUNTIMES, piperRuntime, piperStatus, piperDownload, piperRemove, piperSpeak, elevenVoices, elevenUsage, elevenSpeak, voiceUrl };
