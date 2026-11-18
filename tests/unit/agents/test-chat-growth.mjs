// The saved CraftAI chat stays bounded over a long conversation, and a chat update does not clone every
// session (src/features/agent/chatSessions.js, context.js compactSavedContents):
// - only a recent tail of bulky tool results is kept whole; older ones become preview stubs with the same
//   shape as the request copy's, and recall_context says that only a preview was kept;
// - snapshotChatSessions reuses the copies of unchanged messages and contents;
// - the chat is serialized compact only (no unused indented copy).
// Prints size and per-update time before (whole-chat clone, all results kept) and after.
// Usage: node tests/unit/agents/test-chat-growth.mjs
import assert from 'node:assert/strict';
import { newChatSession, normalizeChatSessions, snapshotChatSessions } from '../../../src/features/agent/chatSessions.js';
import { compactSavedContents, prepareContext, recallContext } from '../../../src/features/agent/context.js';
import { createProjectSerializer } from '../../../src/state/projectSerialization.js';

const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };
const REQUESTS = 60, CALLS = 40;
// A project read of about 13 KB, like get_project on a mid-size project; most results are small.
const bigResult = (i) => ({ revision: `p:${i}`, main_track: Array.from({ length: 40 }, (_, k) => ({ id: `v${k}`, start_sec: k * 4, end_sec: k * 4 + 4, source: `clip-${k % 15}.mp4`, text: 'caption words '.repeat(12) })) });
const small = { ok: true, changed: true, revision: 'p:x' };
const session = newChatSession();
for (let r = 0; r < REQUESTS; r++) {
  session.contents.push({ role: 'user', parts: [{ text: `Request ${r}` }] });
  const steps = [];
  for (let c = 0; c < CALLS; c++) {
    const result = c % 10 < 3 ? bigResult(r * CALLS + c) : small;
    session.contents.push({ role: 'model', parts: [{ functionCall: { name: 'get_project', args: {} } }] }, { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result } } }] });
    steps.push({ type: 'tool', id: `s-${c}`, name: 'get_project', label: 'Reading the project', status: 'done' });
  }
  session.contents.push({ role: 'model', parts: [{ text: 'Done.' }] });
  session.messages.push({ role: 'user', text: `Request ${r}`, images: [], timelineAttachments: [] }, { role: 'assistant', text: 'Done.', steps });
}
const full = session.contents;
const compacted = compactSavedContents(full);
const sizeBefore = JSON.stringify(full).length, sizeAfter = JSON.stringify(compacted).length;
check('the saved conversation is bounded', sizeAfter < sizeBefore / 5 && sizeAfter < 2_000_000);
check('turn and part positions are unchanged', compacted.length === full.length && compacted.every((turn, i) => turn.parts.length === full[i].parts.length));
check('the newest results stay whole', compacted.at(-2) === full.at(-2) && JSON.stringify(compacted.slice(-30)) === JSON.stringify(full.slice(-30)));
const stubIndex = compacted.findIndex((turn) => turn.parts[0].functionResponse?.response?.result?.archived === 'saved');
const stub = compacted[stubIndex].parts[0].functionResponse.response.result;
check('an older result becomes a stub like the request copy\'s', stub.context_ref === `tool:${stubIndex}:0` && stub.tool === 'get_project' && stub.revision && stub.preview.length === 700 && stub.total_chars > 700);
const recalled = recallContext(compacted, { ref: stub.context_ref });
check('recall_context on a saved stub says only a preview was kept', /Only a preview/.test(recalled.error) && recalled.preview === stub.preview);
check('recall_context on a kept result still returns its exact data', recallContext(compacted, { ref: `tool:${compacted.length - 2}:0` }).total_chars === JSON.stringify(full.at(-2).parts[0].functionResponse.response.result).length);
check('compacting twice changes nothing', compactSavedContents(compacted) === compacted);
const stubTurn = compacted[stubIndex];
check('the request copy passes saved stubs through', prepareContext([compacted[0], compacted[stubIndex - 1], stubTurn, { role: 'model', parts: [{ text: 'Done.' }] }, { role: 'user', parts: [{ text: 'next' }] }]).contents[2] === stubTurn);
check('loading an old file compacts it', JSON.stringify(normalizeChatSessions({ sessions: [{ ...session, contents: full }] }).sessions[0].contents).length === sizeAfter);

// Per-update cost: the old snapshot cloned the whole chat; the new one reuses unchanged copies.
const legacySnapshot = (chat) => JSON.parse(JSON.stringify({ ...chat, sessions: chat.sessions.map((s) => ({ ...s, messages: s.messages.map(({ changed, ...m }) => m) })) }));
const time = (fn, n = 5) => { fn(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - t0) / n; };
const before = { version: 1, sessions: [{ ...session, contents: full }], activeSessionId: session.id };
let chat = { version: 1, sessions: [{ ...session, contents: compacted }], activeSessionId: session.id };
const first = snapshotChatSessions(chat);
// One chat event: the last message gets a new step (a new message object, as CraftPilot's updateLast makes).
const update = (i) => {
  const s = chat.sessions[0], last = s.messages.at(-1);
  chat = { ...chat, sessions: [{ ...s, messages: [...s.messages.slice(0, -1), { ...last, steps: [...last.steps, { type: 'tool', id: `n-${i}`, name: 'x', label: 'x', status: 'done' }] }] }] };
  return snapshotChatSessions(chat);
};
const second = update(-1);
check('unchanged messages and contents reuse their copies', second.sessions[0].contents === first.sessions[0].contents && second.sessions[0].messages[0] === first.sessions[0].messages[0]);
check('the changed message is copied again', second.sessions[0].messages.at(-1) !== first.sessions[0].messages.at(-1) && second.sessions[0].messages.at(-1).steps.length === CALLS + 1);
check('the copy is detached from the live chat', second.sessions[0].contents !== chat.sessions[0].contents && second.sessions[0].messages[0] !== chat.sessions[0].messages[0]);
const msBefore = time(() => legacySnapshot(before)), msAfter = time((i) => update(i));
check('a chat update costs far less than cloning the whole chat', msAfter < msBefore / 5);

// The chat sidecar is serialized compact only.
const posted = [];
const fakeWorker = {};
const serialize = createProjectSerializer(() => { fakeWorker.postMessage = (message) => { posted.push(message); setImmediate(() => fakeWorker.onmessage({ data: { id: message.id, value: message.pretty ? { compact: 'c', pretty: 'p' } : { compact: 'c' } } })); }; fakeWorker.terminate = () => {}; return fakeWorker; });
const chatOut = await serialize(first, { pretty: false }), docOut = await serialize({ doc: true });
check('the chat is posted without the indented copy, documents with it', posted[0].pretty === false && !('pretty' in chatOut) && posted[1].pretty === true && docOut.pretty === 'p');
console.log(`chat growth OK: ${checks.length} checks`);
console.log(`saved contents ${(sizeBefore / 1e6).toFixed(2)} MB -> ${(sizeAfter / 1e6).toFixed(2)} MB; per chat update ${msBefore.toFixed(1)} ms (whole-chat clone) -> ${msAfter.toFixed(2)} ms`);
