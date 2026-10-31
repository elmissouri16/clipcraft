// Cloud captions (item O): every provider's request shape + response parsing is verified
// against a stubbed fetch (no real key exists here); the chunk-offset merge runs through
// real ffmpeg on a generated tone. Live provider behaviour is verified separately by CDP
// with a fake key (the providers' real 401s surface in the UI).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const cc = require('../electron/cloudCaptions.cjs');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cloud-'));
const mp3 = path.join(dir, 'a.mp3');
fs.writeFileSync(mp3, Buffer.alloc(2048, 7));

// A fetch stub that records the call and answers with a canned payload.
const stub = (payload, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    };
  };
  return { calls, fetchImpl };
};

(async () => {
  // --- Groq: multipart to the OpenAI-shaped endpoint, Bearer auth, segments parsed.
  {
    const { calls, fetchImpl } = stub({ segments: [{ start: 0.5, end: 1.5, text: ' hello ' }, { start: 2, end: 3, text: 'world' }, { start: 4, end: 4, text: '' }] });
    const { segments } = await cc.transcribeCloud({ provider: 'groq', key: 'gsk_x', audioPath: mp3, language: 'en', fetchImpl });
    assert.deepEqual(segments, [{ start: 0.5, end: 1.5, text: 'hello' }, { start: 2, end: 3, text: 'world' }]);
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer gsk_x');
    assert.equal(calls[0].init.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(calls[0].init.body.get('response_format'), 'verbose_json');
    assert.equal(calls[0].init.body.get('language'), 'en');
    assert.ok(calls[0].init.body.get('file'), 'file part present');
  }
  // --- OpenAI: its own host, default model whisper-1, no language when auto.
  {
    const { calls, fetchImpl } = stub({ segments: [{ start: 0, end: 1, text: 'hi' }] });
    const { segments } = await cc.transcribeCloud({ provider: 'openai', key: 'sk-y', audioPath: mp3, language: 'auto', fetchImpl });
    assert.equal(segments.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(calls[0].init.body.get('model'), 'whisper-1');
    assert.equal(calls[0].init.body.get('language'), null);
  }
  // --- Deepgram: raw bytes, Token auth, model in the query, utterances parsed.
  {
    const { calls, fetchImpl } = stub({ results: { utterances: [{ start: 1, end: 2.5, transcript: '  deep gram ' }] } });
    const { segments } = await cc.transcribeCloud({ provider: 'deepgram', key: 'dg', audioPath: mp3, language: 'ar', fetchImpl });
    assert.deepEqual(segments, [{ start: 1, end: 2.5, text: 'deep gram' }]);
    assert.ok(calls[0].url.startsWith('https://api.deepgram.com/v1/listen?'));
    assert.ok(calls[0].url.includes('model=nova-3') && calls[0].url.includes('language=ar'));
    assert.equal(calls[0].init.headers.Authorization, 'Token dg');
    assert.ok(Buffer.isBuffer(calls[0].init.body) && calls[0].init.body.length === 2048, 'raw audio bytes as the body');
  }
  // --- ElevenLabs: xi-api-key, scribe model; words grouped by sentence + pause.
  {
    const words = [
      { text: 'Hello', start: 0, end: 0.4, type: 'word' }, { text: 'world.', start: 0.45, end: 0.9, type: 'word' },
      { text: 'Next', start: 2.5, end: 2.8, type: 'word' }, { text: 'one', start: 2.85, end: 3.1, type: 'word' },
      { text: '!', start: 3.1, end: 3.2, type: 'spacing' },
    ];
    const { calls, fetchImpl } = stub({ words });
    const { segments } = await cc.transcribeCloud({ provider: 'elevenlabs', key: 'el', audioPath: mp3, fetchImpl });
    assert.deepEqual(segments, [
      { start: 0, end: 0.9, text: 'Hello world.' },
      { start: 2.5, end: 3.1, text: 'Next one' },
    ]);
    assert.equal(calls[0].init.headers['xi-api-key'], 'el');
    assert.equal(calls[0].init.body.get('model_id'), 'scribe_v1');
  }
  // --- Errors carry the provider's own message.
  {
    const { fetchImpl } = stub({ error: { message: 'Invalid API key' } }, 401);
    await assert.rejects(
      () => cc.transcribeCloud({ provider: 'groq', key: 'bad', audioPath: mp3, fetchImpl }),
      /Groq answered 401: Invalid API key/,
    );
    const { fetchImpl: f2 } = stub('unauthorized', 403);
    await assert.rejects(() => cc.testConnection({ provider: 'deepgram', key: 'bad', fetchImpl: f2 }), /Deepgram answered 403/);
  }
  // --- Test-connection endpoints per provider.
  {
    const seen = [];
    const fetchImpl = async (url, init = {}) => { seen.push([url, init.headers]); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
    await cc.testConnection({ provider: 'groq', key: 'k', fetchImpl });
    await cc.testConnection({ provider: 'elevenlabs', key: 'k', fetchImpl });
    assert.equal(seen[0][0], 'https://api.groq.com/openai/v1/models');
    assert.equal(seen[0][1].Authorization, 'Bearer k');
    assert.equal(seen[1][0], 'https://api.elevenlabs.io/v1/user');
    assert.equal(seen[1][1]['xi-api-key'], 'k');
  }
  // --- Merge math + chunk planning (pure).
  assert.deepEqual(
    cc.mergeChunks([{ offset: 0, segments: [{ start: 0.1, end: 0.9, text: 'a' }] }, { offset: 2, segments: [{ start: 0.1, end: 0.9, text: 'b' }] }]),
    [{ start: 0.1, end: 0.9, text: 'a' }, { start: 2.1, end: 2.9, text: 'b' }],
  );
  assert.equal(cc.planChunkSeconds(24 * 1024 * 1024, 4000), 1800, 'chunk length is capped at 30 min');
  assert.equal(cc.planChunkSeconds(400 * 1000, 4000), 100);

  // --- End-to-end chunking through real ffmpeg: a 5 s tone forced into 2 s chunks.
  {
    const wav = path.join(dir, 'tone.wav');
    execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ar', '48000', wav]);
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => ({ segments: [{ start: 0.1, end: 0.9, text: 'chunk' }] }),
      text: async () => '',
    });
    const segments = await cc.transcribePrepared({
      provider: 'groq', key: 'k', wavPath: wav, dir, ffmpegPath, probe, fetchImpl,
      capBytes: 1, chunkSeconds: 2, // capBytes 1 forces the split path
    });
    assert.ok(segments.length >= 2, `expected several chunks, got ${segments.length}`);
    assert.ok(Math.abs(segments[0].start - 0.1) < 0.01);
    assert.ok(segments[1].start > 1.9 && segments[1].start < 2.2, `second chunk offset by its real start (${segments[1].start})`);
    for (let i = 1; i < segments.length; i++) assert.ok(segments[i].start >= segments[i - 1].start, 'merged segments stay ordered');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('cloud-captions OK: 4 providers (stubbed), error surfacing, merge + chunking (real ffmpeg)');
})().catch((e) => { console.error(e); process.exit(1); });
