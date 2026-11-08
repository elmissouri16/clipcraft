// Gemini 3.8 TTS uses the Interactions API, not legacy generateContent.
// https://ai.google.dev/gemini-api/docs/speech-generation
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { checkAbort, abortError } = require("../system/cancel.cjs");
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

// Google's 429 is a request-rate limit per model and API tier (requests per minute or per day), not
// the spend cap. Its body names the quota that ran out and how long to wait; only those fields are
// read, never the raw provider message.
async function rateLimit(res) {
  let body = null;
  try { body = await res.json(); } catch {}
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const violation = details.flatMap((d) => Array.isArray(d?.violations) ? d.violations : []).find((v) => v && (v.quotaId || v.quotaMetric)) || {};
  const quotaId = String(violation.quotaId || violation.quotaMetric || '').replace(/[^\w./-]/g, '').slice(0, 120);
  const limit = Number(violation.quotaValue) > 0 ? Math.round(Number(violation.quotaValue)) : null;
  const delay = details.map((d) => /^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay || ''))).find(Boolean)
    || /retry in (\d+(?:\.\d+)?)\s*s/i.exec(String(body?.error?.message || ''));
  const header = Number(res.headers?.get?.('retry-after'));
  const retrySec = delay ? Number(delay[1]) : Number.isFinite(header) && header > 0 ? header : null;
  const period = /PerDay/i.test(quotaId) ? 'day' : /PerMinute/i.test(quotaId) ? 'minute' : null;
  return { period, limit, retrySec };
}

const SEPARATE = 'Google limits requests per model separately from your spend cap.';
// The error carries `limit` so CraftAI can act on it (switch model, stop retrying, tell the user).
function rateLimitError({ period, limit }, model) {
  const name = MODELS.find((m) => m.id === model)?.name || 'this Gemini TTS model';
  const other = MODELS.find((m) => m.id !== model);
  const info = { provider: 'gemini', kind: period === 'day' ? 'daily' : period === 'minute' ? 'per_minute' : 'unknown', model: model || null,
    ...(limit ? { requests_allowed: limit } : {}), ...(period === 'day' ? { resets: 'midnight Pacific time', ...(other ? { other_model: other.id } : {}) } : {}) };
  const tag = (message) => Object.assign(new Error(message), { limit: info });
  if (period === 'day') return tag(`Gemini TTS daily request limit reached for ${name}${limit ? ` (${limit} requests a day on your API tier)` : ''}. ${SEPARATE} It resets at midnight Pacific time${other ? `; ${other.name} has its own limit` : ''}.`);
  if (period === 'minute') return tag(`Gemini TTS is still over its per-minute request limit for ${name}${limit ? ` (${limit} a minute on your API tier)` : ''} after waiting. ${SEPARATE} Try again in a minute.`);
  return tag(`Gemini TTS request limit reached for ${name}. ${SEPARATE} Try again in a minute, or check the rate limits for your tier in Google AI Studio.`);
}

// A model out of daily requests stays out until midnight Pacific time: later requests fail at once
// instead of spending a network round trip each. Remembered per key, in memory only.
const exhausted = new Map();
const keyTag = (key, model) => `${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12)}:${model}`;
function nextPacificMidnight(now = Date.now()) {
  const part = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now).map((p) => [p.type, Number(p.value)]));
  return now + (86400 - ((part.hour % 24) * 3600 + part.minute * 60 + part.second)) * 1000;
}

async function apiError(res) {
  // Never expose request headers or untrusted provider error bodies with a key.
  if (res.status === 400 || res.status === 401 || res.status === 403) return new Error('Gemini TTS refused the request. Check the API key, API access and billing in Google AI Studio.');
  if (res.status === 404) return new Error('This Gemini TTS model is not available for your API key. Check model access in Google AI Studio.');
  return new Error(`Gemini TTS request failed (HTTP ${res.status}). Try again later.`);
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(abortError()); };
  signal?.addEventListener?.('abort', stop, { once: true });
});
// How long to wait for a per-minute limit before giving up, and how many times.
const MAX_WAIT_SEC = 65, RATE_RETRIES = 3;
let sleep = wait;

async function request(fetchImpl, key, endpoint, { model, onWait, ...options } = {}) {
  if (!key) throw new Error('Add your Gemini TTS API key in Settings > Speech generation.');
  let serverRetry = true, rateRetries = 0;
  for (;;) {
    let res;
    try {
      res = await fetchImpl(`${BASE}/${endpoint}`, { ...options,
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Gemini TTS timed out. Try a shorter passage.');
      throw new Error('Could not connect to Gemini TTS. Check your internet connection.');
    }
    if (res.ok) return res;
    if (res.status >= 500 && serverRetry) { serverRetry = false; await res.body?.cancel?.(); continue; }
    if (res.status === 429) {
      const limit = await rateLimit(res);
      // A per-minute limit clears by itself: wait as long as Google says, then try again.
      if (limit.period !== 'day' && limit.retrySec != null && limit.retrySec <= MAX_WAIT_SEC && rateRetries < RATE_RETRIES) {
        rateRetries++; onWait?.(limit.retrySec); await sleep(Math.ceil(limit.retrySec * 1000) + 250, options.signal); continue;
      }
      const error = rateLimitError(limit, model);
      if (limit.period === 'day' && model) exhausted.set(keyTag(key, model), { until: nextPacificMidnight(), error });
      throw error;
    }
    throw await apiError(res);
  }
}

// One speech request at a time: a narration of many lines queues instead of bursting past the
// per-minute request limit.
let queue = Promise.resolve();
function queued(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
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
async function speak(fetchImpl, key, outDir, { text, voiceId = DEFAULT_VOICE, model = DEFAULT_MODEL, style = '', speed = 1, signal, onWait } = {}) {
  checkAbort(signal);
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
  const spent = exhausted.get(keyTag(key, model));
  if (spent && spent.until > Date.now()) throw Object.assign(new Error(spent.error.message), { limit: spent.error.limit });
  if (!signal && pending.has(out)) return pending.get(out);
  const task = (async () => {
    const part = { type: 'text', text: transcript, ...(delivery ? { annotations: [{ type: 'speech_metadata', style: delivery }] } : {}) };
    const res = await queued(() => { checkAbort(signal); return request(fetchImpl, key, 'interactions', { signal, model, onWait, method: 'POST', body: JSON.stringify({
      model, store: false, input: [{ type: 'user_input', content: [part] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: voiceId }] },
    }) }); });
    let result;
    try { result = await res.json(); } catch { throw new Error('Gemini TTS returned an invalid response.'); }
    if (result.status && result.status !== 'completed') throw new Error('Gemini TTS did not complete the speech. Try a shorter passage or different delivery instructions.');
    const audio = (result.steps || []).filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content || []).filter((c) => c.type === 'audio').at(-1);
    if (!audio?.data || (audio.mime_type && audio.mime_type !== 'audio/wav')) throw new Error('Gemini TTS returned no WAV audio. Try a shorter passage or different delivery instructions.');
    const buf = Buffer.from(audio.data, 'base64');
    validateWav(buf);
    checkAbort(signal);
    fs.mkdirSync(outDir, { recursive: true });
    const tmp = `${out}.${crypto.randomUUID()}.part`;
    try { fs.writeFileSync(tmp, buf); fs.renameSync(tmp, out); }
    finally { fs.rmSync(tmp, { force: true }); }
    return out;
  })();
  if (!signal) pending.set(out, task);
  try { return await task; } finally { if (pending.get(out) === task) pending.delete(out); }
}

module.exports = { catalog, speak, testKey, validateWav, DEFAULT_MODEL, DEFAULT_VOICE, MAX_TEXT, _setSleep: (fn) => { sleep = fn || wait; }, _resetLimits: () => exhausted.clear(), nextPacificMidnight };
