import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import fs from 'node:fs';
import { runAgent } from "../../../src/features/agent/runAgent.js";
import { emptyProject, historyReducer } from "../../../src/state/store.js";
import { prepareContext, recallContext } from "../../../src/features/agent/context.js";
import { TOOL_DECLARATIONS, createToolRunner } from "../../../src/features/agent/tools.js";
import { validateToolCall } from "../../../shared/toolArguments.mjs";
const require = createRequire(import.meta.url);
const ai = require("../../../electron/agents/ai.cjs");
const { McpClient, createRegistry } = require("../../../electron/agents/mcp.cjs");
const { prepareMcpResult } = require("../../../electron/agents/mcpResult.cjs");
const { scopedFetch } = require("../../../electron/system/cancel.cjs");
const oldFetch = global.fetch, checks = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
const reply = (calls = []) => ({ ok: true, calls, text: calls.length ? '' : 'Done.', content: { role: 'model', parts: calls.length ? calls.map(functionCall => ({ functionCall })) : [{ text: 'Done.' }] } });
function fixture(step, p = emptyProject()) {
  let state = { past: [], present: p, future: [] }, n = 0;
  const requests = [], events = [], ctx = { getProject: () => state.present, dispatch: action => { state = historyReducer(state, action); }, settle: async () => {},
    api: { mcpTools: async () => ({ ok: true, tools: [] }), agentStep: async req => { requests.push(req); return step(n++, req); } } };
  return { ctx, requests, events, state: () => state, run: () => runAgent({ contents: [], ctx, requestId: 'safety-test', onEvent: event => events.push(event), isCanceled: () => false }) };
}
try {
  for (const [finish_reason, args] of [['length', '{}'], ['tool_calls', '{"source":"audio"'], ['tool_calls', 'null'], ['tool_calls', '[]']]) {
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason, message: { tool_calls: [{ function: { name: 'remove_silences', arguments: args } }] } }] }));
    await assert.rejects(ai.agentStep({ provider: 'openrouter', model: 'mock', apiKey: 'fake' }, { contents: [], tools: TOOL_DECLARATIONS }), /truncated|Invalid/);
  }
  for (const [provider, payload] of [
    ['gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'remove_silences', args: null } }] } }] }],
    ['claude', { content: [{ type: 'tool_use', name: 'remove_silences', input: null }] }],
  ]) {
    global.fetch = async () => new Response(JSON.stringify(payload));
    await assert.rejects(ai.agentStep({ provider, model: 'mock', apiKey: 'fake' }, { contents: [], tools: TOOL_DECLARATIONS }), /Invalid/);
  }
  check('malformed and truncated calls cannot execute defaults', true);
  check('schema validates nested required arguments', !!validateToolCall({ name: 'keep_ranges', args: { ranges: [{ start_sec: 1 }] } }, TOOL_DECLARATIONS));
  const invalid = fixture(n => n === 0 ? reply([{ name: 'set_project', args: { name: 'Must not execute' } }, { name: 'set_project', args: { fps: 'wrong' } }]) : reply());
  await invalid.run(); check('invalid call blocks the entire batch before mutation', invalid.state().present.name === 'Untitled');
  const partial = fixture(n => { if (n === 0) return reply([{ name: 'set_project', args: { name: 'Kept edit' } }]); throw new Error('Transport failed'); });
  const partialResult = await partial.run();
  check('exceptions preserve applied edits and operation outcomes', partialResult.changed && partialResult.operations.some(op => op.changed) && partial.state().present.name === 'Kept edit');
  const base = { ...emptyProject(), media: [{ id: 'm', type: 'video', duration: 10 }], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }] };
  const visual = fixture(n => n === 0 ? reply([{ name: 'load_tools', args: { groups: ['text', 'media'] } }]) : n === 1 ? reply([{ name: 'add_text', args: { text: 'Late title', start_sec: 8, duration_sec: 1 } }]) : n === 2 ? reply([{ name: 'inspect_frames', args: { times_sec: [0] } }]) : reply(), base);
  const captures = [];
  visual.ctx.api.agentInspectFrames = async req => { captures.push(req.times_sec); return { frames: req.times_sec.map(time_sec => ({ id: `frame-${time_sec}`, source: 'timeline', time_sec })), revision: req.revision }; };
  const visualResult = await visual.run();
  check('an unrelated frame cannot satisfy title verification', captures.length > 1 && captures.slice(1).flat().some(time => time >= 8 && time < 9) && visualResult.verification.visual_samples_checked);
  {
    let sleeping;
    const beganBackoff = new Promise(resolve => { sleeping = resolve; });
    const stopBackoff = new AbortController();
    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Busy' } }), { status: 503 });
    const retry = ai.agentStep({ provider: 'openrouter', model: 'mock', apiKey: 'fake' }, { contents: [], tools: [], signal: stopBackoff.signal }, () => { sleeping(); return new Promise(() => {}); });
    await beganBackoff; stopBackoff.abort(); await assert.rejects(retry, { name: 'AbortError' });
    check('Stop interrupts provider retry backoff', true);
  }
  const controller = new AbortController();
  let started, observedAbort = false;
  const began = new Promise(resolve => { started = resolve; });
  global.fetch = scopedFetch(async (_url, { signal }) => { started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { observedAbort = true; reject(new Error('aborted')); })); }, controller.signal);
  const pending = global.fetch('https://local.invalid'); await began; controller.abort(); await assert.rejects(pending);
  check('job cancellation reaches the underlying fetch', observedAbort);
  let stopped = false, speechRequest;
  const voice = createToolRunner({ getProject: () => base, dispatch: () => {}, settle: async () => {}, requestId: 'speech-owner', isCanceled: () => stopped,
    api: Object.freeze({ ttsStatus: async () => { stopped = true; return { geminiKey: true }; }, ttsSpeak: async req => { speechRequest = req; return { error: 'unexpected' }; } }) });
  await voice.run('add_voiceover', { text: 'Test' });
  check('stopping between voice selection and synthesis starts no job', !speechRequest);
  const fixturePath = new URL("../../fixtures/mcp-stub.mjs", import.meta.url).pathname;
  const client = new McpClient({ name: 'Restart', command: process.execPath, args: [fixturePath] }, { timeoutMs: 1000 });
  try { await client.listTools(); const exit = once(client.proc, 'exit'); client.proc.kill(); await exit;
    check('MCP reconnects after process exit', (await client.callTool('echo', { text: 'reconnected' })).content[0].text.includes('reconnected'));
    const requestController = new AbortController();
    const request = client.request('never-answer', {}, { signal: requestController.signal }); requestController.abort(); await assert.rejects(request, { name: 'AbortError' });
    check('canceled MCP requests leave no pending calls', client.pending.size === 0);
  } finally { client.stop(); }
  const raw = { content: [{ type: 'text', text: 'Description' }, { type: 'image', mimeType: 'image/png', data: 'BASE64_BYTES' }, { type: 'resource', resource: { uri: 'memory://result', text: 'resource data', mimeType: 'text/plain' } }], structuredContent: { clip_id: 'v', start: 2 } };
  const normalized = await prepareMcpResult(raw, async () => ({ id: 'host-frame', source: 'external' }));
  check('typed MCP data survives without serialized image bytes', normalized.structuredContent.clip_id === 'v' && normalized.content[2].resource.text === 'resource data' && normalized.host_frames[0].id === 'host-frame' && !JSON.stringify(normalized).includes('BASE64_BYTES'));
  const registry = createRegistry(() => [{ name: 'Typed', command: 'mock' }]);
  const list = McpClient.prototype.listTools, call = McpClient.prototype.callTool;
  McpClient.prototype.listTools = async () => [{ name: 'mixed', inputSchema: {} }]; McpClient.prototype.callTool = async () => raw;
  try { await registry.declarations(); check('registry preserves mixed results alongside text', (await registry.call('mcp_typed_mixed', {})).result.structuredContent.clip_id === 'v'); }
  finally { registry.stopAll(); McpClient.prototype.listTools = list; McpClient.prototype.callTool = call; }
  const history = [];
  for (let i = 0; i < 30; i++) history.push({ role: 'user', parts: [{ text: `Instruction ${i} ` + 'x'.repeat(5000) }] }, { role: 'model', parts: [{ functionCall: { name: 'get_project', args: {} }, thoughtSignature: `signed-${i}` }] }, { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: { revision: `r${i}` } } } }] }, { role: 'model', parts: [{ text: 'Done' }] });
  history.push({ role: 'user', parts: [{ text: 'Continue with the latest request intact' }] });
  const original = JSON.stringify(history), bounded = prepareContext(history, { maxChars: 18000 });
  check('long conversations are bounded without modifying saved history', bounded.sentChars <= 18000 && bounded.archivedTurns > 0 && JSON.stringify(history) === original && bounded.contents.at(-1) === history.at(-1));
  check('archived user instructions remain recoverable', recallContext(history, { ref: 'turn:0', max_chars: 6000 }).text.includes('Instruction 0'));
  const aiIndex = bounded.contents.findIndex(turn => turn.parts?.some(part => part.functionCall));
  check('checkpoint preserves tool-call and result pairing', aiIndex >= 0 && bounded.contents[aiIndex + 1].parts[0].functionResponse.name === 'get_project');
  console.log('agent loop safety OK: ' + checks.join('; '));
  if (process.env.AGENT_LOOP_EVIDENCE) fs.writeFileSync(process.env.AGENT_LOOP_EVIDENCE, JSON.stringify({ checks }, null, 2));
} finally { global.fetch = oldFetch; }
