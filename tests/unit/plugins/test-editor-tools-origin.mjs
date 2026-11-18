// Edits an extension makes through context.editor.tools.run are its own in history and project
// events ({ kind: 'extension', extensionId }), so it can tell them from other edits (the check in
// docs/design/plugin-extension-api.md, section 3.10). CraftAI's own edits stay 'agent'.
// Usage: node tests/unit/plugins/test-editor-tools-origin.mjs
import assert from 'node:assert/strict';
globalThis.window = { api: {} };
const { emptyProject, historyReducer, historyOrigin } = await import('../../../src/state/store.js');
const { createExtensionEditorTools } = await import('../../../src/features/plugins/extensionEditorTools.js');

let state = historyReducer({ past: [], present: emptyProject(), future: [] }, { type: 'load', project: { ...emptyProject(),
  media: [{ id: 'm1', type: 'video', duration: 30, hasAudio: true, width: 1920, height: 1080, path: '/x.mp4' }],
  videoClips: [{ id: 'A', mediaId: 'm1', in: 0, out: 30, speed: 1 }] } });
const app = {
  screen: () => 'editor', project: () => state.present, loadVersion: () => 0, craftBusy: () => false,
  dispatch: (action) => { state = historyReducer(state, action); }, settle: async () => {},
  pilotApp: { getAgentEdit: () => state.agentEdit, getAgentInterruption: () => state.agentInterruption },
};
const tools = createExtensionEditorTools(() => app);
const result = await tools.run({ calls: [{ name: 'add_text', args: { text: 'Hello', start_sec: 2, duration_sec: 1 } }] }, undefined, 'acme.styler');
assert.equal(result.changed, true, 'the run edited the project');
assert.deepEqual(historyOrigin(state).source, { kind: 'extension', extensionId: 'acme.styler' }, 'the run is attributed to the calling extension');
assert.equal(state.agentEdit, undefined, 'the run closed its edit');

// A failing atomic run rolls back as the extension's own step too.
await assert.rejects(tools.run({ calls: [{ name: 'add_text', args: { text: 'Kept?', start_sec: 4, duration_sec: 1 } }, { name: 'delete_clip', args: { clip_id: 'missing' } }] }, undefined, 'acme.styler'));
assert.deepEqual(historyOrigin(state).source, { kind: 'extension', extensionId: 'acme.styler' }, 'the rollback is attributed to the extension');

// A CraftAI edit (no extension source) stays an agent edit; a forged source on an edit is ignored.
state = historyReducer(state, { type: 'beginAgentEdit', token: 'craft' });
state = historyReducer(state, { type: 'addText', clipId: 'c', at: 9, agentToken: 'craft' });
assert.deepEqual(historyOrigin(state).source, { kind: 'agent' });
state = historyReducer(state, { type: 'endAgentEdit', token: 'craft' });
state = historyReducer(state, { type: 'addText', clipId: 'u', at: 12, source: { kind: 'extension', extensionId: 'forged' } });
assert.deepEqual(historyOrigin(state).source, { kind: 'user' });
console.log('Editor tool runs are attributed to the calling extension; agent and user edits keep their origin');
