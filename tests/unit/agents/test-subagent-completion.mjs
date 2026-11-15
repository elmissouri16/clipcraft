// No UI or live model: exercise the renderer completion host and the native
// session retry loop with scripted callbacks, including the reported request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runNativeAgent, nativeTools } from '../../../src/features/agent/runNativeAgent.js';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { validateToolCall } from '../../../shared/toolArguments.mjs';
const require = createRequire(import.meta.url);
const { createNativeAgents } = require('../../../electron/agents/nativeAgents.cjs');
const checks = [];
const batchArgs = { media_id: 'source', index_id: 'index', tasks: [{ role: 'analyst', start_sec: 0, end_sec: 10, task: 'Review scene choices and context for the recap.' }] };
const completedBatch = { ok: true, tasks: [{ status: 'completed', summary: 'Inspected the source; no additional candidate.', reviewed_ranges: [{ start_sec: 0, end_sec: 5 }], findings: [] }] };

async function run({ provider = 'codex-sdk', enabled = true, script, batch = completedBatch, nativeLoop = false, prompt = 'use subagents and improve the video' }) {
  let state = { past: [], future: [], present: { ...emptyProject(), media: [{ id: 'source', name: 'Episode', type: 'video', duration: 60 }] } };
  const before = JSON.stringify(state.present), contents = [{ role: 'user', parts: [{ text: prompt }] }], events = [], calls = [], prompts = [], captures = [];
  let listener, nextId = 0, delegates = 0, attempt = 0;
  const pending = new Map();
  const call = (name, args = {}) => new Promise(resolve => {
    calls.push(name);const callId = String(nextId++);pending.set(callId, resolve);listener({ requestId: 'request', callId, name, args });
  });
  class Session {
    async run({ prompt, onTool }) {
      prompts.push(prompt);
      return script({ call: async (name, args) => JSON.parse((await onTool(name, args)).content[0].text), attempt: attempt++ });
    }
    close() {}
  }
  const native = nativeLoop ? createNativeAgents({ loadSdk: async () => ({}), resolveExecutable: () => '/fixture', childEnv: () => ({}), CodexSession: Session }) : null;
  const api = {
    settingsGet: async () => ({ subagents: { [provider]: enabled }, subagentConcurrency: { [provider]: 6 } }),
    mcpTools: async () => ({ tools: [] }),
    onAgentNativeTool: fn => { listener = fn;return () => { listener = null; }; },
    agentNativeToolResult: async ({ callId, result }) => { pending.get(callId)(result);pending.delete(callId); },
    agentDelegateAnalysis: async () => { delegates++;return structuredClone(batch); },
    agentInspectFrames: async req => {
      captures.push(req);
      return { revision: req.revision, frames: req.times_sec.map(time_sec => ({ id: `frame-${time_sec}`, source: 'timeline', time_sec })) };
    },
    agentRunNative: async req => {
      assert.equal(req.tools.some(t => t.name === 'delegate_video_analysis'), enabled);
      if (enabled) assert.match(req.system, /explicitly asks to use subagents, honor that request/);
      if (!native) return { ok: true, ...await script({ call, attempt: 0 }) };
      return { ok: true, ...await native.run({ provider, model: 'fixture' }, { ...req, signal: new AbortController().signal,
        onTool: async (name, args) => ({ content: [{ type: 'text', text: JSON.stringify(await call(name, args)) }] }),
        isComplete: async () => (await call('__native_status')).ready,
      }) };
    },
  };
  try {
    const result = await runNativeAgent({ contents, ctx: { provider, api, getProject: () => state.present, dispatch: action => { state = historyReducer(state, action); }, settle: async () => {} },
      requestId: 'request', sessionKey: 'chat', onEvent: event => events.push(event), isCanceled: () => false });
    assert.equal(pending.size, 0);
    return { result, contents, events, calls, prompts, delegates, captures, unchanged: before === JSON.stringify(state.present) };
  } finally { native?.close(); }
}

// The reported failure: a final answer / unchanged proposal cannot silently
// satisfy an enabled delegation request on any native provider.
for (const provider of ['codex-sdk', 'claude-agent-sdk', 'opencode-sdk']) {
  const output = await run({ provider, script: async ({ call }) => {
    assert.equal((await call('__native_status')).ready, false);
    const complete = await call('complete_edit');
    assert.equal(complete.ready, false);assert.equal(complete.subagents_required, true);
    assert.match(complete.note, /before finishing or proposing the final plan/);
    return { text: 'The improvement plan is awaiting approval.' };
  } });
  assert.match(output.result.error?.error, /without completing edit validation/);
  assert.equal(output.delegates, 0);assert.equal(output.unchanged, true);
  checks.push(`${provider}: solo final answers and unchanged plans cannot bypass the delegation decision`);
}

// Real native retry machinery: the first solo answer is refused; the next turn
// gets corrective instructions, runs analysis and completes. Empty findings are valid.
{
  const output = await run({ nativeLoop: true, script: async ({ call, attempt }) => {
    if (!attempt) return { text: 'I reviewed the recap alone.' };
    assert.equal((await call('complete_edit')).subagents_required, true);
    const batch = await call('delegate_video_analysis', batchArgs);assert.equal(batch.ok, true);
    const complete = await call('complete_edit');assert.equal(complete.ready, true);
    assert.deepEqual(complete.subagents, { status: 'used', tasks_completed: 1 });
    return { text: 'Reviewed the returned analysis.' };
  } });
  assert.ok(!output.result.error, JSON.stringify(output.result));assert.equal(output.delegates, 1);
  assert.equal(output.prompts.length, 2);assert.match(output.prompts[1], /never silently replace them with solo work/);
  assert.equal(output.unchanged, true);assert.equal(output.result.text, 'Reviewed the returned analysis.');
  checks.push('native retries reject silent omission and accept a completed child even with no findings');
}

// A failed batch is not proof of use. A concrete fallback is persisted and
// displayed even if the model omits it from its final prose.
{
  const reason = 'The source index could not be opened, so analysis agents could not inspect the episode.';
  const output = await run({ batch: { ok: false, error: 'The source index could not be opened.' }, script: async ({ call }) => {
    assert.ok((await call('delegate_video_analysis', batchArgs)).error);
    assert.equal((await call('complete_edit')).subagents_required, true);
    assert.equal((await call('complete_edit', { subagent_skip: { status: 'unavailable', reason: '   ' } })).ready, false);
    assert.ok((await call('complete_edit', { subagent_skip: { status: 'used', reason } })).error);
    const complete = await call('complete_edit', { subagent_skip: { status: 'unavailable', reason } });
    assert.equal(complete.ready, true);assert.equal(complete.subagents.status, 'unavailable');
    return { text: 'Done.' };
  } });
  assert.ok(!output.result.error, JSON.stringify(output.result));assert.ok(output.result.text.includes(reason));
  assert.equal(output.contents.at(-1).parts[0].text, output.result.text);assert.equal(output.unchanged, true);
  checks.push('failed analysis cannot count as completed; a concrete limitation survives the final reply and saved chat');
}

for (const tasks of [[], [{ status: 'failed', error: 'Timed out.' }], [{ status: 'canceled' }], [{ status: 'completed', findings: [], reviewed_ranges: [] }]]) {
  const output = await run({ batch: { ok: true, partial: true, tasks }, script: async ({ call }) => {
    await call('delegate_video_analysis', batchArgs);
    assert.equal((await call('complete_edit')).subagents_required, true);
    return { text: 'Subagents reviewed the episode.' };
  } });
  assert.ok(output.result.error, 'empty, failed or canceled batches must not satisfy completion');
}
checks.push('empty, failed and canceled batches cannot be reported as completed child work');

{
  const reason = 'Only picture composition is being assessed; speech recognition is unavailable.';
  const output = await run({ batch: { ...completedBatch, evidence: { mode: 'visual_only', missing_speech: true, visual_only_reason: reason } }, script: async ({ call }) => {
    await call('delegate_video_analysis', batchArgs);const complete = await call('complete_edit');assert.equal(complete.ready, true);assert.equal(complete.subagents.missing_speech, true);
    return { text: 'Source review finished.' };
  } });
  assert.ok(!output.result.error);assert.ok(output.result.text.includes(reason));assert.match(output.result.text, /without complete speech coverage/);
  checks.push('degraded visual-only evidence is included in the saved final reply');
}

// Small non-analysis tasks can still run directly, but the skip is explicit.
{
  const reason = 'This request only changes caption styling; the source-analysis agents cannot edit captions.';
  const output = await run({ prompt: 'Make the captions bold.', script: async ({ call }) => {
    assert.equal((await call('complete_edit', { subagent_skip: { status: 'not_applicable', reason } })).ready, true);
    return { text: 'Ready.' };
  } });
  assert.ok(!output.result.error);assert.equal(output.delegates, 0);assert.ok(output.result.text.includes(reason));
  checks.push('unsupported analysis tasks have an explicit visible explanation without launching unnecessary children');
}

// Resolving delegation never resolves the independent edit/visual checks.
{
  const reason = 'This task only adds a title; source-analysis agents cannot edit text layers.';
  const output = await run({ prompt: 'Add a title.', script: async ({ call }) => {
    assert.ok(!(await call('add_text', { text: 'Episode recap', start_sec: 0, duration_sec: 2 })).error);
    assert.equal((await call('complete_edit')).subagents_required, true);
    let complete = await call('complete_edit', { subagent_skip: { status: 'not_applicable', reason } });
    assert.equal(complete.ready, false);assert.equal(complete.review_required, true);
    assert.equal((await call('__native_status')).ready, false);
    for (let i = 0; i < 6 && !complete.ready; i++) complete = await call('complete_edit');
    assert.equal(complete.ready, true);return { text: 'Title added.' };
  } });
  assert.ok(!output.result.error, JSON.stringify(output.result));assert.equal(output.unchanged, false);
  assert.ok(output.captures.length);assert.ok(output.result.text.includes(reason));
  checks.push('an acknowledged skip still requires normal edit validation and changed-region image checks');
}

// Turning delegation off retains the existing lightweight completion path.
{
  const output = await run({ enabled: false, prompt: 'Confirm the project is open.', script: async ({ call }) => {
    assert.equal((await call('__native_status')).ready, true);return { text: 'No change requested.' };
  } });
  assert.ok(!output.result.error);assert.equal(output.result.text, 'No change requested.');assert.equal(output.delegates, 0);
  checks.push('disabled delegation retains ordinary completion without enabling settings or starting children');
}

// Skip metadata remains bounded at the original host schema, even where native
// transports remove string-length keywords from the model's schema.
for (const provider of ['codex-sdk', 'claude-agent-sdk', 'opencode-sdk']) {
  const tools = nativeTools(provider, [], { subagents: true }).tools;
  assert.ok(validateToolCall({ name: 'complete_edit', args: { subagent_skip: { status: 'unavailable', reason: 'x'.repeat(1001) } } }, tools));
}
const evidence = { ok: true, checks };
if (process.env.SUBAGENT_COMPLETION_EVIDENCE) fs.writeFileSync(process.env.SUBAGENT_COMPLETION_EVIDENCE, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
