// Tests the AI provider layer against a local mock server (no real key, no internet).
// Usage: node scripts/test-ai.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const { chat, agentStep, testConnection, listModels, normalizeModel } = require('../electron/ai.cjs');

const FAKE = 'FAKE-KEY-1234567890';
const seen = [];
let busyCount = 0;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url.includes('/busy/') || req.url.includes('/down/')) {
      // Gemini "high demand": twice on /busy/ (then fine), always on /down/.
      busyCount += 1;
      if (req.url.includes('/down/') || busyCount <= 2) return send(503, { error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } });
      return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'Back again.' }] }, finishReason: 'STOP' }] });
    }
    if (req.url.includes('/agent/')) {
      // First call asks for a tool; once a functionResponse is present, answer with text.
      const hasResult = JSON.stringify(seen.at(-1).body.contents).includes('functionResponse');
      if (!hasResult) {
        return send(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_project', args: {} }, thoughtSignature: 'sig-123' }] }, finishReason: 'STOP' }] });
      }
      return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'All done.' }] }, finishReason: 'STOP' }] });
    }
    if (req.url.includes('/billing/')) return send(403, { error: { message: 'This API method requires billing to be enabled. Please enable billing on project #1 by visiting https://console.developers.google.com/billing/enable?project=1 then retry.' } });
    if (req.url.startsWith('/v1beta/models?')) {
      return send(200, { models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
      ] });
    }
    if (req.url === '/api/tags') return send(200, { models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }] });
    if (req.url === '/v1/models') return send(200, { data: [{ id: 'gpt-x' }, { id: 'gpt-a' }] });
    if (req.url.includes('/retired/')) return send(404, { error: { message: 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.' } });
    if (req.url.includes('/denied/')) return send(403, { error: { message: `API key ${FAKE} is not valid`, status: 'PERMISSION_DENIED' } });
    if (req.url.includes('/disabled/')) {
      return send(403, { error: { message: 'Agent Platform API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=123 then retry.', status: 'PERMISSION_DENIED' } });
    }
    if (req.url.includes('/limited/')) return send(429, { error: { message: 'Quota exceeded' } });
    if (req.url.startsWith('/v1beta/models/') || req.url.startsWith('/v1/publishers/')) {
      return send(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
    }
    if (req.url === '/api/chat') return send(200, { message: { role: 'assistant', content: 'OK from ollama' } });
    if (req.url === '/v1/chat/completions') return send(200, { choices: [{ message: { content: 'OK from openai' } }] });
    if (req.url === '/v1/messages') return send(200, { content: [{ type: 'text', text: 'OK from claude' }] });
    send(404, { error: { message: 'not found' } });
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const msg = [{ role: 'user', content: 'hi' }];

  // Gemini (AI Studio style key): key goes in a header, never in the URL.
  let out = await chat({ provider: 'gemini', model: 'm1', baseUrl: base, apiKey: FAKE }, { messages: msg, system: 'be brief' });
  assert.equal(out, 'OK');
  let r = seen.at(-1);
  assert.equal(r.url, '/v1beta/models/m1:generateContent');
  assert.equal(r.headers['x-goog-api-key'], FAKE);
  assert.equal(r.body.systemInstruction.parts[0].text, 'be brief');
  assert.equal(r.body.contents[0].parts[0].text, 'hi');

  // Gemini with a Vertex express key (AQ.…): uses the Vertex endpoint with ?key=.
  out = await chat({ provider: 'gemini', model: 'm1', baseUrl: base, apiKey: 'AQ.fake-express-key' }, { messages: msg });
  assert.equal(out, 'OK');
  r = seen.at(-1);
  assert.match(r.url, /^\/v1\/publishers\/google\/models\/m1:generateContent\?key=AQ\.fake-express-key$/);

  assert.equal(await chat({ provider: 'ollama', model: 'q', baseUrl: base }, { messages: msg, system: 's' }), 'OK from ollama');
  assert.equal(seen.at(-1).body.messages[0].role, 'system');
  assert.equal(await chat({ provider: 'openai', model: 'g', baseUrl: `${base}/v1`, apiKey: FAKE }, { messages: msg }), 'OK from openai');
  assert.equal(seen.at(-1).headers.authorization, `Bearer ${FAKE}`);
  assert.equal(await chat({ provider: 'claude', model: 'c', baseUrl: base, apiKey: FAKE }, { messages: msg }), 'OK from claude');
  assert.equal(seen.at(-1).headers['x-api-key'], FAKE);

  // Errors are explained, and the key never leaks into them even when the service echoes it.
  r = await testConnection({ provider: 'gemini', model: 'm', baseUrl: `${base}/denied`, apiKey: FAKE });
  assert.equal(r.ok, false);
  assert.match(r.error, /rejected the key/i);
  assert.ok(!r.error.includes(FAKE), 'key leaked into the error');
  // Tool calling: the model's reply (with its hidden fields) goes back unchanged, and a function result ends the loop.
  const tools = [{ name: 'get_project', description: 'Read the project', parameters: { type: 'OBJECT', properties: {} } }];
  const cfgAgent = { provider: 'gemini', model: 'Gemini 3.8 Flash', baseUrl: `${base}/agent`, apiKey: FAKE };
  const contents = [{ role: 'user', parts: [{ text: 'what is in my project?' }] }];
  let step = await agentStep(cfgAgent, { system: 'You edit videos.', contents, tools });
  assert.deepEqual(step.calls, [{ name: 'get_project', args: {} }]);
  assert.equal(step.content.parts[0].thoughtSignature, 'sig-123');
  assert.equal(seen.at(-1).body.tools[0].functionDeclarations[0].name, 'get_project');
  assert.equal(seen.at(-1).body.systemInstruction.parts[0].text, 'You edit videos.');
  assert.match(seen.at(-1).url, /models\/gemini-3\.8-flash:generateContent/);
  contents.push(step.content, { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: { clips: 2 } } } }] });
  step = await agentStep(cfgAgent, { system: 'You edit videos.', contents, tools });
  assert.equal(step.text, 'All done.');
  assert.deepEqual(step.calls, []);
  await assert.rejects(() => agentStep({ provider: 'bogus', model: 'q' }, { contents, tools }), /Unknown AI provider/);

  // A billing-required answer points to the free AI Studio key instead of asking for a payment card.
  r = await testConnection({ provider: 'gemini', model: 'm', baseUrl: `${base}/billing`, apiKey: 'AQ.fake-express-key' });
  assert.equal(r.ok, false);
  assert.match(r.error, /needs billing/);
  assert.match(r.error, /free key/i);
  assert.equal(r.link, 'https://aistudio.google.com/app/apikey');
  assert.equal(r.linkLabel, 'Get a free key (AI Studio)');

  // A retired model: the replacement Google names is offered, and the other endpoint is not tried.
  const before = seen.length;
  r = await testConnection({ provider: 'gemini', model: 'gemini-2.5-flash', studioBase: `${base}/retired`, vertexBase: `${base}/denied`, apiKey: FAKE });
  assert.equal(r.ok, false);
  assert.equal(r.suggestModel, 'gemini-3.8-flash');
  assert.match(r.error, /no longer available/);
  assert.equal(seen.length - before, 1, 'a 404 must not fall through to the other endpoint');

  // Display names become model ids, and the model list only offers chat-capable models.
  assert.equal(normalizeModel('gemini', 'Gemini 3.7 Flash'), 'gemini-3.7-flash');
  assert.equal(normalizeModel('gemini', 'models/Gemini-2.5-Flash'), 'gemini-2.5-flash');
  assert.equal(normalizeModel('openai', 'GPT-4o'), 'GPT-4o');
  await chat({ provider: 'gemini', model: 'Gemini 2.5 Flash', baseUrl: base, apiKey: FAKE }, { messages: msg });
  assert.equal(seen.at(-1).url, '/v1beta/models/gemini-2.5-flash:generateContent');
  let list = await listModels({ provider: 'gemini', baseUrl: base, apiKey: FAKE });
  assert.deepEqual(list, { ok: true, models: ['gemini-2.5-flash', 'gemini-2.5-pro'] });
  list = await listModels({ provider: 'ollama', baseUrl: base });
  assert.deepEqual(list.models, ['llama3.2:3b', 'qwen2.5:7b']);
  list = await listModels({ provider: 'openai', baseUrl: `${base}/v1`, apiKey: FAKE });
  assert.deepEqual(list.models, ['gpt-a', 'gpt-x']);
  list = await listModels({ provider: 'claude', apiKey: '' });
  assert.equal(list.ok, false);

  // Both Google endpoints refuse an AQ. key: the answer of each endpoint is shown, plus the fix page.
  r = await testConnection({ provider: 'gemini', model: 'm', vertexBase: `${base}/disabled`, studioBase: `${base}/denied`, apiKey: 'AQ.fake-express-key' });
  assert.equal(r.ok, false);
  assert.match(r.error, /either endpoint/);
  assert.match(r.error, /Vertex AI: the API is not switched on/);
  assert.match(r.error, /Google AI Studio \(Gemini API\): HTTP 403/);
  assert.equal(r.link, 'https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=123');
  assert.ok(!r.error.includes('AQ.fake-express-key'));
  // If the first endpoint refuses but the second accepts, the call simply succeeds.
  r = await testConnection({ provider: 'gemini', model: 'm', vertexBase: `${base}/disabled`, studioBase: base, apiKey: 'AQ.fake-express-key' });
  assert.equal(r.ok, true);

  // "API not enabled" gets a plain explanation plus the page to fix it.
  r = await testConnection({ provider: 'gemini', model: 'm', baseUrl: `${base}/disabled`, apiKey: 'AQ.fake-express-key' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not switched on yet/);
  assert.match(r.error, /AI Studio/);
  assert.equal(r.link, 'https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=123');
  r = await testConnection({ provider: 'gemini', model: 'm', baseUrl: `${base}/limited`, apiKey: FAKE });
  assert.match(r.error, /quota|rate limit/i);

  // Gemini busy (503): waited out with growing pauses, then a clear message if it stays busy.
  const waits = [];
  const sleep = async (ms) => waits.push(ms);
  const one = [{ role: 'user', parts: [{ text: 'hi' }] }];
  const back = await agentStep({ provider: 'gemini', model: 'm', baseUrl: `${base}/busy`, apiKey: FAKE }, { contents: one, tools: [] }, sleep);
  assert.equal(back.text, 'Back again.');
  assert.deepEqual(waits, [2000, 5000]);
  await assert.rejects(() => agentStep({ provider: 'gemini', model: 'm', baseUrl: `${base}/down`, apiKey: FAKE }, { contents: one, tools: [] }, sleep),
    (e) => /overloaded right now \(HTTP 503\); it still failed after 4 tries/.test(e.message) && /another model/.test(e.message));
  r = await testConnection({ provider: 'gemini', model: 'm', baseUrl: `${base}/down`, apiKey: FAKE });
  assert.match(r.error, /busy or overloaded \(HTTP 503\)/);

  // Missing key and unreachable service.
  r = await testConnection({ provider: 'claude', model: 'c', apiKey: '' });
  assert.match(r.error, /No API key/);
  r = await testConnection({ provider: 'ollama', model: 'q', baseUrl: 'http://127.0.0.1:9' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Could not reach/);

  // Working connection test.
  r = await testConnection({ provider: 'openai', model: 'g', baseUrl: `${base}/v1`, apiKey: FAKE });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'OK from openai');

  server.close();
  console.log('AI OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
