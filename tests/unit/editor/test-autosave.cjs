// Per-project autosave store (electron/project/autosave.cjs): per-id write/read roundtrip, index
// ordering (newest first), rewrite dedupe, cap eviction (oldest out, just-written kept),
// delete, file binding lookup, id sanitization, and index rebuild after loss.
// Usage: node tests/unit/editor/test-autosave.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require("../../../electron/project/autosave.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-autosave-'));
const rec = (id, title, updatedAt, extra = {}) => ({
  id, title, file: null, ratio: '16:9', thumb: null, updatedAt,
  projectJson: JSON.stringify({ id, name: title, media: [], videoClips: [] }),
  ...extra,
});

{
  const root = tmp();
  // write/read roundtrip
  const e = store.writeSlot(root, rec('p1', 'Alpha', 1000));
  assert.equal(e.id, 'p1');
  assert.equal(e.title, 'Alpha');
  const slot = store.readSlot(root, 'p1');
  assert.equal(slot.project.name, 'Alpha');
  assert.equal(slot.file, null);
  assert.ok(fs.existsSync(path.join(root, 'p1.json')));

  // index ordering: newest first; a rewrite moves the entry and does not duplicate it
  store.writeSlot(root, rec('p2', 'Beta', 2000));
  store.writeSlot(root, rec('p3', 'Gamma', 3000));
  assert.deepEqual(store.listSlots(root).map((x) => x.id), ['p3', 'p2', 'p1']);
  store.writeSlot(root, rec('p1', 'Alpha II', 4000));
  const list = store.listSlots(root);
  assert.deepEqual(list.map((x) => x.id), ['p1', 'p3', 'p2']);
  assert.equal(list[0].title, 'Alpha II');
  assert.equal(store.readSlot(root, 'p1').project.name, 'Alpha II');

  // binding by file path
  store.writeSlot(root, rec('p9', 'Filed', 5000, { file: '/work/filed.clipcraft.json' }));
  assert.equal(store.slotForFile(root, '/work/filed.clipcraft.json')?.id, 'p9');
  assert.equal(store.slotForFile(root, '/work/other.json'), null);
  assert.equal(store.slotForFile(root, null), null);

  // delete removes the slot file and its index entry
  assert.equal(store.deleteSlot(root, 'p2'), true);
  assert.equal(store.readSlot(root, 'p2'), null);
  assert.ok(!store.listSlots(root).some((x) => x.id === 'p2'));
  assert.equal(store.deleteSlot(root, 'p2'), false);

  // corrupt project JSON is refused, nothing is written
  assert.equal(store.writeSlot(root, { id: 'bad', title: 'Bad', projectJson: '{nope', updatedAt: 1 }), null);
  assert.equal(store.readSlot(root, 'bad'), null);

  // id sanitization: path escapes are rejected outright
  assert.equal(store.writeSlot(root, rec('../evil', 'Evil', 1)), null);
  assert.equal(store.readSlot(root, '../evil'), null);
  assert.equal(store.slotPath(root, 'a/b'), null);
  assert.ok(!fs.existsSync(path.join(root, "../../..", 'evil.json')));

  // index loss: listSlots rebuilds from the slot files
  fs.unlinkSync(path.join(root, 'index.json'));
  assert.deepEqual(store.listSlots(root).map((x) => x.id), ['p9', 'p1', 'p3']);
}

{
  // Cap eviction: beyond CAP the oldest slots go; the just-written one always stays,
  // even when it is itself the oldest by timestamp (rewriting an old project).
  const root = tmp();
  for (let i = 0; i < store.CAP + 3; i++) store.writeSlot(root, rec(`c${i}`, `P${i}`, 1000 + i));
  let list = store.listSlots(root);
  assert.equal(list.length, store.CAP);
  assert.ok(!list.some((x) => x.id === 'c0'));
  assert.ok(!fs.existsSync(path.join(root, 'c0.json')));
  assert.ok(list.some((x) => x.id === `c${store.CAP + 2}`));
  // Rewrite the current oldest survivor with an OLD timestamp: it must not evict itself.
  const oldest = list[list.length - 1].id;
  store.writeSlot(root, rec(oldest, 'Still here', 1));
  list = store.listSlots(root);
  assert.ok(list.some((x) => x.id === oldest));
  assert.equal(list.length, store.CAP);
}

console.log('AUTOSAVE OK');

// ---- The chat beside a slot (docs/architecture/project-file.md) ----
{
  const root = tmp();
  const chat = JSON.stringify({ version: 1, sessions: [{ id: 's1', messages: [{ role: 'user', text: 'Hi' }] }], activeSessionId: 's1' });
  // A record without chatJson keeps whatever chat is stored (none yet).
  store.writeSlot(root, rec('c1', 'Chat slot', 1));
  assert.equal(store.readSlot(root, 'c1').project.craftAI, undefined, 'no chat stored: the document is read as is');
  // chatJson lands in <root>/chat/<id>.json, never inside the document, and reads back merged.
  store.writeSlot(root, rec('c1', 'Chat slot', 2, { chatJson: chat }));
  assert.ok(fs.existsSync(store.chatPath(root, 'c1')), 'the chat is a file beside the slot');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'c1.json'), 'utf8')).project.craftAI, undefined, 'the slot document holds no chat');
  assert.equal(store.readSlot(root, 'c1').project.craftAI.activeSessionId, 's1', 'readSlot merges the chat into craftAI');
  // A document-only rewrite (no chatJson) keeps the stored chat.
  store.writeSlot(root, rec('c1', 'Chat slot renamed', 3));
  assert.equal(store.readSlot(root, 'c1').project.craftAI.activeSessionId, 's1', 'a record without chatJson keeps the chat');
  assert.equal(store.readSlot(root, 'c1').project.name, 'Chat slot renamed', 'and the document is updated');
  // The chat on its own, for chat-only changes; null removes it.
  store.writeSlotChat(root, 'c1', chat.replaceAll('s1', 's2'));
  assert.equal(store.readSlot(root, 'c1').project.craftAI.activeSessionId, 's2', 'writeSlotChat replaces the chat alone');
  assert.ok(!fs.existsSync(`${store.chatPath(root, 'c1')}.part`), 'chat writes are atomic');
  store.writeSlotChat(root, 'c1', null);
  assert.ok(!fs.existsSync(store.chatPath(root, 'c1')), 'null removes the chat file');
  assert.equal(store.writeSlotChat(root, '../evil', chat), false, 'a hostile id never leaves the store');
  // A legacy slot that embeds craftAI still reads, and a sidecar wins over it.
  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ id: 'legacy', title: 'Legacy', updatedAt: 4, project: { id: 'legacy', craftAI: { version: 1, sessions: [], activeSessionId: null } } }));
  assert.equal(store.readSlot(root, 'legacy').project.craftAI.sessions.length, 0, 'an embedded legacy chat reads as before');
  store.writeSlotChat(root, 'legacy', chat);
  assert.equal(store.readSlot(root, 'legacy').project.craftAI.sessions.length, 1, 'the sidecar wins over the embedded chat');
  // ...unless the slot (written by an older app) is newer than the chat file.
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(store.chatPath(root, 'legacy'), past, past);
  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ id: 'legacy', title: 'Legacy', updatedAt: 5, project: { id: 'legacy', craftAI: { version: 1, sessions: [], activeSessionId: null } } }));
  assert.equal(store.readSlot(root, 'legacy').project.craftAI.sessions.length, 0, 'an embedded chat in a newer slot wins over an older chat file');
  // Delete and cap eviction take the chat with them; the chat folder never pollutes the index.
  store.deleteSlot(root, 'legacy');
  assert.ok(!fs.existsSync(store.chatPath(root, 'legacy')), 'deleteSlot removes the chat too');
  store.writeSlotChat(root, 'c1', chat);
  for (let i = 0; i < store.CAP; i++) store.writeSlot(root, rec(`fill${i}`, `Fill ${i}`, 100 + i));
  assert.ok(!fs.existsSync(store.chatPath(root, 'c1')), 'eviction removes the evicted slot\'s chat');
  fs.unlinkSync(path.join(root, 'index.json'));
  assert.ok(store.listSlots(root).every((e) => !e.id.startsWith('chat')), 'the index rebuild ignores the chat folder');
  console.log('AUTOSAVE CHAT OK');
}
