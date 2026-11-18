// An outside agent's edit offers "Undo these changes" (edit-end undoable) only while it still owns the
// agent transaction when it closes. After a manual edit the agent's changes are no longer the top Undo
// step, so that Undo would revert the user's own change. Drives the real reducer and external host.
// Usage: node tests/unit/agents/test-external-undo-offer.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { createExternalHost } from '../../../src/features/agent/externalHost.js';

globalThis.window = { api: { agentCancel: async () => {}, externalProgress: () => {} } };
const project = { ...emptyProject(), media: [{ id: 'm', name: 'talk', type: 'video', duration: 20, width: 1920, height: 1080 }],
  videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }], textClips: [{ id: 't1', text: 'Hello', start: 0, duration: 3, layer: 0 }] };
const session = () => {
  let s = { past: [], future: [], present: project };
  const events = [], dispatch = (a) => { s = historyReducer(s, a); };
  const host = createExternalHost({ screen: () => 'editor', project: () => s.present, loadVersion: () => 1, dispatch, settle: async () => {},
    pilotApp: { getAgentEdit: () => s.agentEdit, getAgentInterruption: () => s.agentInterruption, getEditorState: () => ({ playhead_sec: 0, selection: null, playing: false }) },
    provider: () => 'external', craftBusy: () => false, projects: { status: () => ({}) }, onActivity: (e) => events.push(e) });
  return { host, dispatch, events, get s() { return s; } };
};
const text = (x) => x.s.present.textClips[0];

// The user edits after the agent: the edit closes with its changes kept but no Undo offer.
const a = session();
await a.host.call({ callId: 'c0', name: 'get_status', args: {}, client: { name: 'Claude Code' } });
assert.ok(!(await a.host.call({ callId: 'c1', name: 'edit_text', args: { clip_id: 't1', text: 'Agent title' } })).error);
a.dispatch({ type: 'update', track: 'text', id: 't1', patch: { size: 120 } });
await a.host.release();
let end = a.events.findLast((e) => e.type === 'edit-end');
assert.equal(end.changed, true, 'the agent did change the project');
assert.equal(end.undoable, false, 'no Undo offer once a manual edit took the top of the history');
assert.equal(text(a).text, 'Agent title');assert.equal(text(a).size, 120);

// Nothing else happened: the edit still owns the transaction, its Undo reverts exactly the agent's change.
const b = session();
await b.host.call({ callId: 'c0', name: 'get_status', args: {}, client: { name: 'Claude Code' } });
await b.host.call({ callId: 'c1', name: 'edit_text', args: { clip_id: 't1', text: 'Agent title' } });
await b.host.release();
end = b.events.findLast((e) => e.type === 'edit-end');
assert.equal(end.changed, true);assert.equal(end.undoable, true, 'the agent edit is the top Undo step');
b.dispatch({ type: 'undo' });
assert.equal(text(b).text, 'Hello', 'Undo these changes reverts the agent edit');
console.log('external undo offer ok: offered only while the edit owns the agent transaction at close');
