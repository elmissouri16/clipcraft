// Text to speech: ElevenLabs calls against a fake fetch (key never in errors), and (unless --offline) Piper for
// real: download the engine and a voice once, speak a sentence, check the WAV. Usage: node scripts/test-tts.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tts = require('../electron/tts.cjs');
const { probe } = require('../electron/ffmpeg.cjs');

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

  if (!process.argv.includes('--offline')) {
    const dir = path.join(os.tmpdir(), 'fve-piper-cache'); // kept between runs: the engine and voice are big
    await tts.piperPrepare(fetch, dir, 'en_US-joe-medium', (s, f) => process.stdout.write(`\r${s} ${(f * 100).toFixed(0)}%   `));
    const wav = await tts.piperSpeak(dir, out, { voiceId: 'en_US-joe-medium', text: 'Hello from CapRocket. This voice runs on your computer.' });
    const info = await probe(wav);
    console.log(`\npiper: ${info.duration.toFixed(2)} s`);
    assert.ok(info.type === 'audio' && info.duration > 1.5);
    assert.ok(tts.piperStatus(dir).voices.find((v) => v.id === 'en_US-joe-medium').downloaded);
  }
  fs.rmSync(out, { recursive: true, force: true });
  console.log('TTS OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
