// Discover allowed controls and verify each provider's real request field.
const assert = require('node:assert/strict');
const ai = require('../electron/ai.cjs');
const thinking = require('../electron/thinking.cjs');
const localAgents = require('../electron/localAgents.cjs');
const originalFetch = global.fetch, originalCatalog = localAgents.listModels;
const seen = [];
let respond;
global.fetch = async (url, options = {}) => {
  const call = { url: String(url), body: options.body ? JSON.parse(options.body) : null, signal: options.signal };
  seen.push(call);
  return new Response(JSON.stringify(await respond(call)), { status: 200 });
};
const contents = [{ role: 'user', parts: [{ text: 'Read the project.' }] }];
const tools = [{ name: 'get_project', description: 'Read', parameters: { type: 'OBJECT', properties: {} } }];
const req = { system: 'Test', contents, tools };
const reply = { choices: [{ message: { content: 'Done.' } }] };
const last = () => seen.at(-1);
const answer = () => ({ role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: { ok: true } } } }] });
(async () => {
  try {
    assert.deepEqual(thinking.documentedLevels('openai', 'constructor'), []);
    assert.deepEqual(thinking.documentedLevels('gemini', '__proto__'), []);
    assert.ok(!thinking.documentedLevels('openai', 'gpt-6.1-sol').includes('none'));
    assert.equal(thinking.usesResponses({ provider: 'openai', model: 'gpt-5.4' }), false, 'unmodified older model defaults retain their existing route');
    assert.equal(thinking.usesResponses({ provider: 'openai', model: 'gpt-5.4', reasoningEffort: 'high' }), true);
    localAgents.listModels = async () => ({ ok: true, modelCapabilities: { 'sdk-model': { reasoningEfforts: ['low', 'ultra'] } } });
    assert.deepEqual((await ai.modelCapabilities({ provider: 'codex-sdk', model: 'sdk-model' })).reasoningEfforts, ['low', 'ultra']);
    respond = () => reply;
    const groq = { provider: 'groq', model: 'openai/gpt-oss-120b', apiKey: 'test', reasoningEffort: 'high' };
    await ai.agentStep(groq, req);
    assert.equal(last().body.reasoning_effort, 'high');
    await assert.rejects(ai.agentStep({ ...groq, reasoningEffort: 'ultra' }, req), /not supported/);
    respond = () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
    await assert.rejects(ai.agentStep(groq, req), /output budget/);

    respond = ({ url }) => url.endsWith('/models') ? { data: [{ id: 'vendor/reasoner', reasoning: { supported_efforts: ['low', 'high'] } }] } : reply;
    const router = { provider: 'openrouter', model: 'vendor/reasoner', apiKey: 'router-test', reasoningEffort: 'high' };
    await ai.agentStep(router, req);
    assert.deepEqual(last().body.reasoning, { effort: 'high' });
    assert.equal(last().body.reasoning_effort, undefined);
    await assert.rejects(ai.agentStep({ ...router, reasoningEffort: 'none' }, req), /not supported/);
    await ai.chat(router, { messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(last().body.reasoning.effort, 'high');

    respond = ({ url }) => url.endsWith('/models') ? { data: [{ id: 'custom-reasoner', supported_reasoning_efforts: ['medium', 'ultra'] }, { id: 'unknown-model' }] } : reply;
    const custom = { provider: 'custom', baseUrl: 'https://custom.test/v1', model: 'custom-reasoner', apiKey: 'custom-test', reasoningEffort: 'medium' };
    await ai.agentStep(custom, req);
    assert.equal(last().body.reasoning_effort, 'medium');
    await ai.agentStep({ ...custom, reasoningEffort: 'ultra' }, req);
    assert.equal(last().body.reasoning_effort, 'ultra', 'HTTP providers can advertise additional native levels without a stale UI enum');
    assert.deepEqual((await ai.modelCapabilities({ ...custom, model: 'unknown-model' })).reasoningEfforts, []);
    await assert.rejects(ai.agentStep({ ...custom, model: 'unknown-model', reasoningEffort: 'high' }, req), /not supported/);

    respond = () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini done' }] } }] });
    const gemini = { provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'gemini-test', reasoningEffort: 'low' };
    await ai.agentStep(gemini, req);
    assert.deepEqual(last().body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
    await assert.rejects(ai.agentStep({ ...gemini, reasoningEffort: 'minimal' }, req), /not supported/);
    await ai.chat(gemini, { messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(last().body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');

    const blocks = [{ type: 'thinking', thinking: 'opaque reasoning', signature: 'signed-test' },
      { type: 'tool_use', id: 'real-tool-id', name: 'get_project', input: {} }];
    respond = ({ url }) => url.includes('/models/') ? { capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: true }, max: { supported: false } } } } : { content: blocks };
    const claude = { provider: 'claude', model: 'claude-test-model', apiKey: 'claude-test', reasoningEffort: 'high' };
    const cs = await ai.agentStep(claude, req);
    assert.equal(last().body.output_config.effort, 'high');
    await ai.agentStep(claude, { ...req, contents: [...contents, cs.content, answer()] });
    assert.deepEqual(last().body.messages[1].content, blocks);
    assert.equal(last().body.messages[2].content[0].tool_use_id, 'real-tool-id');
    await assert.rejects(ai.agentStep({ ...claude, reasoningEffort: 'max' }, req), /not supported/);

    const items = [{ type: 'reasoning', id: 'r1', encrypted_content: 'opaque-state' },
      { type: 'function_call', id: 'f1', call_id: 'actual-call-id', name: 'get_project', arguments: '{}' }];
    respond = () => ({ status: 'completed', output: items });
    const openai = { provider: 'openai', model: 'gpt-6.1-sol', apiKey: 'openai-test', reasoningEffort: 'xhigh' };
    const os = await ai.agentStep(openai, req);
    assert.ok(last().url.endsWith('/responses'));
    assert.equal(last().body.reasoning.effort, 'xhigh');
    assert.deepEqual(os.calls, [{ name: 'get_project', args: {} }]);
    await ai.agentStep(openai, { ...req, contents: [...contents, os.content, answer()] });
    assert.deepEqual(last().body.input.slice(1, 3), items);
    assert.equal(last().body.input.at(-1).call_id, 'actual-call-id');
    assert.equal(last().body.store, false);
    await assert.rejects(ai.agentStep({ ...openai, reasoningEffort: 'none' }, req), /not supported/);
    respond = () => ({ data: [{ id: 'gpt-6.1-sol', reasoning: { supported_efforts: ['low'] } }] });
    const restricted = { ...openai, apiKey: 'restricted-test' };
    assert.deepEqual((await ai.modelCapabilities(restricted)).reasoningEfforts, ['low'], 'live model metadata takes precedence over documented defaults');
    await assert.rejects(ai.agentStep(restricted, req), /not supported/);

    respond = ({ url, body }) => url.endsWith('/api/show') ? { thinking: { values: body.model === 'binary-model' ? [true, false] : ['low', 'high'] } }
      : { message: { content: '', tool_calls: [{ function: { name: 'get_project', arguments: {} } }] } };
    const ollama = { provider: 'ollama', model: 'binary-model', baseUrl: 'http://localhost:11434/v1', reasoningEffort: 'off' };
    const ns = await ai.agentStep(ollama, req);
    assert.equal(last().body.think, false);
    assert.equal(last().body.options.num_predict, 1024, 'native thinking requests retain the previous agent output budget');
    assert.ok(last().url.endsWith('/api/chat'));
    await ai.agentStep(ollama, { ...req, contents: [...contents, ns.content, answer()] });
    assert.deepEqual(last().body.messages.find((m) => m.role === 'assistant').tool_calls[0].function.arguments, {});
    assert.equal(last().body.messages.find((m) => m.role === 'tool').tool_name, 'get_project');
    await ai.agentStep({ ...ollama, model: 'level-model', reasoningEffort: 'high' }, req);
    assert.equal(last().body.think, 'high');
    respond = () => ({ message: { content: '' }, done_reason: 'length' });
    await assert.rejects(ai.agentStep({ ...ollama, model: 'level-model', reasoningEffort: 'high' }, req), /output budget/);

    const controller = new AbortController();
    respond = ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })), { once: true }));
    const pending = ai.agentStep({ ...custom, model: 'cancel-model', apiKey: 'cancel-test', reasoningEffort: 'high' }, { ...req, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5)); controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    console.log('thinking ok (provider fields, allowed levels, opaque reasoning, tool replay, cancellation)');
  } finally { global.fetch = originalFetch; localAgents.listModels = originalCatalog; }
})().catch((error) => { console.error(error); process.exitCode = 1; });
