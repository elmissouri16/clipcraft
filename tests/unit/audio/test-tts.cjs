// Text to speech: ElevenLabs calls against a fake fetch (key never in errors); Piper's runtime per platform, the
// checksum check and the missing-download errors offline; and (unless --offline) Piper for real on this platform:
// download the engine and a voice once, speak a sentence, check the WAV, remove a voice.
// Usage: node tests/unit/audio/test-tts.cjs [--offline]
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

  // Piper: one runtime per platform; Windows and Linux use Piper's build, macOS sherpa-onnx (Piper's macOS build is broken).
  assert.equal(tts.piperRuntime('win32', 'x64').file, 'piper_windows_amd64.zip');
  assert.equal(tts.piperRuntime('win32', 'arm64').file, 'piper_windows_amd64.zip', 'Windows on Arm runs the x64 build');
  assert.equal(tts.piperRuntime('linux', 'x64').file, 'piper_linux_x86_64.tar.gz');
  assert.equal(tts.piperRuntime('linux', 'arm64').file, 'piper_linux_aarch64.tar.gz');
  assert.equal(tts.piperRuntime('darwin', 'arm64').kind, 'sherpa');
  assert.equal(tts.piperRuntime('darwin', 'x64').kind, 'sherpa');
  assert.equal(tts.piperRuntime('linux', 'ia32'), null);
  assert.ok(Object.values(tts.RUNTIMES).every((r) => /^[0-9a-f]{64}$/.test(r.sha256) && r.bytes > 1e7), 'every engine archive is pinned');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-piper-empty-'));
  const unsupported = tts.piperStatus(empty, { rt: null });
  assert.equal(unsupported.supported, false); assert.equal(unsupported.installed, false);
  await assert.rejects(tts.piperDownload(fetch, empty, 'engine', null, { rt: null }), /not available on this computer/);
  const fresh = tts.piperStatus(empty);
  assert.ok(fresh.supported && !fresh.installed && fresh.voices.length === 8 && fresh.voices.every((v) => !v.downloaded && v.bytes > 6e7));
  await assert.rejects(tts.piperSpeak(empty, out, { voiceId: 'en_US-joe-medium', text: 'Hi' }), /Download the Piper voice engine first, in Settings > Voice/);
  await assert.rejects(tts.piperDownload(fetch, empty, 'nope', null), /Unknown voice/);
  // An engine archive that does not match its checksum is never kept or unpacked.
  const tampered = async () => ({ ok: true, headers: new Headers({ 'content-length': '5' }), body: new Response('hello').body });
  await assert.rejects(tts.piperDownload(tampered, empty, 'engine', null), /checksum/);
  assert.deepEqual(fs.readdirSync(empty), [], 'nothing is left behind');
  fs.rmSync(empty, { recursive: true, force: true });
  console.log('piper offline ok');

  if (!process.argv.includes('--offline')) {
    const dir = path.join(os.tmpdir(), 'fve-piper-cache-2'); // kept between runs: the engine and voice are big
    const st = tts.piperStatus(dir);
    if (!st.installed) await tts.piperDownload(fetch, dir, 'engine', (f) => process.stdout.write(`\rengine ${(f * 100).toFixed(0)}%   `));
    if (!st.voices[0].downloaded) await tts.piperDownload(fetch, dir, 'en_US-joe-medium', (f) => process.stdout.write(`\rvoice ${(f * 100).toFixed(0)}%   `));
    const wav = await tts.piperSpeak(dir, out, { voiceId: 'en_US-joe-medium', text: 'Hello from ClipCraft. This voice runs on your computer.' });
    const info = await probe(wav);
    console.log(`\npiper (${tts.piperRuntime().kind}, ${process.platform}-${process.arch}): ${info.duration.toFixed(2)} s`);
    assert.ok(info.type === 'audio' && info.duration > 1.5);
    assert.ok(tts.piperStatus(dir).installed && tts.piperStatus(dir).voices.find((v) => v.id === 'en_US-joe-medium').downloaded);
    await assert.rejects(tts.piperSpeak(dir, out, { voiceId: 'en_GB-cori-medium', text: 'Hi' }), /not downloaded. Download it in Settings > Voice/);
    // Removing a voice deletes only it; the engine stays.
    await tts.piperDownload(fetch, dir, 'fr_FR-gilles-low');
    tts.piperRemove(dir, 'fr_FR-gilles-low');
    assert.ok(!tts.piperStatus(dir).voices.find((v) => v.id === 'fr_FR-gilles-low').downloaded && tts.piperStatus(dir).installed);
  }
  fs.rmSync(out, { recursive: true, force: true });
  console.log('TTS OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
