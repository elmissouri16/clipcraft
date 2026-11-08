const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tts = require("../../../electron/audio/geminiTts.cjs");
const { probe } = require("../../../electron/media/ffmpeg.cjs");

function fixtureWav(seconds = 1) {
  const count = Math.round(24000 * seconds), wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let n = 0; n < count; n++) wav.writeInt16LE(Math.round(3000 * Math.sin(n * 440 * Math.PI * 2 / 24000)), 44 + n * 2);
  return wav;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gemini-tts-'));
  const calls = [], key = 'synthetic-gemini-key', wav = fixtureWav();
  const reply = () => ({ ok: true, json: async () => ({ status: 'completed', steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'ignore this' }] },
    { type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') }] },
  ] }) });
  const fetch = async (url, options) => { calls.push({ url, options }); return reply(); };
  try {
    const req = { text: 'مرحبا بكم في المغرب.', voiceId: 'Kore', style: 'Warm documentary narration, Moroccan Arabic accent.' };
    const file = await tts.speak(fetch, key, dir, req);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(calls[0].options.headers['x-goog-api-key'], key);
    assert.ok(!calls[0].url.includes(key));
    assert.ok(!calls[0].options.body.includes(key));
    assert.equal(body.model, 'gemini-3.8-flash-tts');
    assert.equal(body.store, false, 'speech does not need server-side conversation storage');
    assert.equal(body.input[0].content[0].text, req.text, 'spoken Arabic stays verbatim');
    assert.equal(body.input[0].content[0].annotations[0].style, req.style, 'directions are separate metadata');
    assert.deepEqual(body.generation_config.speech_config, [{ voice: 'Kore' }]);
    assert.deepEqual(body.response_format, { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 });
    assert.deepEqual(fs.readFileSync(file), wav, 'write WAV directly without a second header');
    const info = await probe(file);
    assert.equal(info.type, 'audio'); assert.ok(Math.abs(info.duration - 1) < 0.01);
    await tts.speak(fetch, key, dir, req);
    assert.equal(calls.length, 1, 'preview and add reuse audio');
    const variants = [{ ...req, style: 'Cheerful' }, { ...req, voiceId: 'Puck' }, { ...req, model: 'gemini-3.8-flash-lite-tts' }];
    for (const variant of variants) assert.notEqual(await tts.speak(fetch, key, dir, variant), file);
    const n = calls.length;
    for (const [patch, message] of [[{ text: '' }, /Type some text/], [{ text: 'x'.repeat(5001) }, /5000/],
      [{ voiceId: '../invalid' }, /voice/], [{ model: 'gemini-chat' }, /model/], [{ style: 'x'.repeat(1001) }, /1000/], [{ speed: 1.5 }, /pacing/]]) {
      await assert.rejects(tts.speak(fetch, key, dir, { ...req, ...patch }), message);
    }
    assert.equal(calls.length, n, 'invalid input is rejected before network access');
    await assert.rejects(tts.speak(fetch, '', dir, req), /API key/);
    for (const code of [400, 401, 403, 404, 429, 503]) {
      let attempts = 0;
      await assert.rejects(tts.speak(async () => {
        attempts++; return { ok: false, status: code, json: async () => ({ error: { message: key } }) };
      }, key, dir, { ...req, text: `Error ${code}` }), (e) => !e.message.includes(key) && /Gemini TTS/.test(e.message));
      assert.equal(attempts, code >= 500 ? 2 : 1);
    }
    let attempts = 0;
    await tts.speak(async () => ++attempts === 1 ? { ok: false, status: 500 } : reply(), key, dir, { ...req, text: 'Retry succeeds' });
    assert.equal(attempts, 2);
    await assert.rejects(tts.speak(async () => { throw new Error(key); }, key, dir, { ...req, text: 'Network fails' }), /internet connection/);
    await assert.rejects(tts.speak(async () => ({ ok: true, json: async () => ({ status: 'failed', steps: [] }) }), key, dir, { ...req, text: 'Incomplete' }), /did not complete/);
    await assert.rejects(tts.speak(async () => ({ ok: true, json: async () => ({ steps: [] }) }), key, dir, { ...req, text: 'No audio' }), /no WAV audio/);
    await assert.rejects(tts.speak(async () => ({ ok: true, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.from('broken').toString('base64') }] }] }) }), key, dir, { ...req, text: 'Invalid audio' }), /invalid or incomplete/);
    assert.throws(() => tts.validateWav(wav.subarray(0, wav.length - 2)), /incomplete/);
    let concurrent = 0;
    const shared = async () => { concurrent++; await new Promise(r => setTimeout(r, 15)); return reply(); };
    const pair = await Promise.all([1, 2].map(() => tts.speak(shared, key, dir, { ...req, text: 'Concurrent preview and edit' })));
    assert.equal(concurrent, 1); assert.equal(pair[0], pair[1]);
    const tested = [];
    assert.equal((await tts.testKey(async (url, options) => { tested.push({ url, options }); return { ok: true }; }, key)).ok, true);
    assert.ok(tested[0].url.endsWith('/models/gemini-3.8-flash-tts'));
    assert.equal(tested[0].options.body, undefined, 'testing a key does not generate billable speech');
    assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.part')));
    const { isSpeechMedia } = await import("../../../src/features/library/assetsLib.js");
    assert.equal(isSpeechMedia({ type: 'audio', credit: { license: 'gemini' } }), true);
    assert.equal(isSpeechMedia({ type: 'audio', origin: 'tts' }), true);
    assert.equal(isSpeechMedia({ type: 'audio', name: 'voiceover-recording.m4a' }), false);
    console.log('Gemini TTS OK (Interactions contract, real WAV probe, cache, voices/models, errors, retries, concurrent requests, key test)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { fixtureWav };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
