// Provider replies at the CraftAI loop boundary, against a fake fetch (no network, no key):
// - a schema or unloaded-tool error goes back to the model instead of ending the request or switching provider;
// - a blocked or empty reply is an error naming the provider's reason, and no empty turn is saved;
// - host-made function-call turns carry Gemini's placeholder thought signature;
// - only a refused key makes Gemini try its other endpoint.
// Usage: node tests/unit/agents/test-provider-replies.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runAgent } from '../../../src/features/agent/runAgent.js';
import { emptyProject, historyReducer } from '../../../src/state/store.js';

const require = createRequire(import.meta.url);
const ai = require('../../../electron/agents/ai.cjs');
const fb = require('../../../electron/agents/aifallback.cjs');
const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };
const cfgs = { gemini: { provider: 'gemini', model: 'gemini-test', apiKey: 'AIzaFAKE' }, groq: { provider: 'groq', model: 'groq-test', apiKey: 'gsk_FAKE' } };
const gem = (parts) => ({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }] });
const oldFetch = global.fetch;

// The main process's agent:step handler, minus IPC and images.
function harness(order, responder, project = emptyProject()) {
  let state = { past: [], present: project, future: [] };
  const sent = [], events = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body || '{}'); sent.push({ url: String(url), body });
    const answer = responder(String(url), body, sent.length - 1);
    return new Response(JSON.stringify(answer.body ?? answer), { status: answer.status || 200 });
  };
  const api = {
    mcpTools: async () => ({ ok: true, tools: [] }),
    agentStep: async (req) => {
      try {
        const { result, provider, failed } = await fb.withFallback(order, (p) => cfgs[p], (cfg) => ai.agentStep(cfg, { ...req, images: [] }, async () => {}));
        return { ok: true, ...result, provider, model: cfgs[provider].model, fellBack: failed.map((f) => ({ provider: f.provider, name: fb.NAMES[f.provider], reason: f.reason })) };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
  const contents = [{ role: 'user', parts: [{ text: 'Rename the project to Demo.' }] }];
  const ctx = { provider: order[0], getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, settle: async () => {}, api };
  return { sent, events, contents, state: () => state.present, run: () => runAgent({ contents, ctx, requestId: 'replies', onEvent: (e) => events.push(e), isCanceled: () => false }) };
}
const responsesOf = (body) => body.contents.flatMap((c) => c.parts || []).filter((p) => p.functionResponse).map((p) => p.functionResponse.response.result);

try {
  // 1. A tool that is not loaded: the model hears why, loads it and finishes; Groq (keyed) is never asked.
  {
    const media = [{ id: 'm', type: 'video', name: 'a.mp4', path: '/x/a.mp4', duration: 20, width: 1920, height: 1080, hasAudio: true }];
    const project = { ...emptyProject(), media, videoClips: [{ id: 'v1', mediaId: 'm', in: 0, out: 10, speed: 1 }, { id: 'v2', mediaId: 'm', in: 10, out: 12, speed: 1 }] };
    const h = harness(['gemini', 'groq'], (url, body, n) => url.includes('groq') ? { choices: [{ finish_reason: 'stop', message: { content: 'Groq answer' } }] }
      : n === 0 ? gem([{ functionCall: { name: 'delete_clip', args: { clip_id: 'v2' } } }])
      : n === 1 ? gem([{ functionCall: { name: 'load_tools', args: { groups: ['timeline'] } } }])
      : n === 2 ? gem([{ functionCall: { name: 'delete_clip', args: { clip_id: 'v2' } } }])
      : gem([{ text: 'Removed the short clip.' }]), project);
    const result = await h.run();
    check('an unloaded tool call does not switch provider', !h.sent.some((s) => s.url.includes('groq')) && !h.events.some((e) => e.status === 'switch'));
    check('the unloaded-tool error reaches the model as a tool result', /not loaded/.test(responsesOf(h.sent[1].body)[0]?.error || ''));
    check('the request continues after the model corrects itself', !result.error && h.state().videoClips.length === 1 && result.text === 'Removed the short clip.');
  }
  // 1b. A wrongly typed argument: returned to the model, nothing executed from that batch.
  {
    const h = harness(['gemini'], (url, body, n) => n === 0 ? gem([{ functionCall: { name: 'set_project', args: { name: 'Bad', fps: '30' } } }])
      : n === 1 ? gem([{ functionCall: { name: 'set_project', args: { name: 'Demo', retry_of: responsesOf(body)[0].failed_operation_id } } }]) : gem([{ text: 'Fixed.' }]));
    const result = await h.run();
    check('a schema error reaches the model and its batch is not executed', /fps must be number/.test(responsesOf(h.sent[1].body)[0]?.error || ''));
    check('a corrected retry completes the request', !result.error && h.state().name === 'Demo');
  }
  // 1c. Structural problems still end the step: no arguments object, unparsable JSON.
  global.fetch = async () => new Response(JSON.stringify(gem([{ functionCall: { name: 'set_project', args: null } }])));
  await assert.rejects(ai.agentStep(cfgs.gemini, { contents: [], tools: [] }), /Invalid set_project call/);
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'set_project', arguments: '{"name"' } }] } }] }));
  await assert.rejects(ai.agentStep(cfgs.groq, { contents: [], tools: [] }), /Invalid JSON arguments/);
  check('malformed calls still stop the step', true);
  // 1d. withFallback moves on only for provider failures.
  {
    let second = 0;
    await assert.rejects(fb.withFallback(['gemini', 'groq'], (p) => p, (p) => { if (p === 'groq') second++; throw new TypeError('editor bug'); }), /editor bug/);
    await assert.rejects(fb.withFallback(['gemini', 'groq'], (p) => p, (p) => { if (p === 'groq') second++; throw Object.assign(new ai.AiError('blocked', 0), { noFallback: true }); }), /blocked/);
    const moved = await fb.withFallback(['gemini', 'groq'], (p) => p, (p) => { if (p === 'gemini') throw new ai.AiError('busy', 503); return 'ok'; });
    check('the editor\'s own errors never switch provider; a busy service still does', second === 0 && moved.provider === 'groq');
  }

  // 2. Blocked and empty replies.
  const empty = [
    ['Gemini SAFETY', 'gemini', { candidates: [{ finishReason: 'SAFETY', index: 0 }] }, /SAFETY/],
    ['Gemini MALFORMED_FUNCTION_CALL', 'gemini', { candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }, /MALFORMED_FUNCTION_CALL/],
    ['Gemini prompt block', 'gemini', { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, /PROHIBITED_CONTENT/],
    ['Gemini empty STOP', 'gemini', gem([{ text: '' }]), /empty reply/],
    ['OpenAI-protocol content_filter', 'groq', { choices: [{ finish_reason: 'content_filter', message: { content: null } }] }, /content_filter/],
  ];
  for (const [label, provider, reply, reason] of empty) {
    const h = harness([provider], () => reply);
    const before = h.contents.length, result = await h.run();
    check(`${label} is reported with its reason`, reason.test(result.error?.error || '') && !result.text);
    check(`${label} saves no empty model turn`, h.contents.length === before);
  }
  for (const [label, reply, reason] of [['Claude refusal', { stop_reason: 'refusal', content: [] }, /refused/], ['Claude empty content', { stop_reason: 'end_turn', content: [] }, /no content|end_turn/]]) {
    global.fetch = async () => new Response(JSON.stringify(reply));
    await assert.rejects(ai.agentStep({ provider: 'claude', model: 'claude-test', apiKey: 'sk-ant-FAKE' }, { contents: [], tools: [] }), (e) => reason.test(e.message) && e.noFallback === true);
    check(`${label} is an error that never falls back`, true);
  }
  // A blocked reply on the first provider does not move to the second either.
  {
    const h = harness(['gemini', 'groq'], (url) => url.includes('groq') ? { choices: [{ finish_reason: 'stop', message: { content: 'Groq answer' } }] } : { candidates: [{ finishReason: 'SAFETY' }] });
    const result = await h.run();
    check('a blocked reply is not silently sent to another provider', /SAFETY/.test(result.error?.error || '') && !h.sent.some((s) => s.url.includes('groq')));
  }
  // The loop's own guard covers adapters that return nothing (extension services).
  {
    let state = { past: [], present: emptyProject(), future: [] };
    const contents = [{ role: 'user', parts: [{ text: 'Hi' }] }];
    const result = await runAgent({ contents, requestId: 'guard', onEvent: () => {}, isCanceled: () => false,
      ctx: { getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, settle: async () => {},
        api: { mcpTools: async () => ({ ok: true, tools: [] }), agentStep: async () => ({ ok: true, text: '  ', calls: [], content: { role: 'model', parts: [{ text: '' }] }, provider: 'x' }) } } });
    check('runAgent reports an empty reply and keeps it out of the conversation', /empty reply/.test(result.error?.error || '') && contents.length === 1);
  }

  // 3. Host-made function calls (critique_edit after an edit) carry the placeholder signature for Gemini.
  {
    const media = [{ id: 'm', type: 'video', name: 'a.mp4', path: '/x/a.mp4', duration: 10, width: 1920, height: 1080, hasAudio: true }];
    const project = { ...emptyProject(), media, videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, start: 0 }] };
    const script = [[{ functionCall: { name: 'load_tools', args: { groups: ['text'] } } }], [{ functionCall: { name: 'add_text', args: { text: 'Hello', start_sec: 1, duration_sec: 3, y: 0.97 } } }], [{ text: 'Added.' }], [{ text: 'Low on purpose.' }]];
    const h = harness(['gemini'], (url, body, n) => gem(script[Math.min(n, script.length - 1)].map((p) => ({ ...p, thoughtSignature: `sig-${n}` }))), project);
    await h.run();
    const hostTurns = h.sent.flatMap((s) => s.body.contents).filter((c) => c.role === 'model' && c.parts.some((p) => p.functionCall?.name === 'critique_edit'));
    check('the host-made critique_edit call is sent with the placeholder signature', hostTurns.length > 0 && hostTurns.every((c) => c.parts.find((p) => p.functionCall).thoughtSignature === 'skip_thought_signature_validator'));
    const modelTurns = h.sent.at(-1).body.contents.filter((c) => c.role === 'model' && c.parts.some((p) => p.functionCall?.name === 'add_text'));
    check('signatures the model returned are kept unchanged', modelTurns.length === 1 && modelTurns[0].parts[0].thoughtSignature === 'sig-1');
    check('the saved conversation is not modified for the wire', !h.contents.some((c) => c.parts.some((p) => p.thoughtSignature === 'skip_thought_signature_validator')));
  }

  // 3b. A 400 that is not about the key is reported as is; only a refused key tries the other endpoint.
  {
    const urls = [];
    global.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Function call is missing a thought_signature in functionCall parts.' } }), { status: 400 }); };
    await assert.rejects(ai.agentStep(cfgs.gemini, { contents: [{ role: 'user', parts: [{ text: 'x' }] }], tools: [] }), (e) => /thought_signature/.test(e.message) && !/key/i.test(e.message.split('HTTP 400')[0]));
    check('a request error is not retried on the other endpoint as a key mismatch', urls.length === 1);
    urls.length = 0;
    global.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 }); };
    await assert.rejects(ai.agentStep(cfgs.gemini, { contents: [{ role: 'user', parts: [{ text: 'x' }] }], tools: [] }), /did not accept this key on either endpoint/);
    check('a refused key still tries the other endpoint', urls.length === 2);
  }
  console.log(`provider replies OK: ${checks.length} checks`);
} finally { global.fetch = oldFetch; }
