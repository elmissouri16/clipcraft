// RocketPilot fallback between AI providers, against local mock servers (no real key, no internet):
// Gemini overloaded -> the step goes to Groq; only providers with a key are tried; all failing -> one clear error.
// Usage: node scripts/test-fallback.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const { agentStep } = require('../electron/ai.cjs');
const { fallbackOrder, withFallback, reason } = require('../electron/aifallback.cjs');

const hits = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits.push(req.url);
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/gemini-down/')) return send(503, { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } });
    if (req.url.startsWith('/groq-ok/')) return send(200, { choices: [{ message: { role: 'assistant', content: 'Answered by Groq.' } }] });
    if (req.url.startsWith('/groq-limited/')) return send(429, { error: { message: 'Rate limit reached. Please try again in 90s.' } });
    return send(404, { error: { message: 'not found' } });
  });
});

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const noSleep = async () => {};
  const req = { system: 's', contents: [{ role: 'user', parts: [{ text: 'zoom please' }] }], tools: [] };
  try {
    // Order: the chosen provider first, then the others that have a key (and can use tools).
    assert.deepEqual(fallbackOrder('gemini', (p) => p === 'groq'), ['gemini', 'groq']);
    assert.deepEqual(fallbackOrder('groq', () => true), ['groq', 'gemini', 'openai', 'openrouter', 'claude', 'custom', 'ollama']);
    assert.deepEqual(fallbackOrder('gemini', () => false), ['gemini']);

    // Gemini overloaded: retried, then Groq answers the same step.
    const cfgs = {
      gemini: { provider: 'gemini', model: 'g', baseUrl: `${base}/gemini-down`, apiKey: 'AIza-fake' },
      groq: { provider: 'groq', model: 'openai/gpt-oss-120b', baseUrl: `${base}/groq-ok`, apiKey: 'gsk_fake' },
    };
    const r = await withFallback(['gemini', 'groq'], (p) => cfgs[p], (cfg) => agentStep(cfg, req, noSleep));
    assert.equal(r.provider, 'groq');
    assert.equal(r.result.text, 'Answered by Groq.');
    assert.deepEqual(r.failed.map((f) => [f.provider, f.reason]), [['gemini', 'overloaded']]);
    assert.equal(hits.filter((h) => h.startsWith('/gemini-down/')).length, 4, 'Gemini tried 4 times before switching');

    // Everything fails: the first error, with the others named.
    const bad = { ...cfgs, groq: { ...cfgs.groq, baseUrl: `${base}/groq-limited` } };
    await assert.rejects(() => withFallback(['gemini', 'groq'], (p) => bad[p], (cfg) => agentStep(cfg, req, noSleep)),
      (e) => /overloaded/.test(e.message) && /Also tried: Groq \(rate limit reached\)/.test(e.message));

    assert.equal(reason({ status: 401 }), 'key refused');
    assert.equal(reason({ status: 0, message: 'Could not reach the AI service' }), 'unreachable');
    console.log('FALLBACK OK');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
