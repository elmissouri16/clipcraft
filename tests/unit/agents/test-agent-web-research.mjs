// Web research per native agent (Settings > AI assistant > Web research): Codex on by default,
// Claude off; each can be switched. Off removes every built-in tool; on gives Claude only WebSearch
// and WebFetch, tells the agent, reports searches to the chat and starts a fresh session.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNativeAgents } = require('../../../electron/agents/nativeAgents.cjs');
const research = require('../../../electron/agents/research.cjs');
const realClaude = await import('@anthropic-ai/claude-agent-sdk');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-web-research-'));
const log = path.join(dir, 'protocol.jsonl');
const queries = [];
const claudeSdk = { ...realClaude, query: ({ prompt, options }) => {
  const entry = { options, prompt: '' };
  queries.push(entry);
  return { async *[Symbol.asyncIterator]() {
    for await (const message of prompt) entry.prompt = message.message.content;
    if (options.tools.includes('WebSearch')) {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w1', name: 'WebSearch', input: { query: 'Fez medina history' } },
        { type: 'tool_use', id: 'w2', name: 'WebFetch', input: { url: 'https://example.org/fez' } }] } };
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w1' }, { type: 'tool_result', tool_use_id: 'w2' }, { type: 'tool_result', tool_use_id: 'editor-call' }] } };
    }
    yield { type: 'result', subtype: 'success', result: 'Done.', session_id: options.resume || '00000000-0000-4000-8000-00000000000a' };
  }, close() {} };
} };
const native = createNativeAgents({ loadSdk: async () => claudeSdk,
  resolveExecutable: (cfg) => cfg.provider === 'codex-sdk' ? new URL('../../fixtures/codex-native-stub.cjs', import.meta.url).pathname : '/fake/claude',
  childEnv: () => ({ ...process.env, FVE_NATIVE_FIXTURE_LOG: log }) });
const tools = [{ name: 'get_project', description: 'Read the project.', parameters: { type: 'object', properties: {} } }];
// The Codex protocol fixture finishes a turn for a request that makes no changes once the editor is ready.
const run = (cfg, extra = {}) => native.run({ model: 'm', ...cfg }, { sessionKey: cfg.provider, tools, system: 'Edit videos.',
  prompt: cfg.provider === 'codex-sdk' ? 'Research Fez but make no changes.' : 'Research Fez for the intro.',
  onTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ready: true }) }] }), isComplete: async () => true, ...extra });

try {
  // Settings defaults and storage shape.
  assert.equal(research.enabled({ provider: 'codex-sdk' }), true, 'Codex defaults on');
  assert.equal(research.enabled({ provider: 'claude-agent-sdk' }), false, 'Claude defaults off');
  assert.equal(research.enabled({ provider: 'gemini', webResearch: true }), false, 'API providers have no native research');
  assert.equal(research.enabled({ provider: 'codex-sdk', webResearch: false }), false);

  // Claude, default: no built-in tools at all, and told research is off.
  await run({ provider: 'claude-agent-sdk' });
  let q = queries.at(-1);
  assert.deepEqual(q.options.tools, []);
  assert.ok(q.options.allowedTools.every((n) => n.startsWith('mcp__clipcraft__')));
  assert.match(q.options.systemPrompt, /Web research is off/, 'research state is part of the instructions');
  assert.ok(!q.prompt.includes('Edit videos.'), 'instructions are not repeated in the request message');
  assert.match(q.prompt, /Current user request:\nResearch Fez/);

  // Claude, switched on: only its web tools join the editor tools; searches reach the chat.
  const searches = [];
  await run({ provider: 'claude-agent-sdk', webResearch: true }, { onSearch: (s) => searches.push(s) });
  q = queries.at(-1);
  assert.deepEqual(q.options.tools, ['WebSearch', 'WebFetch']);
  assert.deepEqual(q.options.allowedTools, ['mcp__clipcraft__get_project', 'WebSearch', 'WebFetch']);
  assert.equal(q.options.resume, undefined, 'changing the setting starts a fresh session');
  assert.match(q.options.systemPrompt, /WebSearch and WebFetch tools are enabled/);
  assert.match(q.options.systemPrompt, /untrusted data/);
  assert.deepEqual(searches.map((s) => [s.id, s.query, s.status]), [['w1', 'Fez medina history', 'running'], ['w2', 'https://example.org/fez', 'running'],
    ['w1', 'Fez medina history', 'done'], ['w2', 'https://example.org/fez', 'done']], 'web tools show in the chat; editor tool results do not');
  await run({ provider: 'claude-agent-sdk', webResearch: true });
  assert.equal(queries.at(-1).options.resume, '00000000-0000-4000-8000-00000000000a', 'same setting keeps the session');

  // Codex: live search by default, disabled when switched off.
  await run({ provider: 'codex-sdk' });
  native.close();
  await run({ provider: 'codex-sdk', webResearch: false });
  native.close();
  const starts = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.tools);
  assert.deepEqual(starts.map((e) => e.webSearch), ['live', 'disabled']);
  console.log('WEB RESEARCH OK (defaults, Claude off/on tools, prompts, search events, session restart, Codex live/disabled)');
} finally { native.close(); fs.rmSync(dir, { recursive: true, force: true }); }
