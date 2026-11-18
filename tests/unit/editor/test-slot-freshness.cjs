// Opening a project from its Home card (autosave slot) is as careful as opening its file:
// generated copies that are gone (Clear proxies) are dropped so they are made again, and a chat
// sidecar changed elsewhere makes the file open instead of the slot's older chat.
// Usage: node tests/unit/editor/test-slot-freshness.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const slots = require('../../../electron/project/autosave.cjs');
const sidecar = require('../../../electron/project/sidecar.cjs');
const { checkGenerated, checkGeneratedProject } = require('../../../electron/project/projectfile.cjs');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-slot-fresh-'));
try {
  // 1. Copies recorded by the slot no longer exist; one that does exist is kept.
  const cache = path.join(work, 'cache'); fs.mkdirSync(cache);
  const kept = path.join(cache, 'kept-qlow.mp4'); fs.writeFileSync(kept, 'x');
  const media = { id: 'm1', type: 'video', path: path.join(work, 'clip.mov'), duration: 10, width: 3840, height: 2160,
    lightProxy: path.join(cache, 'gone-lproxy.mp4'), proxies: { high: path.join(cache, 'gone-qhigh.mp4'), medium: false, low: kept } };
  fs.writeFileSync(media.path, 'x');
  const project = { id: 'p1', media: [media], videoClips: [] };
  const checked = checkGeneratedProject(project, cache).media[0];
  assert.equal(checked.lightProxy, undefined, 'a missing light copy is dropped');
  assert.deepEqual(checked.proxies, { medium: false, low: kept }, 'a missing level copy is dropped; a failed mark and an existing copy stay');
  assert.deepEqual(JSON.parse(checkGenerated(JSON.stringify(project), cache)).media[0].proxies, checked.proxies, 'a file open drops the same copies');
  const intact = { id: 'p2', media: [{ ...media, lightProxy: undefined, proxies: { low: kept } }], videoClips: [] };
  assert.equal(checkGeneratedProject(intact, cache), intact, 'a project whose copies exist is returned as it is');

  // 2. The chat sidecar of a slot's file changed elsewhere (a chat-only edit on another computer).
  const root = path.join(work, 'autosave'), file = path.join(work, 'trip.clipcraft.json');
  const doc = JSON.stringify({ id: 'trip', media: [], videoClips: [] }), chat = (n) => JSON.stringify({ version: 1, sessions: [{ id: 's', messages: Array(n).fill({ role: 'user', text: 'hi' }) }] });
  fs.writeFileSync(file, doc); sidecar.writeChat(file, chat(2));
  slots.writeSlot(root, { id: 'trip', title: 'Trip', file, projectJson: doc, chatJson: chat(2) });
  assert.equal(slots.fileChangedSince(slots.readSlot(root, 'trip'), root), false, 'an untouched file keeps the slot');
  sidecar.writeChat(file, chat(6));
  const future = new Date(Date.now() + 5000); fs.utimesSync(sidecar.chatPath(file), future, future);
  assert.equal(slots.fileChangedSince(slots.readSlot(root, 'trip'), root), true, 'a sidecar changed elsewhere opens the file');
  // The same chat written by this app after the slot (the file's timer runs after the slot's) is no change.
  sidecar.writeChat(file, chat(2)); fs.utimesSync(sidecar.chatPath(file), future, future);
  assert.equal(slots.fileChangedSince(slots.readSlot(root, 'trip'), root), false, 'a sidecar holding the slot\'s own chat keeps the slot');
  // A slot written before the sidecar was stamped keeps the old rule (document only).
  const legacy = { ...slots.readSlot(root, 'trip') }; delete legacy.chatStamp;
  sidecar.writeChat(file, chat(9));
  assert.equal(slots.fileChangedSince(legacy, root), false, 'legacy slots compare the document only');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log('Slot opens drop missing copies and notice a chat sidecar changed elsewhere');
