// Shared editor loop: SDK turns use the same tools/history and stop semantics as APIs.
import assert from 'node:assert/strict';
import { runAgent } from '../src/agent/runAgent.js';
import { emptyProject, historyReducer } from '../src/store.js';

const makeContext = (step) => {
  let state = { past: [], present: emptyProject(), future: [] };
  const events = [];
  const calls = [];
  return {
    events, calls, state: () => state,
    ctx: { getProject: () => state.present,
      dispatch: (action) => { state = historyReducer(state, action); }, settle: async () => {},
      api: { mcpTools: async () => ({ ok: true, tools: [] }), agentStep: async (request) => {
        calls.push(structuredClone(request)); return step(calls.length, request);
      } },
    },
  };
};
const toolTurn = { ok: true, provider: 'codex-sdk', text: '', calls: [{ name: 'set_project', args: { name: 'SDK edit' } }],
  content: { role: 'model', parts: [{ functionCall: { name: 'set_project', args: { name: 'SDK edit' } } }] } };
const conversation = () => [{ role: 'user', parts: [{ text: 'Rename my project' }] }];
const first = makeContext((n) => n === 1 ? toolTurn : { ok: true, provider: 'codex-sdk', text: 'Done.', calls: [], content: { role: 'model', parts: [{ text: 'Done.' }] } });
let result = await runAgent({ contents: conversation(), ctx: first.ctx, onEvent: (e) => first.events.push(e), isCanceled: () => false, requestId: 'one-run' });
assert.equal(result.changed, true);
assert.equal(first.state().present.name, 'SDK edit');
assert.equal(first.calls[0].requestId, 'one-run');
assert.equal(first.calls[1].requestId, 'one-run');
assert.equal(first.calls[1].provider, 'codex-sdk');
assert.equal(first.calls[1].contents.at(-1).parts[0].functionResponse.name, 'set_project');
assert.ok(first.events.some((e) => e.status === 'done'));
first.ctx.dispatch({ type: 'undo' });
assert.equal(first.state().present.name, 'Untitled');

const partial = makeContext((n) => n === 1 ? toolTurn : { ok: false, error: 'Provider failed' });
result = await runAgent({ contents: conversation(), ctx: partial.ctx, onEvent: () => {}, isCanceled: () => false });
assert.equal(result.changed, true, 'completed edits remain undoable after a later provider error');
assert.equal(result.error.error, 'Provider failed');
for (const response of [{ ok: false, canceled: true }, toolTurn]) {
  let stopped = false;
  const cancel = makeContext(() => { stopped = response === toolTurn; return response; });
  result = await runAgent({ contents: conversation(), ctx: cancel.ctx, onEvent: () => {}, isCanceled: () => stopped });
  assert.equal(result.canceled, true);
  assert.equal(cancel.state().present.name, 'Untitled', 'a canceled response cannot apply a tool');
}
console.log('agent runner ok (shared tool results, provider continuity, Undo, partial errors, cancellation)');
