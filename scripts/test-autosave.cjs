// Per-project autosave store (electron/autosave.cjs): per-id write/read roundtrip, index
// ordering (newest first), rewrite dedupe, cap eviction (oldest out, just-written kept),
// delete, file binding lookup, id sanitization, and index rebuild after loss.
// Usage: node scripts/test-autosave.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../electron/autosave.cjs');

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
  assert.ok(!fs.existsSync(path.join(root, '..', 'evil.json')));

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
