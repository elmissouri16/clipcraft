// Gemini 3.8 TTS uses the Interactions API, not legacy generateContent.
// https://ai.google.dev/gemini-api/docs/speech-generation
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELS = [
  { id: 'gemini-3.8-flash-tts', name: 'Gemini 3.8 Flash TTS' },
  { id: 'gemini-3.8-flash-lite-tts', name: 'Gemini 3.8 Flash-Lite TTS' },
];
const VOICES = [
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'],
  ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'],
  ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'],
  ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'],
  ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
  ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'],
  ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'],
  ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
].map(([id, style]) => ({ id, name: id, style }));
const DEFAULT_MODEL = MODELS[0].id;
const DEFAULT_VOICE = 'Kore';
const MAX_TEXT = 5000;
const catalog = () => ({ models: MODELS, voices: VOICES, defaultModel: DEFAULT_MODEL, defaultVoice: DEFAULT_VOICE, maxTextLength: MAX_TEXT });

async function apiError(res) {
  // Never expose request headers or untrusted provider error bodies with a key.
  if (res.status === 400 || res.status === 401 || res.status === 403) return new Error('Gemini TTS refused the request. Check the API key, API access and billing in Google AI Studio.');
  if (res.status === 404) return new Error('This Gemini TTS model is not available for your API key. Check model access in Google AI Studio.');
  if (res.status === 429) return new Error('Gemini TTS quota or rate limit reached. Check your Google AI Studio quota, or try again later.');
  return new Error(`Gemini TTS request failed (HTTP ${res.status}). Try again later.`);
}

async function request(fetchImpl, key, endpoint, options = {}) {
  if (!key) throw new Error('Add your Gemini TTS API key in Settings > Speech generation.');
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${BASE}/${endpoint}`, { ...options,
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000) });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Gemini TTS timed out. Try a shorter passage.');
      throw new Error('Could not connect to Gemini TTS. Check your internet connection.');
    }
    if (res.ok) return res;
    if (res.status >= 500 && attempt === 0) { await res.body?.cancel?.(); continue; }
    throw await apiError(res);
  }
}

async function testKey(fetchImpl, key) {
  await request(fetchImpl, key, `models/${DEFAULT_MODEL}`);
  return { ok: true, text: 'Gemini TTS model access confirmed. Generate a preview to test speech.' };
}

function validateWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE'
    || buf.readUInt32LE(4) + 8 !== buf.length) throw new Error('Gemini TTS returned invalid or incomplete WAV audio.');
  let format = false, data = false;
  for (let offset = 12; offset + 8 <= buf.length;) {
    const kind = buf.toString('ascii', offset, offset + 4), size = buf.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > buf.length) throw new Error('Gemini TTS returned incomplete WAV audio.');
    if (kind === 'fmt ') {
      format = size >= 16 && buf.readUInt16LE(start) === 1 && buf.readUInt16LE(start + 2) === 1
        && buf.readUInt32LE(start + 4) === 24000 && buf.readUInt16LE(start + 14) === 16;
    }
    if (kind === 'data') data = size > 0 && size % 2 === 0;
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw new Error('Gemini TTS returned empty or unsupported audio. Expected 24 kHz mono WAV.');
}

const pending = new Map();
async function speak(fetchImpl, key, outDir, { text, voiceId = DEFAULT_VOICE, model = DEFAULT_MODEL, style = '', speed = 1 } = {}) {
  if (!key) throw new Error('Add your Gemini TTS API key in Settings > Speech generation.');
  const transcript = String(text || '').trim(), delivery = String(style || '').trim();
  if (!transcript) throw new Error('Type some text first.');
  if (transcript.length > MAX_TEXT) throw new Error(`Keep each speech passage to ${MAX_TEXT} characters or fewer. Split longer narration into separate clips.`);
  if (delivery.length > 1000) throw new Error('Keep delivery instructions to 1000 characters or fewer.');
  if (!MODELS.some((m) => m.id === model)) throw new Error('Choose a supported Gemini TTS model.');
  if (!VOICES.some((v) => v.id === voiceId)) throw new Error('Choose a Gemini TTS voice from list_voices.');
  if (Number(speed) !== 1) throw new Error('For Gemini TTS, describe pacing in style instead of setting speed.');
  const hash = crypto.createHash('sha256').update(JSON.stringify([model, voiceId, delivery, transcript])).digest('hex').slice(0, 24);
  const out = path.join(outDir, `gemini-${hash}.wav`);
  if (fs.existsSync(out)) { validateWav(fs.readFileSync(out)); return out; }
  if (pending.has(out)) return pending.get(out);
  const task = (async () => {
    const part = { type: 'text', text: transcript, ...(delivery ? { annotations: [{ type: 'speech_metadata', style: delivery }] } : {}) };
    const res = await request(fetchImpl, key, 'interactions', { method: 'POST', body: JSON.stringify({
      model, store: false, input: [{ type: 'user_input', content: [part] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: voiceId }] },
    }) });
    let result;
    try { result = await res.json(); } catch { throw new Error('Gemini TTS returned an invalid response.'); }
    if (result.status && result.status !== 'completed') throw new Error('Gemini TTS did not complete the speech. Try a shorter passage or different delivery instructions.');
    const audio = (result.steps || []).filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content || []).filter((c) => c.type === 'audio').at(-1);
    if (!audio?.data || (audio.mime_type && audio.mime_type !== 'audio/wav')) throw new Error('Gemini TTS returned no WAV audio. Try a shorter passage or different delivery instructions.');
    const buf = Buffer.from(audio.data, 'base64');
    validateWav(buf);
    fs.mkdirSync(outDir, { recursive: true });
    const tmp = `${out}.${crypto.randomUUID()}.part`;
    try { fs.writeFileSync(tmp, buf); fs.renameSync(tmp, out); }
    finally { fs.rmSync(tmp, { force: true }); }
    return out;
  })();
  pending.set(out, task);
  try { return await task; } finally { pending.delete(out); }
}

module.exports = { catalog, speak, testKey, validateWav, DEFAULT_MODEL, DEFAULT_VOICE };
