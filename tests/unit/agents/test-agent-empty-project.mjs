// An empty (or silent) project must not trap the agent: asking for something new ("create a chart of
// US state populations") on an empty timeline once ended in "The native agent ended without
// completing editor validation", because log_footage/transcribe failed with "No audible clips" and
// the completion gate waited for a retry that could never succeed. Then, after that error, the plan
// the agent had proposed was dropped from the conversation, so "Approved" reached an agent that had
// never seen it.
// Usage: node tests/unit/agents/test-agent-empty-project.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { runAgent } from '../../../src/features/agent/runAgent.js';
import { runNativeAgent } from '../../../src/features/agent/runNativeAgent.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { proposedPlanNote } from '../../../src/features/agent/context.js';

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const SILENT = 'No audible clips in the selected all source. Check mute, solo, hidden layers and clip selection.';
const PLAN = { goal: 'Animated chart of US state populations', hook: 'California alone outnumbers 21 states', story: [{ beat: 'Bars grow state by state' }] };
const fixture = () => {
  let state = { past: [], present: emptyProject(), future: [] };
  return { getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, settle: async () => {},
    api: { runCaptions: async () => ({ ok: false, error: SILENT }), mcpTools: async () => ({ ok: true, tools: [] }) } };
};

await check('nothing audible is an answer, not a failed operation', async () => {
  const runner = createToolRunner({ ...fixture(), requestId: 'empty' });
  const t = await runner.run('transcribe', {});
  assert.equal(t.error, SILENT); assert.equal(t.not_applicable, true);
  const log = await runner.run('log_footage', {});
  assert.ok(!log.error, JSON.stringify(log)); assert.equal(log.sentences_total, 0); assert.match(log.note, /empty/);
});

await check('native agent: an empty project with a proposed plan completes', async () => {
  const ctx = fixture(); let listener;
  const results = new Map();
  ctx.provider = 'codex-sdk';
  Object.assign(ctx.api, {
    onAgentNativeTool: (cb) => { listener = cb; return () => {}; }, agentCancel: async () => {},
    agentNativeToolResult: async (r) => results.get(r.callId)?.(r),
    agentRunNative: async () => {
      // The provider's tool calls, in the order of the failed run: footage, transcript, plan, status.
      const call = (callId, name, args = {}) => new Promise((resolve) => { results.set(callId, resolve); listener({ requestId: 'native-empty', callId, name, args }); });
      for (const [id, name, args] of [['1', 'get_project', {}], ['2', 'log_footage', {}], ['3', 'transcribe', {}], ['4', 'propose_edit_plan', PLAN]]) {
        const r = await call(id, name, args); assert.ok(r, name);
      }
      const status = await call('5', '__native_status');
      return status.result?.ready ? { ok: true, text: 'Here is the plan. Approve?' } : { ok: false, error: 'The native agent ended without completing editor validation. Completed changes were kept.' };
    },
  });
  const out = await runNativeAgent({ contents: [], ctx, requestId: 'native-empty', sessionKey: 'empty', isCanceled: () => false, onEvent() {} });
  assert.ok(!out.error && out.ok !== false, JSON.stringify(out.error || out));
});

await check('API agent: the same turn finishes instead of erroring', async () => {
  const ctx = fixture(); let n = 0;
  const reply = (calls) => ({ ok: true, calls, text: calls.length ? '' : 'Here is the plan. Approve?', content: { role: 'model', parts: calls.length ? calls.map((functionCall) => ({ functionCall })) : [{ text: 'Here is the plan. Approve?' }] } });
  ctx.api.agentStep = async () => [reply([{ name: 'load_tools', args: { groups: ['editorial', 'text'] } }]), reply([{ name: 'transcribe', args: {} }]),
    reply([{ name: 'propose_edit_plan', args: PLAN }]), reply([])][n++];
  const out = await runAgent({ contents: [], ctx, requestId: 'api-empty', onEvent() {}, isCanceled: () => false });
  assert.ok(!out.error, JSON.stringify(out.error)); assert.match(out.text, /plan/);
});

await check('the proposed plan survives the recovery checkpoint', () => {
  const entries = [{ role: 'model', parts: [{ functionCall: { name: 'propose_edit_plan', args: PLAN } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'propose_edit_plan', response: { result: { ok: true, status: 'awaiting_approval', plan: PLAN } } } }] }];
  const note = proposedPlanNote(entries);
  assert.match(note, /carry out exactly this plan/); assert.ok(note.includes(PLAN.hook));
  assert.equal(proposedPlanNote([{ role: 'user', parts: [{ text: 'hi' }] }]), '');
});

console.log(`${checks.length} empty-project agent checks passed`);
