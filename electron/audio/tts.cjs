// Built-in ElevenLabs transport. Optional integrations run in Node extensions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkAbort}=require('../system/cancel.cjs');
const keyOf=(...parts)=>crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0,16);
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

module.exports={elevenVoices,elevenUsage,elevenSpeak};
