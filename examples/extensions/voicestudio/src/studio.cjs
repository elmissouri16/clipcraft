// Optional VoiceStudio connector, implemented entirely in this extension.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkAbort, abortError } = {checkAbort(signal){if(signal?.aborted)throw Object.assign(Error('Canceled'),{name:'AbortError'});},abortError(){return Object.assign(Error('Canceled'),{name:'AbortError'});}};

// ---- VoiceStudio
const STUDIO_URL = 'http://127.0.0.1:3900';
const STUDIO_MAX_TEXT = 4096; // its speech API's limit per request
const STUDIO_NOT_RUNNING = 'VoiceStudio is not running. Open VoiceStudio, then try again.';
const STUDIO_NO_API = 'This VoiceStudio version has no speech API. Update VoiceStudio.';

// The service root for a saved address: host:port, with or without http://, a trailing slash or /v1.
function studioUrl(value) {
  const s = String(value || '').trim() || STUDIO_URL;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('Enter the VoiceStudio address as host:port, for example 127.0.0.1:3900.');
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
}

// fetch against VoiceStudio: the caller's signal plus an optional time limit; a refused connection reads as
// "not running" rather than a bare network error.
async function studioFetch(fetchImpl, url, init = {}, { signal, timeout } = {}) {
  checkAbort(signal);
  const limit = timeout ? AbortSignal.timeout(timeout) : null;
  const s = signal && limit ? AbortSignal.any([signal, limit]) : signal || limit || undefined;
  try {
    return await fetchImpl(url, { ...init, ...(s ? { signal: s } : {}) });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (limit?.aborted || e?.name === 'TimeoutError') throw new Error('VoiceStudio did not answer in time.');
    throw new Error(STUDIO_NOT_RUNNING);
  }
}

const studioDetail = async (res) => {
  try { const d = await res.json(); const m = d?.detail?.message || d?.detail || d?.error?.message || d?.error || d?.message; return typeof m === 'string' ? m.slice(0, 300) : ''; }
  catch { return ''; }
};
async function studioError(res) {
  const msg = await studioDetail(res);
  if (res.status === 404) return new Error(STUDIO_NO_API);
  if (res.status === 401 || res.status === 403) return new Error('VoiceStudio refused the request: it asks for an API key on this address. Connect over 127.0.0.1, which needs none.');
  if (res.status === 409) return new Error(`VoiceStudio has several voices with that name${msg ? ` (${msg})` : ''}. Choose the voice by its id.`);
  if (res.status === 422) return new Error(`VoiceStudio rejected the request${msg ? `: ${msg}` : ''}.`);
  return new Error(`VoiceStudio could not speak (HTTP ${res.status})${msg ? `: ${msg}` : ''}. Check its engine in VoiceStudio.`);
}

// The voices VoiceStudio lists, as ClipCraft offers them: one "Default voice" for the active engine (VoiceStudio
// maps the OpenAI voice names to it) first, so a VoiceStudio with no profile yet still speaks; then its own
// profiles and presets by id; then one "Describe a voice" entry per voice-design engine (Qwen3-TTS), which speaks
// through that engine with the style text as the voice description. Each entry carries what the speech request
// needs: `wire` (the voice id VoiceStudio takes) and `engine` ('' for the active one).
function studioVoices(d, engines = []) {
  const list = Array.isArray(d) ? d : Array.isArray(d?.voices) ? d.voices : Array.isArray(d?.data) ? d.data : [];
  const idOf = (v) => String(v?.voice_id || v?.id || '').trim();
  const own = list.filter((v) => idOf(v) && v.type !== 'openai_alias').map((v) => ({
    id: idOf(v), wire: idOf(v), engine: '', name: String(v.name || idOf(v)).trim().slice(0, 80), language: String(v.language || '').slice(0, 40), kind: String(v.type || 'profile') }));
  const alias = list.find((v) => v?.type === 'openai_alias' && idOf(v));
  const dflt = alias ? [{ id: idOf(alias), wire: idOf(alias), engine: '', name: 'Default voice', language: '', kind: 'default' }] : [];
  // "Qwen3-TTS 1.7B 4bit (voice design, mlx-audio)" -> "Qwen3-TTS"
  const short = (label) => String(label || '').replace(/\s*\(.*$/, '').split(/\s+(?=\d)/)[0].trim().slice(0, 40);
  const design = alias ? engines.filter((e) => e?.design && e.id).map((e) => {
    const model = short(e.models?.[0]) || e.name;
    return { id: `design:${e.id}`, wire: idOf(alias), engine: e.id, name: `Describe a voice (${model})`, language: '', kind: 'design', model };
  }) : [];
  return [...dflt, ...own, ...design].slice(0, 200);
}

// The engines VoiceStudio can speak with right now, from its backend list and installed models: id (what the
// speech request's `model` takes), name, whether it is the active one, cloning and emotion flags, the installed
// model labels, and `design` when the model builds the voice from a written description (Qwen3-TTS VoiceDesign),
// which then needs the style text.
function studioEngines(backends, models, active) {
  const list = Array.isArray(backends) ? backends : [];
  const labels = (id) => (Array.isArray(models) ? models : []).filter((m) => m?.installed && Array.isArray(m.engines) && m.engines.includes(id)).map((m) => String(m.label || m.repo_id || '').slice(0, 80)).filter(Boolean);
  return list.filter((b) => b?.id && b.available).map((b) => {
    const ms = labels(b.id);
    return { id: String(b.id).slice(0, 60), name: String(b.display_name || b.id).slice(0, 80), active: b.id === active, cloning: b.supports_cloning === true, emotion: b.supports_emotion === true,
      models: ms.slice(0, 5), design: ms.some((l) => /voice ?design/i.test(l)) };
  }).slice(0, 30);
}

// Whether VoiceStudio answers at the address, with its version, the active engine, the engines and the voices.
// Never throws: { url, running, version, engine, engines, voices, error? }.
async function studioStatus(fetchImpl, base, { signal } = {}) {
  let url;
  try { url = studioUrl(base); } catch (e) { return { url: String(base || ''), running: false, version: '', engine: '', engines: [], voices: [], error: e.message }; }
  const out = { url, running: false, version: '', engine: '', activeEngine: '', engines: [], voices: [] };
  try {
    const res = await studioFetch(fetchImpl, `${url}/.well-known/voicestudio-speech`, { headers: { Accept: 'application/json' } }, { signal, timeout: 4000 });
    if (!res.ok) return { ...out, error: `Nothing that looks like VoiceStudio answers at ${url} (HTTP ${res.status}).` };
    let d = null;
    try { d = await res.json(); } catch { d = null; }
    if (d?.service !== 'VoiceStudio') return { ...out, error: `The service at ${url} is not VoiceStudio.` };
    out.version = String(d.service_version || '').slice(0, 20);
    const vres = await studioFetch(fetchImpl, `${url}/v1/audio/voices`, { headers: { Accept: 'application/json' } }, { signal, timeout: 20000 });
    if (vres.status === 404) return { ...out, error: STUDIO_NO_API };
    if (!vres.ok) return { ...out, error: `VoiceStudio could not list its voices (HTTP ${vres.status}).` };
    const listed = await vres.json();
    out.running = true;
    // The engines: VoiceStudio's active one (used when a voice names none) and the voice-design ones, which become
    // "Describe a voice" entries. Best effort: without them speech still works through the active engine.
    try {
      const [eres, mres] = await Promise.all([
        studioFetch(fetchImpl, `${url}/engines/tts`, { headers: { Accept: 'application/json' } }, { signal, timeout: 4000 }),
        studioFetch(fetchImpl, `${url}/models`, { headers: { Accept: 'application/json' } }, { signal, timeout: 4000 }).catch(() => null)]);
      if (eres.ok) {
        const e = await eres.json();
        const models = mres?.ok ? await mres.json().catch(() => null) : null;
        out.engines = studioEngines(e?.backends, Array.isArray(models) ? models : models?.models, e?.active);
        const b = (e?.backends || []).find((x) => x?.id === e?.active);
        out.engine = String(b?.display_name || e?.active || '').slice(0, 80);
        out.activeEngine = String(e?.active || '').slice(0, 60);
      }
    } catch (e) { if (e?.name === 'AbortError') throw e; }
    const pres = await studioFetch(fetchImpl, `${url}/profiles`, { headers: { Accept: 'application/json' } }, { signal, timeout: 20000 });
    if (!pres.ok) throw new Error(`VoiceStudio could not list its profiles (HTTP ${pres.status}).`);
    const profiles = await pres.json();
    if (!Array.isArray(profiles)) throw new Error('VoiceStudio returned an invalid profile list.');
    out.voices = studioVoices(listed, out.engines).map(voice => {
      const profile = profiles.find(p => p.id === voice.id);
      return {...voice, ...(profile ? {kind: profile.kind, needsTranscript: profile.kind === 'clone' && !String(profile.ref_text || '').trim()} : {})};
    });
    return out;
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return { ...out, running: false, error: e.message };
  }
}

// OmniVoice uses attribute tags, not arbitrary delivery prose. Let VoiceStudio's
// own description API resolve those tags; never drop unrecognized requirements.
async function studioStyle(fetchImpl, base, style, {engine, signal} = {}) {
  if (style === undefined || style === '') return '';
  if (typeof style !== 'string' || style.length > 1000) throw new Error('Use a speech style of at most 1000 characters.');
  const clean = style.trim();
  if (!clean || engine !== 'omnivoice') return clean;
  const res = await studioFetch(fetchImpl, `${studioUrl(base)}/design/describe`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({description:clean}), redirect:'manual',
  }, {signal, timeout:20000});
  if (!res.ok) throw new Error(`VoiceStudio could not check the voice attributes (HTTP ${res.status}).`);
  const value = await res.json();
  if (!value || typeof value.instruct !== 'string' || !Array.isArray(value.unmatched)) throw new Error('VoiceStudio returned invalid voice attributes.');
  if (!value.instruct.trim() || value.unmatched.length) throw new Error('OmniVoice does not support this delivery style. Use supported speaker attributes (gender, age, pitch, accent or whisper), or omit style to preserve the saved voice. No speech was requested.');
  return value.instruct;
}

// Speaks `text` into a new WAV file in outDir. Profiles are mutable, so a later
// request must use their current reference transcript and speaker settings.
// voiceId is the entry's
// `wire` from studioStatus (VoiceStudio speaks with its default voice for an id it does not know, so the caller
// resolves the entry first); model is the entry's `engine`, '' for VoiceStudio's active engine ('tts-1').
async function studioSpeak(fetchImpl, base, outDir, { voiceId, text, speed = 1, style = '', model = '', signal }) {
  checkAbort(signal);
  const url = studioUrl(base);
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Type some text first.');
  if (clean.length > STUDIO_MAX_TEXT) throw new Error(`VoiceStudio speaks up to ${STUDIO_MAX_TEXT} characters at a time. Shorten the text or split it.`);
  const voice = String(voiceId || '').trim();
  if (!/^[\w.:@ -]{1,120}$/.test(voice)) throw new Error('Pick a VoiceStudio voice first.');
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < .25 || speed > 4) throw new Error('VoiceStudio speed must be from 0.25 to 4.');
  const rate = speed;
  if (typeof style !== 'string' || style.length > 1000) throw new Error('Use a speech style of at most 1000 characters.');
  const instruct = style.trim();
  const engine = String(model || '').trim();
  if (engine && !/^[\w.-]{1,60}$/.test(engine)) throw new Error('Pick a VoiceStudio engine from its list.');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `voicestudio-${crypto.randomUUID()}.wav`);
  const res = await studioFetch(fetchImpl, `${url}/v1/audio/speech`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify({ model: engine || 'tts-1', input: clean, voice, response_format: 'wav', speed: rate, ...(instruct ? { instruct } : {}) }),
  }, { signal });
  if (!res.ok) throw await studioError(res);
  const buf = Buffer.from(await res.arrayBuffer());
  checkAbort(signal);
  if (buf.length < 100 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('VoiceStudio sent no audio. Check its engine in VoiceStudio.');
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  return out;
}


module.exports={STUDIO_URL,STUDIO_MAX_TEXT,STUDIO_NOT_RUNNING,studioUrl,studioVoices,studioEngines,studioStatus,studioStyle,studioSpeak};
