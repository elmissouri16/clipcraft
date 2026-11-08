import assert from 'node:assert/strict';
import { emptyProject, normalizeProject, historyReducer } from "../../../src/state/store.js";
import { newChatSession, normalizeChatSessions, normalizeMessageQueue, snapshotChatSessions, hasChatContent } from "../../../src/features/agent/chatSessions.js";

const project = emptyProject();
assert.deepEqual(normalizeProject(project).craftAI.sessions, [], 'older projects need no migration');
assert.deepEqual(normalizeChatSessions({ sessions: [null, {}, { id: 3 }] }).sessions, []);
assert.equal(normalizeChatSessions({ sessions: [{ id: 'old-style', style: 'meme', draft: 'Keep my request' }] }).sessions[0].style, undefined, 'retired preset selections are dropped from older projects');
assert.equal(normalizeChatSessions({ sessions: [{ id: 'old-style', style: 'meme', draft: 'Keep my request' }] }).sessions[0].draft, 'Keep my request');
const first = newChatSession();
first.messages = [{ role: 'user', text: 'Remember violet' }, { role: 'assistant', text: 'Remembered', changed: true,
  contextUsage: { requests: 2, inputChars: 4000, avoidedChars: 2000, tools: 7, abbreviated: 1 } }];
first.contents = [{ role: 'user', parts: [{ text: 'Remember violet' }] },
  { role: 'model', parts: [{ functionCall: { name: 'get_project', args: {} } }] },
  { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: { changed: 'keep tool data' } } } }] },
  { role: 'model', parts: [{ text: 'Remembered' }] }];
first.draft = 'Continue later';
const second = newChatSession();
let chat = { version: 1, activeSessionId: second.id, sessions: [first, second] };
const saved = snapshotChatSessions(chat);
assert.equal(saved.sessions[0].messages[1].changed, undefined, 'no invalid Undo button after reopening');
assert.equal(saved.sessions[0].contents[2].parts[0].functionResponse.response.result.changed, 'keep tool data');
first.contents.push({ role: 'user', parts: [{ text: 'unsaved in-flight turn' }] });
assert.equal(saved.sessions[0].contents.length, 4, 'live agent mutations cannot change saved context');
assert.equal(hasChatContent({ craftAI: saved }), true, 'chat-only projects earn autosave slots');
assert.equal(hasChatContent({ craftAI: { sessions: [second] } }), false);
const queueOnly = newChatSession();
queueOnly.queue = [{ id: 'q1', text: '  First queued edit  ', timelineAttachments: [] }, { id: 'q2', text: 'Second queued edit' }];
assert.equal(hasChatContent({ craftAI: { sessions: [queueOnly] } }), true, 'queued instructions earn an autosave slot');
const restoredQueue = normalizeChatSessions(snapshotChatSessions({ sessions: [queueOnly], activeSessionId: queueOnly.id })).sessions[0];
assert.equal(restoredQueue.queuePaused, true, 'saved instructions require explicit resume after loading');
assert.deepEqual(restoredQueue.queue.map(item => item.text), ['First queued edit', 'Second queued edit'], 'queue order survives saving');
assert.equal(queueOnly.queuePaused, false, 'normalizing saved queue does not pause the live instance');
assert.deepEqual(normalizeMessageQueue([null, {}, { id: 'a', text: '  ' }, { id: 9, text: 'bad id' }, { id: 'a', text: 'keep' }, { id: 'a', text: 'duplicate' }]), [{ id: 'a', text: 'keep', timelineAttachments: [] }]);
const roundtrip = normalizeChatSessions(JSON.parse(JSON.stringify(saved)));
assert.deepEqual(roundtrip.sessions[0].contents, saved.sessions[0].contents);
assert.equal(roundtrip.sessions[0].draft, first.draft);
assert.equal(roundtrip.activeSessionId, second.id);
assert.deepEqual(roundtrip.sessions[0].messages[1].contextUsage, first.messages[1].contextUsage, 'context estimates survive project reopen');
assert.deepEqual(normalizeChatSessions(roundtrip), roundtrip);

let state = { past: [], present: project, future: [] };
const apply = (a) => { state = historyReducer(state, a); };
apply({ type: 'setProject', patch: { name: 'Edited' } });
apply({ type: 'craftChat', projectId: project.id, chat: saved });
assert.equal(state.past.length, 1, 'chat changes do not consume Undo');
apply({ type: 'undo' });
assert.equal(state.present.name, 'Untitled');
assert.deepEqual(state.present.craftAI, saved, 'timeline Undo keeps chats');
const next = { ...saved, activeSessionId: first.id };
apply({ type: 'craftChat', projectId: project.id, chat: next });
apply({ type: 'redo' });
assert.deepEqual(state.present.craftAI, next, 'Redo keeps active chat selection');
apply({ type: 'beginGesture' });
apply({ type: 'craftChat', projectId: project.id, chat: saved });
apply({ type: 'setProject', patch: { name: 'Dragged' }, transient: true });
apply({ type: 'endGesture' });
apply({ type: 'undo' });
assert.deepEqual(state.present.craftAI, saved, 'gesture history retains conversations');
const before = state;
apply({ type: 'craftChat', projectId: 'another-project', chat: next });
assert.equal(state, before, 'late chat updates cannot reach another project');

const pending = snapshotChatSessions(saved);
pending.sessions[0].messages.push({ role: 'user', text: 'Unfinished request' },
  { role: 'assistant', text: '', pending: true, steps: [{ id: '0-0', label: 'Reading the project', status: 'running' }] });
const restored = normalizeProject(JSON.parse(JSON.stringify({ ...project, craftAI: pending })));
const interrupted = restored.craftAI.sessions[0];
assert.match(interrupted.messages.at(-1).text, /Interrupted/);
assert.equal(interrupted.messages.at(-1).pending, undefined);
assert.equal(interrupted.messages.at(-1).steps[0].status, 'error');
assert.equal(interrupted.contents.length, 4, 'only completed context survives interruption');
assert.equal(restored.craftAI.activeSessionId, second.id);
apply({ type: 'load', project: { ...emptyProject(), name: 'Other' } });
assert.equal(state.present.craftAI.sessions.length, 0, 'projects have separate sessions');
console.log('chat sessions ok (legacy files, context snapshots, interrupted runs, project isolation, Undo/Redo)');
const recovery = newChatSession();
recovery.messages = [{ role: 'assistant', text: '', error: { error: 'The project changed during this request.', code: 'edit_interrupted', interruption: { token: 'private-owner-token', action: 'setProject', track: 'video', fields: ['name'], patch: { name: 'Do not save diagnostic content' } } } }];
const savedRecovery = normalizeChatSessions(snapshotChatSessions({ sessions: [recovery], activeSessionId: recovery.id })).sessions[0].messages[0].error;
assert.equal(savedRecovery.code, 'edit_interrupted');
assert.deepEqual(savedRecovery.interruption, { action: 'setProject', track: 'video', fields: ['name'] });
assert.ok(!JSON.stringify(savedRecovery).includes('private-owner-token') && !JSON.stringify(savedRecovery).includes('Do not save diagnostic content'));
for (const code of ['edit_timeout','edit_limit']) {
  recovery.messages[0].error={error:'Completed edits were kept.',code};
  const restored=normalizeChatSessions(snapshotChatSessions({sessions:[recovery],activeSessionId:recovery.id}));
  assert.equal(restored.sessions[0].messages[0].error.code,code,'saved timeout/limit messages retain their recovery action');
}
