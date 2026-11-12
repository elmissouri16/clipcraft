// Text to speech: ElevenLabs calls against a fake fetch (key never in errors); the VoiceStudio connector against a
// stand-in shaped like VoiceStudio 0.5.5 (discovery, voices, engine, speech, its errors, cancellation); and with
// --real, the VoiceStudio running on this computer.
// Usage: node tests/unit/audio/test-tts.cjs [--real]
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tts = require("../../../electron/audio/tts.cjs");
const { probe } = require("../../../electron/media/ffmpeg.cjs");

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-tts-'));
  const KEY = 'el-test-key-1234';
  const calls = [];
  const fake = async (url, opts = {}) => {
    calls.push([url, opts]);
    const ok = opts.headers && opts.headers['xi-api-key'] === KEY;
    if (!ok) return { ok: false, status: 401, json: async () => ({ detail: { status: 'invalid_api_key' } }) };
    if (url.endsWith('/user/subscription')) return { ok: true, status: 200, json: async () => ({ tier: 'free', character_count: 1298, character_limit: 10000, next_character_count_reset_unix: 1793750400 }) };
    if (url.endsWith('/voices')) return { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: 'abcDEF12345678', name: 'Rachel', labels: { gender: 'female', accent: 'american' }, category: 'premade' }] }) };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(4000).buffer };
  };
  const voices = await tts.elevenVoices(fake, KEY);
  assert.deepEqual(voices.map((v) => [v.id, v.name, v.gender]), [['abcDEF12345678', 'Rachel', 'female']]);
  assert.deepEqual(await tts.elevenUsage(fake, KEY), { used: 1298, limit: 10000, left: 8702, tier: 'free', resetsAt: 1793750400000 });
  await assert.rejects(tts.elevenUsage(fake, 'wrong-key-9999'), (e) => /refused the API key/.test(e.message) && !e.message.includes('wrong-key'));
  const mp3 = await tts.elevenSpeak(fake, KEY, out, { voiceId: 'abcDEF12345678', text: 'Salam' });
  const body = JSON.parse(calls[calls.length - 1][1].body);
  assert.equal(body.model_id, 'eleven_multilingual_v2');
  assert.ok(calls[calls.length - 1][0].includes('/text-to-speech/abcDEF12345678'));
  assert.ok(fs.statSync(mp3).size === 4000);
  const n = calls.length;
  await tts.elevenSpeak(fake, KEY, out, { voiceId: 'abcDEF12345678', text: 'Salam' });
  assert.equal(calls.length, n, 'same text again comes from the cache');
  await assert.rejects(tts.elevenVoices(fake, 'wrong-key-9999'), (e) => /refused the API key/.test(e.message) && !e.message.includes('wrong-key'));
  await assert.rejects(tts.elevenSpeak(fake, KEY, out, { voiceId: '../x', text: 'a' }), /Pick a voice/);
  await assert.rejects(tts.elevenSpeak(fake, '', out, { voiceId: 'abcDEF12345678', text: 'a' }), /Add your ElevenLabs API key/);
  console.log('elevenlabs ok');

  // VoiceStudio: a separate app reached over its local API; ClipCraft downloads and starts nothing.
  assert.equal(tts.studioUrl(''), 'http://127.0.0.1:3900');
  assert.equal(tts.studioUrl('localhost:4000/'), 'http://localhost:4000');
  assert.equal(tts.studioUrl('http://10.0.0.5:3900/v1'), 'http://10.0.0.5:3900', 'the OpenAI base URL form is accepted');
  assert.throws(() => tts.studioUrl('ftp://x'), /host:port/);
  // Nothing listening: not running, with a plain reason, and nothing spoken.
  const down = async () => { throw new TypeError('fetch failed'); };
  let st = await tts.studioStatus(down, '');
  assert.deepEqual([st.running, st.voices, st.error], [false, [], tts.STUDIO_NOT_RUNNING]);
  await assert.rejects(tts.studioSpeak(down, '', out, { voiceId: 'alloy', text: 'Hi' }), /not running/);
  // A VoiceStudio answering, shaped like 0.5.5: the discovery document, the voices (the OpenAI aliases collapsed
  // into one default voice, profiles kept), the active engine, and WAV speech.
  const wavOf = (n) => { const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; };
  const studioCalls = [];
  const studio = (over = {}) => async (url, opts = {}) => {
    studioCalls.push([url, opts]);
    const p = new URL(url).pathname;
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer });
    if (p === '/.well-known/voicestudio-speech') return json(200, over.service || { schema: 'voicestudio.speech-capabilities', service: 'VoiceStudio', service_version: '0.5.5' });
    if (p === '/v1/audio/voices') return over.voices ? over.voices() : json(200, { voices: [{ voice_id: 'alloy', name: 'Alloy', type: 'openai_alias' }, { voice_id: 'echo', name: 'Echo', type: 'openai_alias' }, { voice_id: 'demo0001', name: 'VoiceStudio Demo Voice', type: 'profile', language: 'English' }], engines: [] });
    if (p === '/engines/tts') return json(200, { active: 'omnivoice', backends: [{ id: 'omnivoice', display_name: 'VoiceStudio (k2-fsa/OmniVoice, 600+ languages)', available: true, supports_cloning: true, supports_emotion: false },
      { id: 'mlx-audio', display_name: 'MLX-Audio (mac-ARM)', available: true, supports_emotion: false }, { id: 'kittentts', display_name: 'KittenTTS', available: true }, { id: 'cosyvoice', display_name: 'CosyVoice 3', available: false, supports_emotion: true }] });
    if (p === '/models') return json(200, [{ repo_id: 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit', label: 'Qwen3-TTS 1.7B 4bit (voice design, mlx-audio)', engines: ['mlx-audio'], installed: true }, { repo_id: 'x/cosy', label: 'CosyVoice 3', engines: ['cosyvoice'], installed: false }]);
    if (p === '/v1/audio/speech') { const body = JSON.parse(opts.body); if (over.speech) return over.speech(body); const b = wavOf(2400); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
    return json(404, { detail: 'Not Found' });
  };
  st = await tts.studioStatus(studio(), '127.0.0.1:3900');
  assert.equal(st.running, true); assert.equal(st.version, '0.5.5'); assert.match(st.engine, /OmniVoice/);
  assert.deepEqual(st.engines.map((e) => [e.id, e.active, e.design, e.models[0] || null]), [['omnivoice', true, false, null], ['mlx-audio', false, true, 'Qwen3-TTS 1.7B 4bit (voice design, mlx-audio)'], ['kittentts', false, false, null]], 'available engines only, with the voice-design flag from the installed model');
  assert.deepEqual(st.voices.map((v) => [v.id, v.name, v.kind, v.wire, v.engine]), [['alloy', 'Default voice', 'default', 'alloy', ''], ['demo0001', 'VoiceStudio Demo Voice', 'profile', 'demo0001', ''], ['design:mlx-audio', 'Describe a voice (Qwen3-TTS)', 'design', 'alloy', 'mlx-audio']],
    'the default voice first, then profiles, then one "Describe a voice" entry per voice-design engine, each carrying what the request needs');
  assert.equal(st.activeEngine, 'omnivoice');
  const spoken = await tts.studioSpeak(studio(), '', out, { voiceId: 'demo0001', text: 'Salam', speed: 3, style: 'calm' });
  const [speakUrl, speakOpts] = studioCalls.at(-1);
  assert.ok(speakUrl.endsWith('/v1/audio/speech') && speakOpts.method === 'POST');
  assert.deepEqual(JSON.parse(speakOpts.body), { model: 'tts-1', input: 'Salam', voice: 'demo0001', response_format: 'wav', speed: 2, instruct: 'calm' }, 'speed is kept within 0.5–2; no engine means the active one');
  await tts.studioSpeak(studio(), '', out, { voiceId: 'alloy', text: 'Salam', model: 'mlx-audio', style: 'a sad woman, speaking slowly' });
  assert.equal(JSON.parse(studioCalls.at(-1)[1].body).model, 'mlx-audio', 'a chosen engine goes in model');
  await assert.rejects(tts.studioSpeak(studio(), '', out, { voiceId: 'alloy', text: 'x', model: 'bad engine!' }), /Pick a VoiceStudio engine/);
  assert.ok(fs.readFileSync(spoken).toString('ascii', 0, 4) === 'RIFF' && spoken.endsWith('.wav'));
  const before = studioCalls.length;
  await tts.studioSpeak(studio(), '', out, { voiceId: 'demo0001', text: 'Salam', speed: 3, style: 'calm' });
  assert.equal(studioCalls.length, before, 'same text again comes from the cache');
  await assert.rejects(tts.studioSpeak(studio(), '', out, { voiceId: 'demo0001', text: 'x'.repeat(4097) }), /4096 characters/);
  await assert.rejects(tts.studioSpeak(studio(), '', out, { voiceId: 'demo0001', text: '  ' }), /Type some text/);
  await assert.rejects(tts.studioSpeak(studio(), '', out, { voiceId: '../x', text: 'a' }), /Pick a VoiceStudio voice/);
  const asJson = (status, body) => ({ ok: false, status, json: async () => body });
  await assert.rejects(tts.studioSpeak(studio({ speech: () => asJson(422, { detail: 'input too long' }) }), '', out, { voiceId: 'demo0001', text: 'bad request' }), /rejected the request: input too long/);
  await assert.rejects(tts.studioSpeak(studio({ speech: () => asJson(404, { detail: 'Not Found' }) }), '', out, { voiceId: 'demo0001', text: 'old version' }), /no speech API/);
  await assert.rejects(tts.studioSpeak(studio({ speech: () => asJson(500, { detail: 'omnivoice sidecar synthesize error' }) }), '', out, { voiceId: 'demo0001', text: 'engine down' }), /could not speak \(HTTP 500\): omnivoice sidecar/);
  await assert.rejects(tts.studioSpeak(studio({ speech: () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('{"detail":"oops"}').buffer }) }), '', out, { voiceId: 'demo0001', text: 'not audio' }), /sent no audio/);
  st = await tts.studioStatus(studio({ voices: () => asJson(404, { detail: 'Not Found' }) }), '');
  assert.deepEqual([st.running, st.error], [false, 'This VoiceStudio version has no speech API. Update VoiceStudio.']);
  st = await tts.studioStatus(studio({ service: { service: 'Something else' } }), '');
  assert.deepEqual([st.running, st.error], [false, 'The service at http://127.0.0.1:3900 is not VoiceStudio.']);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(tts.studioSpeak(studio(), '', out, { voiceId: 'demo0001', text: 'never sent', signal: stopped.signal }), (e) => e.name === 'AbortError');
  console.log('voicestudio (stand-in) ok');

  // --real: the VoiceStudio running on this computer, if any. Its first request loads a model (minutes), so it
  // stays out of the ordinary battery.
  if (process.argv.includes('--real')) {
    const real = await tts.studioStatus(fetch, '');
    if (!real.running) console.log(`voicestudio real: skipped (${real.error})`);
    else {
      const w = await tts.studioSpeak(fetch, '', out, { voiceId: real.voices[0].id, text: 'Hello from ClipCraft. This voice runs on your computer.' });
      const info = await probe(w);
      console.log(`voicestudio ${real.version} (${real.engine}), voice ${real.voices[0].id}: ${info.duration.toFixed(2)} s`);
      assert.ok(info.type === 'audio' && info.duration > 1);
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
  console.log('TTS OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
