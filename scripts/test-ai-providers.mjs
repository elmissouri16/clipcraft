// AI providers with a MOCKED fetch (no keys, no network): request shape, response parsing
// and tool-call translation for the OpenAI-compatible family (OpenAI / Groq / OpenRouter /
// Custom / Ollama), Anthropic, and Gemini; plus base-URL resolution rules.
import assert from 'assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ai = require('../electron/ai.cjs');

const calls = [];
let responder = () => ({});
global.fetch = async (url, opts) => {
  calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
  const json = responder(url);
  return { ok: true, status: 200, text: async () => JSON.stringify(json) };
};
const lastCall = () => calls[calls.length - 1];

const TOOLS = [{ name: 'cut_range', description: 'Cut', parameters: { type: 'OBJECT', properties: { start_sec: { type: 'NUMBER' } }, required: ['start_sec'] } }];
const CONTENTS = [
  { role: 'user', parts: [{ text: 'cut the start' }] },
  { role: 'model', parts: [{ functionCall: { name: 'cut_range', args: { start_sec: 1 } } }] },
  { role: 'user', parts: [{ functionResponse: { name: 'cut_range', response: { result: 'done' } } }] },
];

async function main() {
  // --- OpenAI-compatible agent step (OpenAI) ---
  responder = () => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'cut_range', arguments: '{"start_sec":2}' } }] } }] });
  let step = await ai.agentStep({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', baseUrl: '' },
    { system: 'sys', contents: CONTENTS, tools: TOOLS }, async () => {});
  assert.equal(lastCall().url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(lastCall().opts.headers.authorization, 'Bearer sk-test');
  assert.equal(lastCall().body.tools[0].function.parameters.type, 'object', 'schema types are lower-cased for JSON Schema');
  assert.equal(lastCall().body.messages[2].tool_calls[0].function.name, 'cut_range', 'history tool call translated');
  assert.equal(lastCall().body.messages[3].role, 'tool', 'history tool result translated');
  assert.deepEqual(step.calls, [{ name: 'cut_range', args: { start_sec: 2 } }]);
  assert.equal(step.content.role, 'model');

  // --- OpenRouter chat ---
  responder = () => ({ choices: [{ message: { content: 'hi there' } }] });
  const orText = await ai.chat({ provider: 'openrouter', apiKey: 'sk-or', model: 'openai/gpt-4o-mini', baseUrl: '' }, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(orText, 'hi there');
  assert.equal(lastCall().url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(lastCall().opts.headers['x-title'], 'ClipCraft');

  // --- Custom provider: needs its own base URL, then behaves like OpenAI ---
  await assert.rejects(() => ai.chat({ provider: 'custom', apiKey: 'k', model: 'm', baseUrl: '' }, { messages: [{ role: 'user', content: 'x' }] }), /needs the address/);
  responder = () => ({ choices: [{ message: { content: 'custom ok' } }] });
  const cText = await ai.chat({ provider: 'custom', apiKey: 'k', model: 'my-model', baseUrl: 'https://llm.example.com/v1/' }, { messages: [{ role: 'user', content: 'x' }] });
  assert.equal(cText, 'custom ok');
  assert.equal(lastCall().url, 'https://llm.example.com/v1/chat/completions', 'trailing slash trimmed');

  // --- Ollama agent step: /v1 chat-completions, no key needed ---
  responder = () => ({ choices: [{ message: { content: 'local answer', tool_calls: [] } }] });
  step = await ai.agentStep({ provider: 'ollama', apiKey: '', model: 'qwen2.5:7b', baseUrl: '' },
    { system: '', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: TOOLS }, async () => {});
  assert.equal(lastCall().url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(lastCall().opts.headers.authorization, undefined, 'ollama sends no auth header without a key');
  assert.equal(step.text, 'local answer');

  // --- Anthropic: chat + agent step translation ---
  responder = () => ({ content: [{ type: 'text', text: 'claude says hi' }] });
  const clText = await ai.chat({ provider: 'claude', apiKey: 'sk-ant', model: 'claude-x', baseUrl: '' }, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(clText, 'claude says hi');
  assert.equal(lastCall().url, 'https://api.anthropic.com/v1/messages');
  assert.equal(lastCall().opts.headers['x-api-key'], 'sk-ant');
  responder = () => ({ content: [{ type: 'text', text: 'cutting' }, { type: 'tool_use', id: 'toolu_9', name: 'cut_range', input: { start_sec: 3 } }] });
  step = await ai.agentStep({ provider: 'claude', apiKey: 'sk-ant', model: 'claude-x', baseUrl: '' },
    { system: 'sys', contents: CONTENTS, tools: TOOLS }, async () => {});
  const ab = lastCall().body;
  assert.equal(ab.system, 'sys', 'system is a top-level Anthropic field');
  assert.equal(ab.tools[0].input_schema.type, 'object');
  assert.equal(ab.messages[1].content[0].type, 'tool_use', 'history call became a tool_use block');
  assert.equal(ab.messages[2].content[0].type, 'tool_result', 'history answer became a tool_result block');
  assert.equal(ab.messages[2].content[0].tool_use_id, ab.messages[1].content[0].id, 'tool_result matches its tool_use id');
  assert.deepEqual(step.calls, [{ name: 'cut_range', args: { start_sec: 3 } }]);
  assert.equal(step.text, 'cutting');

  // --- Gemini agent step still routes to generateContent ---
  responder = () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'gemini here' }] } }] });
  step = await ai.agentStep({ provider: 'gemini', apiKey: 'AIza-test', model: 'gemini-x', baseUrl: '' },
    { system: '', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: TOOLS }, async () => {});
  assert.ok(lastCall().url.includes('generativelanguage.googleapis.com'), 'gemini endpoint used');
  assert.equal(step.text, 'gemini here');

  // --- Base resolution rules ---
  assert.equal(ai.openAiBase({ provider: 'groq', baseUrl: '' }), 'https://api.groq.com/openai/v1');
  assert.equal(ai.openAiBase({ provider: 'ollama', baseUrl: 'http://localhost:11434' }), 'http://localhost:11434/v1');
  assert.equal(ai.openAiBase({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }), 'http://localhost:11434/v1');
  assert.throws(() => ai.openAiBase({ provider: 'custom', baseUrl: '' }), /needs the address/);

  // --- testConnection reports honestly from the (mocked) reply ---
  responder = () => ({ choices: [{ message: { content: 'OK' } }] });
  const tc = await ai.testConnection({ provider: 'openai', apiKey: 'sk', model: 'gpt-4o-mini', baseUrl: '' });
  assert.deepEqual({ ok: tc.ok, reply: tc.reply }, { ok: true, reply: 'OK' });

  console.log('ai-providers OK: openai-like, openrouter, custom, ollama, anthropic, gemini — shapes + parsing + translation verified with mocked fetch');
}

main().catch((e) => { console.error(e); process.exit(1); });
