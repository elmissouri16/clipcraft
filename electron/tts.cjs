// Text to speech. Two engines:
//   - Piper (https://github.com/rhasspy/piper, MIT): free, runs on this PC, no account. The program and each voice
//     are downloaded once into <userData>/tts. Voices are chosen for licences that allow use in videos.
//   - ElevenLabs (https://elevenlabs.io): online, with the user's own API key (saved encrypted in Settings).
// Pure module: the caller passes `fetch` and the folders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

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

async function download(fetchImpl, url, dest, onProgress) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}). Check your internet connection.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (total) onProgress?.(done / total);
      cb(null, chunk);
    },
  });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

const piperExe = (dir) => path.join(dir, 'piper', 'piper.exe');
const voiceFile = (dir, id) => path.join(dir, 'voices', `${id}.onnx`);

function piperStatus(dir) {
  return {
    installed: fs.existsSync(piperExe(dir)),
    voices: PIPER_VOICES.map((v) => ({ ...v, downloaded: fs.existsSync(voiceFile(dir, v.id)) && fs.existsSync(`${voiceFile(dir, v.id)}.json`) })),
  };
}

// Downloads Piper and the voice when missing. onProgress(stage, fraction).
async function piperPrepare(fetchImpl, dir, voiceId, onProgress) {
  if (!PIPER_VOICES.some((v) => v.id === voiceId)) throw new Error('Unknown voice.');
  fs.mkdirSync(path.join(dir, 'voices'), { recursive: true });
  if (!fs.existsSync(piperExe(dir))) {
    const zip = path.join(dir, 'piper.zip');
    await download(fetchImpl, PIPER_ZIP, zip, (f) => onProgress?.('engine', f));
    await new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'),
      ['-xf', zip, '-C', dir], { windowsHide: true }, (e) => (e ? reject(e) : resolve())));
    fs.rmSync(zip, { force: true });
    if (!fs.existsSync(piperExe(dir))) throw new Error('piper.exe not found after extraction.');
  }
  const onnx = voiceFile(dir, voiceId);
  if (!fs.existsSync(`${onnx}.json`)) await download(fetchImpl, `${voiceUrl(voiceId)}.json`, `${onnx}.json`);
  if (!fs.existsSync(onnx)) await download(fetchImpl, voiceUrl(voiceId), onnx, (f) => onProgress?.('voice', f));
}

const keyOf = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

// Speaks `text` with a Piper voice into a WAV file in outDir; returns its path (cached per text and settings).
async function piperSpeak(dir, outDir, { voiceId, text, speed = 1 }) {
  const clean = String(text || '').trim().slice(0, 5000);
  if (!clean) throw new Error('Type some text first.');
  if (!fs.existsSync(piperExe(dir)) || !fs.existsSync(voiceFile(dir, voiceId))) throw new Error('The voice is not downloaded yet.');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `piper-${keyOf(voiceId, speed, clean)}.wav`);
  if (fs.existsSync(out)) return out;
  const lengthScale = (1 / Math.min(2, Math.max(0.5, speed))).toFixed(3);
  await new Promise((resolve, reject) => {
    const p = spawn(piperExe(dir), ['--model', voiceFile(dir, voiceId), '--length_scale', lengthScale, '--output_file', `${out}.part.wav`],
      { windowsHide: true, cwd: path.dirname(piperExe(dir)) });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Piper failed: ${err.trim().split('\n').pop() || code}`))));
    // One line per paragraph; Piper reads line by line.
    p.stdin.end(`${clean.replace(/\r?\n+/g, '\n')}\n`, 'utf8');
  });
  fs.renameSync(`${out}.part.wav`, out);
  return out;
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
async function elevenSpeak(fetchImpl, key, outDir, { voiceId, text, model = 'eleven_multilingual_v2', stability = 0.5, similarity = 0.75, speed = 1 }) {
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
  if (buf.length < 500) throw new Error('ElevenLabs sent no audio.');
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}

module.exports = { PIPER_VOICES, piperStatus, piperPrepare, piperSpeak, elevenVoices, elevenUsage, elevenSpeak, voiceUrl };
