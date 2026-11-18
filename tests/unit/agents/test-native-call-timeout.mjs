// The editor runs a native agent's tool calls one at a time. Each call's time limit starts when the
// call begins to run (electron/agents/nativeAgents.cjs), so calls the agent issues together are not
// timed out while they wait (a timeout stops the whole request); a call that itself runs too long
// still times out. The native instructions do not promise parallel generate_image calls.
// Usage: node tests/unit/agents/test-native-call-timeout.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNativeAgents } = require('../../../electron/agents/nativeAgents.cjs');

const LIMIT = 300;
const agentsWith = (calls) => createNativeAgents({ loadSdk: async () => ({}), resolveExecutable: () => 'x', childEnv: () => ({}),
  CodexSession: class { async run({ onTool }) { return { text: JSON.stringify(await Promise.all(calls.map(([name, id], i) => onTool(name, { id }, { nativeCallId: i, turnId: 't' })))) }; } close() {} },
  limits: { toolCallsPerRequest: 300, toolCallTimeoutMs: LIMIT, completionAttempts: 1, imagesPerRequest: 6 } });
// The renderer's serialized queue, each call taking `ms`.
const editor = (ms) => {
  let queue = Promise.resolve(), running = 0, most = 0;
  const onTool = (name, args) => { const task = queue.then(async () => { most = Math.max(most, ++running); await new Promise((r) => setTimeout(r, ms[args.id])); running--; return { content: [{ type: 'text', text: `ok ${args.id}` }] }; }); queue = task.catch(() => {}); return task; };
  return { onTool, most: () => most };
};
const run = async (calls, ms) => {
  const timeouts = [], ed = editor(ms), controller = new AbortController();
  const result = await agentsWith(calls).run({ provider: 'codex-sdk' }, { sessionKey: `k${Math.random()}`, tools: [], signal: controller.signal, onTool: ed.onTool, isComplete: async () => true, system: '', prompt: 'p',
    onToolTimeout: (name) => { timeouts.push(name); controller.abort(); } }).then((r) => JSON.parse(r.text), (e) => ({ rejected: e.message }));
  return { result, timeouts, most: ed.most() };
};

// Three calls of 200 ms issued together under a 300 ms limit: each runs within its own limit.
let r = await run([['index_video', 'a'], ['index_video', 'b'], ['index_video', 'c']], { a: 200, b: 200, c: 200 });
assert.deepEqual(r.timeouts, [], 'no queued call times out');
assert.deepEqual(r.result.map((x) => x.content?.[0]?.text), ['ok a', 'ok b', 'ok c']);
assert.equal(r.most, 1, 'the editor still runs them one at a time');
// A call that itself runs past the limit still times out and stops the request.
r = await run([['index_video', 'a'], ['index_video', 'slow']], { a: 50, slow: LIMIT * 2 });
assert.deepEqual(r.timeouts, ['index_video']);

// The instructions describe the native image path as it runs.
globalThis.window = { api: {} };
const { nativeSystemPrompt } = await import('../../../src/features/agent/runNativeAgent.js');
const prompt = nativeSystemPrompt();
assert.doesNotMatch(prompt, /generate_image calls together/, 'no promise of parallel generate_image calls');
assert.match(prompt, /one generate_images call/);assert.match(prompt, /Separate generate_image calls run one at a time/);
console.log('native call timeout ok: limits start when a call runs; queued calls do not time out; the prompt matches the serial path');
