// Cloud caption engines (item O): real transcription APIs behind one interface, used only
// when the user picks "Cloud — your API key" in the Captions panel and has saved a key.
//   transcribeCloud({ provider, key, model, audioPath, language, fetchImpl })
//     → { segments: [{ start, end, text }] }   (seconds, relative to the file)
// Long audio is prepared as 16 kHz mono 32 kbps mp3 and split under the providers' 25 MB
// upload cap; chunk results are merged with their true (probed) offsets. No Gemini:
// prompt-based timestamps are not reliable enough to print as captions.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PROVIDERS = {
  groq: { name: 'Groq', defaultModel: 'whisper-large-v3-turbo', service: 'cap-groq' },
  openai: { name: 'OpenAI', defaultModel: 'whisper-1', service: 'cap-openai' },
  deepgram: { name: 'Deepgram', defaultModel: 'nova-3', service: 'cap-deepgram' },
  elevenlabs: { name: 'ElevenLabs', defaultModel: 'scribe_v1', service: 'cap-elevenlabs' },
};
const UPLOAD_CAP = 24 * 1024 * 1024; // stay under the 25 MB endpoint limit
const MP3_BYTES_PER_SEC = 4000; // 32 kbps

const providerOf = (provider) => {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown caption provider: ${provider}`);
  return p;
};

// The provider's own words when a call fails — never a paraphrase.
async function providerError(res, name) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = j?.error?.message || j?.error || j?.message || j?.reason || '';
    } catch { /* not JSON */ }
    if (!detail) detail = body.slice(0, 180);
  } catch { /* unreadable body */ }
  return new Error(`${name} answered ${res.status}${detail ? `: ${detail}` : ''}`);
}

const cleanSegments = (segs) => (segs || [])
  .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text || '').trim() }))
  .filter((s) => s.text && s.end > s.start)
  .sort((a, b) => a.start - b.start);

// Whisper-style verbose_json (Groq + OpenAI share the shape).
const parseWhisperJson = (j) => cleanSegments((j?.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })));

const parseDeepgram = (j) => cleanSegments((j?.results?.utterances || []).map((u) => ({ start: u.start, end: u.end, text: u.transcript })));

// ElevenLabs returns words, not segments: group them into caption-sized segments —
// break on sentence-ending punctuation, on a pause over a second, or at ~8 seconds.
function groupWords(words) {
  const list = (words || []).filter((w) => w && (w.type === 'word' || (!w.type && w.text)) && String(w.text || '').trim());
  const segs = [];
  let cur = null;
  const flush = () => { if (cur && cur.text.trim()) segs.push({ start: cur.start, end: cur.end, text: cur.text.trim() }); cur = null; };
  for (const w of list) {
    const start = Number(w.start) || 0;
    const end = Number(w.end) || start;
    if (cur && (start - cur.end > 1.0 || end - cur.start > 8)) flush();
    if (!cur) cur = { start, end, text: '' };
    cur.text += (cur.text && !cur.text.endsWith(' ') ? ' ' : '') + String(w.text).trim();
    cur.end = end;
    if (/[.!?…。؟]$/.test(String(w.text).trim())) flush();
  }
  flush();
  return cleanSegments(segs);
}
const parseElevenLabs = (j) => (Array.isArray(j?.segments) && j.segments.length
  ? cleanSegments(j.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })))
  : groupWords(j?.words));

async function transcribeCloud({ provider, key, model, audioPath, language, fetchImpl }) {
  const meta = providerOf(provider);
  if (!key) throw new Error(`No ${meta.name} API key saved.`);
  const m = model || meta.defaultModel;
  const bytes = fs.readFileSync(audioPath);
  const lang = language && language !== 'auto' ? language : null;
  const fileName = path.basename(audioPath);
  let res;
  if (provider === 'groq' || provider === 'openai') {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), fileName);
    form.append('model', m);
    form.append('response_format', 'verbose_json');
    if (lang) form.append('language', lang);
    const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
    res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw await providerError(res, meta.name);
    return { segments: parseWhisperJson(await res.json()) };
  }
  if (provider === 'deepgram') {
    const q = new URLSearchParams({ model: m, smart_format: 'true', diarize: 'false' });
    if (lang) q.set('language', lang);
    res = await fetchImpl(`https://api.deepgram.com/v1/listen?${q}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mpeg' },
      body: bytes,
    });
    if (!res.ok) throw await providerError(res, meta.name);
    return { segments: parseDeepgram(await res.json()) };
  }
  // elevenlabs
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), fileName);
  form.append('model_id', m);
  if (lang) form.append('language_code', lang);
  res = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': key }, body: form,
  });
  if (!res.ok) throw await providerError(res, meta.name);
  return { segments: parseElevenLabs(await res.json()) };
}

// The lightest authenticated call per provider (a key check, not a transcription).
async function testConnection({ provider, key, fetchImpl }) {
  const meta = providerOf(provider);
  if (!key) throw new Error(`No ${meta.name} API key to test.`);
  const calls = {
    groq: ['https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${key}` }],
    openai: ['https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }],
    deepgram: ['https://api.deepgram.com/v1/projects', { Authorization: `Token ${key}` }],
    elevenlabs: ['https://api.elevenlabs.io/v1/user', { 'xi-api-key': key }],
  };
  const [url, headers] = calls[provider];
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw await providerError(res, meta.name);
  return { ok: true };
}

// How many seconds of 32 kbps mp3 fit under the cap (bounded to sane chunk lengths).
const planChunkSeconds = (capBytes = UPLOAD_CAP, bytesPerSec = MP3_BYTES_PER_SEC) =>
  Math.min(1800, Math.max(60, Math.floor(capBytes / bytesPerSec)));

// Merge per-chunk segment lists: each chunk's segments shift by the chunk's start offset.
const mergeChunks = (chunkSegs) => cleanSegments(
  chunkSegs.flatMap(({ offset, segments }) => segments.map((s) => ({ start: s.start + offset, end: s.end + offset, text: s.text }))),
);

const run = (ffmpegPath, args) => new Promise((resolve, reject) => {
  execFile(ffmpegPath, args, { windowsHide: true }, (e, _o, stderr) => (e ? reject(new Error(`ffmpeg: ${String(stderr).slice(-300)}`)) : resolve()));
});

// Full pipeline for one rendered timeline WAV: convert to the upload format, split if
// needed, transcribe chunk by chunk (offsets from each chunk's probed duration), merge.
async function transcribePrepared({ provider, key, model, language, wavPath, dir, ffmpegPath, probe, fetchImpl, onProgress, capBytes = UPLOAD_CAP, chunkSeconds }) {
  const mp3 = path.join(dir, 'audio.mp3');
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', wavPath, '-ar', '16000', '-ac', '1', '-b:a', '32k', mp3]);
  const size = fs.statSync(mp3).size;
  if (size <= capBytes) {
    const { segments } = await transcribeCloud({ provider, key, model, audioPath: mp3, language, fetchImpl });
    onProgress?.(1);
    return segments;
  }
  const secs = chunkSeconds || planChunkSeconds(capBytes);
  const chunkDir = path.join(dir, 'chunks');
  fs.mkdirSync(chunkDir, { recursive: true });
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', mp3, '-f', 'segment', '-segment_time', String(secs), '-c', 'copy', path.join(chunkDir, 'chunk%03d.mp3')]);
  const files = fs.readdirSync(chunkDir).filter((f) => /^chunk\d+\.mp3$/.test(f)).sort();
  if (!files.length) throw new Error('Splitting the audio failed.');
  const parts = [];
  let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const file = path.join(chunkDir, files[i]);
    const { segments } = await transcribeCloud({ provider, key, model, audioPath: file, language, fetchImpl });
    parts.push({ offset, segments });
    const info = await probe(file);
    offset += info?.duration || secs;
    onProgress?.((i + 1) / files.length);
  }
  return mergeChunks(parts);
}

module.exports = {
  PROVIDERS, UPLOAD_CAP, transcribeCloud, testConnection, transcribePrepared,
  parseWhisperJson, parseDeepgram, parseElevenLabs, groupWords, mergeChunks, planChunkSeconds,
};
