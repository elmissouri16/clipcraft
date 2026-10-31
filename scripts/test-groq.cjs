// Groq (OpenAI chat API) for RocketPilot, against a local mock server: chat, the models list and a full
// tool-calling round trip translated from / to the agent's Gemini-style conversation. No real key, no internet.
// Usage: node scripts/test-groq.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const { chat, agentStep, listModels, testConnection } = require('../electron/ai.cjs');
const { DEFAULT_MODELS, PROVIDERS } = (() => {
  // settings.cjs needs Electron; read the two constants from its source instead.
  const src = require('fs').readFileSync(require('path').join(__dirname, '../electron/settings.cjs'), 'utf8');
  return { PROVIDERS: eval(src.match(/const PROVIDERS = (\[[^\]]*\]);/)[1]), DEFAULT_MODELS: { groq: src.match(/groq: '([^']+)'/)[1] } };
})();

const FAKE = 'gsk_FAKE-KEY-1234567890';
const seen = [];
let busy = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    seen.push({ url: req.url, headers: req.headers, body: json });
    const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/openai/v1/models') {
      return send({ data: [{ id: 'llama-3.3-70b-versatile', active: true }, { id: 'whisper-large-v3', active: true }, { id: 'openai/gpt-oss-120b', active: true }, { id: 'llama-guard-4-12b', active: true }] });
    }
    if (req.url === '/openai/v1/chat/completions' && json.model === 'busy-model') {
      // Rate limited twice, then fine.
      busy += 1;
      if (busy <= 2) {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Rate limit reached for model `busy-model` on tokens per minute (TPM): Limit 8000, Used 3404, Requested 6026. Please try again in 0.05s.', code: 'rate_limit_exceeded' } }));
      }
      return send({ choices: [{ message: { role: 'assistant', content: 'Done after waiting.' } }] });
    }
    if (req.url === '/openai/v1/chat/completions' && json.model === 'blocked-model') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'The model `blocked-model` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } }));
    }
    if (req.url === '/openai/v1/chat/completions') {
      if (!json.tools) return send({ choices: [{ message: { role: 'assistant', content: 'OK from groq' } }] });
      // First turn: ask for get_project. After a tool answer: plain text.
      if (!json.messages.some((m) => m.role === 'tool')) {
        return send({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'groq_1', type: 'function', function: { name: 'zoom', arguments: '{"start_sec":2,"end_sec":4,"scale":1.3}' } }] } }] });
      }
      return send({ choices: [{ message: { role: 'assistant', content: 'Zoomed in.' } }] });
    }
    res.writeHead(404);
    res.end('{}');
  });
});

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/openai/v1`;
  try {
    assert.ok(PROVIDERS.includes('groq'), 'groq is a provider');
    assert.equal(DEFAULT_MODELS.groq, 'openai/gpt-oss-120b');
    const cfg = { provider: 'groq', model: 'llama-3.3-70b-versatile', baseUrl: base, apiKey: FAKE };

    assert.equal(await chat(cfg, { messages: [{ role: 'user', content: 'hi' }], system: 's' }), 'OK from groq');
    assert.equal(seen.at(-1).headers.authorization, `Bearer ${FAKE}`);
    assert.equal(seen.at(-1).body.messages[0].role, 'system');

    const models = await listModels(cfg);
    assert.deepEqual(models.models, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'], 'speech and guard models left out');

    // Tool round trip with the same conversation format RocketPilot keeps.
    const tools = [{ name: 'zoom', description: 'Zoom', parameters: { type: 'OBJECT', properties: { start_sec: { type: 'NUMBER' }, items: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['start_sec'] } }];
    const contents = [{ role: 'user', parts: [{ text: 'zoom on 2 to 4' }] }];
    let step = await agentStep(cfg, { system: 'You are RocketPilot', contents, tools });
    assert.deepEqual(step.calls, [{ name: 'zoom', args: { start_sec: 2, end_sec: 4, scale: 1.3 } }]);
    const sent = seen.at(-1).body;
    assert.equal(sent.tools[0].function.parameters.type, 'object', 'schema types in lower case');
    assert.equal(sent.tools[0].function.parameters.properties.items.items.type, 'string');
    assert.equal(sent.tool_choice, 'auto');
    assert.equal(sent.reasoning_effort, undefined, 'no reasoning setting for llama');
    await agentStep({ ...cfg, model: 'openai/gpt-oss-120b' }, { system: 's', contents: [{ role: 'user', parts: [{ text: 'x' }] }], tools });
    assert.equal(seen.at(-1).body.reasoning_effort, 'low', 'short thinking for gpt-oss');
    contents.push(step.content);
    contents.push({ role: 'user', parts: [{ functionResponse: { name: 'zoom', response: { result: { ok: true } } } }] });
    step = await agentStep(cfg, { system: 'You are RocketPilot', contents, tools });
    assert.equal(step.text, 'Zoomed in.');
    assert.deepEqual(step.calls, []);
    const msgs = seen.at(-1).body.messages;
    const call = msgs.find((m) => m.tool_calls);
    const answer = msgs.find((m) => m.role === 'tool');
    assert.equal(answer.tool_call_id, call.tool_calls[0].id, 'tool answer matched to its call');
    assert.deepEqual(JSON.parse(answer.content), { result: { ok: true } });
    assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
    // Rate limits are waited out (the service names the wait) and retried; max_tokens stays small for Groq.
    const waits = [];
    const done = await agentStep({ ...cfg, model: 'busy-model' }, { system: 's', contents: [{ role: 'user', parts: [{ text: 'x' }] }], tools }, async (ms) => waits.push(ms));
    assert.equal(done.text, 'Done after waiting.');
    assert.deepEqual(waits, [550, 550]);
    assert.equal(seen.at(-1).body.max_tokens, 1024);
    // A model the key cannot use: Test connection names the usable ones and offers the best for tools.
    const t = await testConnection({ ...cfg, model: 'blocked-model' });
    assert.equal(t.ok, false);
    assert.equal(t.suggestModel, 'openai/gpt-oss-120b');
    assert.match(t.error, /cannot use "blocked-model".*llama-3\.3-70b-versatile/);
    // The key never shows up in an error message.
    const bad = await listModels({ ...cfg, baseUrl: `${base}/nope` });
    assert.ok(!bad.ok && !String(bad.error).includes(FAKE));
    console.log('GROQ OK');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
