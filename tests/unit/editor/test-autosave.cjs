// Per-project autosave store (electron/project/autosave.cjs): per-id write/read roundtrip, index
// ordering (newest first), rewrite dedupe, cap eviction (oldest file-backed out, unsaved and
// just-written kept), file stamps (a file changed after its slot is detected),
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
  // Cap eviction: beyond CAP the oldest file-backed slots go; the just-written one always stays,
  // even when it is itself the oldest by timestamp (rewriting an old project).
  const root = tmp();
  const filed = (id) => { const f = path.join(root, `${id}.clipcraft.json`); fs.writeFileSync(f, '{}'); return { file: f }; };
  for (let i = 0; i < store.CAP + 3; i++) store.writeSlot(root, rec(`c${i}`, `P${i}`, 1000 + i, filed(`c${i}`)));
  let list = store.listSlots(root);
  assert.equal(list.length, store.CAP);
  assert.ok(!list.some((x) => x.id === 'c0'));
  assert.ok(!fs.existsSync(path.join(root, 'c0.json')));
  assert.ok(list.some((x) => x.id === `c${store.CAP + 2}`));
  // Rewrite the current oldest survivor with an OLD timestamp: it must not evict itself.
  const oldest = list[list.length - 1].id;
  store.writeSlot(root, rec(oldest, 'Still here', 1, filed(oldest)));
  list = store.listSlots(root);
  assert.ok(list.some((x) => x.id === oldest));
  assert.equal(list.length, store.CAP);
}

{
  // A slot without a file is the only copy of that project: eviction takes file-backed slots
  // first and never an unsaved one, nor one whose file has gone, even past the cap.
  const root = tmp();
  store.writeSlot(root, rec('draft', 'Unsaved draft', 1));
  store.writeSlot(root, rec('orphan', 'File deleted', 2, { file: path.join(root, 'gone.clipcraft.json') }));
  for (let i = 0; i < store.CAP + 2; i++) {
    const f = path.join(root, `s${i}.clipcraft.json`); fs.writeFileSync(f, '{}');
    store.writeSlot(root, rec(`s${i}`, `Saved ${i}`, 100 + i, { file: f }));
  }
  let list = store.listSlots(root);
  assert.ok(list.some((x) => x.id === 'draft') && fs.existsSync(store.slotPath(root, 'draft')), 'the unsaved draft survives the cap');
  assert.ok(list.some((x) => x.id === 'orphan'), 'a slot whose file is gone survives the cap');
  assert.equal(list.length, store.CAP, 'file-backed slots were evicted to make room');
  assert.ok(!list.some((x) => x.id === 's0') && !list.some((x) => x.id === 's3'), 'the oldest file-backed slots went first');
  // Only unsaved slots left beyond the cap: nothing is evicted.
  for (let i = 0; i < store.CAP + 2; i++) store.writeSlot(root, rec(`u${i}`, `Unsaved ${i}`, 1000 + i));
  list = store.listSlots(root);
  assert.ok(Array.from({ length: store.CAP + 2 }, (_, i) => `u${i}`).every((id) => list.some((x) => x.id === id)), 'every unsaved slot is kept');
  assert.ok(list.some((x) => x.id === 'draft'));
  assert.ok(!list.some((x) => x.file && fs.existsSync(x.file)), 'all file-backed slots were evicted before any unsaved one');
}

{
  // A file-backed slot records its file's identity; a file changed after the slot was written
  // (another computer, an outside tool) is reported so the file opens instead of the stale slot.
  const root = tmp();
  const file = path.join(root, 'trip.clipcraft.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'p1', videoClips: [{ id: 'c1' }] }));
  store.writeSlot(root, rec('p1', 'Trip', Date.now(), { file }));
  let slot = store.readSlot(root, 'p1');
  assert.deepEqual(slot.fileStamp, { mtimeMs: fs.statSync(file).mtimeMs, size: fs.statSync(file).size }, 'the slot records the file stamp');
  assert.equal(store.fileChangedSince(slot), false, 'an unchanged file keeps the slot');
  fs.writeFileSync(file, JSON.stringify({ id: 'p1', videoClips: [{ id: 'c1' }, { id: 'c2-made-elsewhere' }] }));
  assert.equal(store.fileChangedSince(store.readSlot(root, 'p1')), true, 'a changed file is detected');
  // Same size, different time is a change too.
  store.writeSlot(root, rec('p1', 'Trip', Date.now(), { file }));
  assert.equal(store.fileChangedSince(store.readSlot(root, 'p1')), false, 'rewriting the slot records the new stamp');
  const later = new Date(Date.now() + 5000); fs.utimesSync(file, later, later);
  assert.equal(store.fileChangedSince(store.readSlot(root, 'p1')), true, 'a new modification time alone is a change');
  // A slot written before stamps existed: the file is preferred when it is newer than the slot.
  const legacy = { ...store.readSlot(root, 'p1') }; delete legacy.fileStamp;
  assert.equal(store.fileChangedSince({ ...legacy, updatedAt: Date.now() - 86400e3 }), true, 'legacy slot older than its file');
  assert.equal(store.fileChangedSince({ ...legacy, updatedAt: Date.now() + 86400e3 }), false, 'legacy slot newer than its file');
  // Unsaved slots and slots whose file is gone are never "changed": the slot is all there is.
  assert.equal(store.fileChangedSince(store.readSlot(root, (store.writeSlot(root, rec('u', 'U', 1)), 'u'))), false);
  fs.unlinkSync(file);
  assert.equal(store.fileChangedSince(slot), false, 'a missing file leaves the slot as the copy to open');
  assert.equal(store.readSlot(root, 'u').fileStamp, undefined, 'unsaved slots carry no stamp');
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
  // A newer empty legacy slot must not erase the sidecar's real conversation.
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(store.chatPath(root, 'legacy'), past, past);
  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ id: 'legacy', title: 'Legacy', updatedAt: 5, project: { id: 'legacy', craftAI: { version: 1, sessions: [], activeSessionId: null } } }));
  assert.equal(store.readSlot(root, 'legacy').project.craftAI.sessions.length, 1, 'a newer empty embedded chat cannot erase sidecar content');
  // A newer legacy slot with actual conversation content does take precedence.
  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ id: 'legacy', title: 'Legacy', updatedAt: 6, project: { id: 'legacy', craftAI: JSON.parse(chat.replaceAll('s1', 'legacy-real-chat')) } }));
  assert.equal(store.readSlot(root, 'legacy').project.craftAI.activeSessionId, 'legacy-real-chat', 'a newer embedded conversation with content wins');
  // Delete and cap eviction take the chat with them; the chat folder never pollutes the index.
  store.deleteSlot(root, 'legacy');
  assert.ok(!fs.existsSync(store.chatPath(root, 'legacy')), 'deleteSlot removes the chat too');
  const filed = (id) => { const f = path.join(root, `${id}.clipcraft.json`); fs.writeFileSync(f, '{}'); return { file: f }; };
  store.writeSlot(root, rec('c1', 'Chat slot renamed', 3, filed('c1'))); // only file-backed slots are evicted
  store.writeSlotChat(root, 'c1', chat);
  for (let i = 0; i < store.CAP; i++) store.writeSlot(root, rec(`fill${i}`, `Fill ${i}`, 100 + i, filed(`fill${i}`)));
  assert.ok(!fs.existsSync(store.chatPath(root, 'c1')), 'eviction removes the evicted slot\'s chat');
  fs.unlinkSync(path.join(root, 'index.json'));
  assert.ok(store.listSlots(root).every((e) => !e.id.startsWith('chat')), 'the index rebuild ignores the chat folder');
  console.log('AUTOSAVE CHAT OK');
}
