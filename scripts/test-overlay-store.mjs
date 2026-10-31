// Overlay track model: add, split with speed, ripple trims, delete. Usage: node scripts/test-overlay-store.mjs
import assert from 'node:assert/strict';
import { freeLen, historyReducer, normalizeProject, projectDuration, trimActions } from '../src/store.js';

const run = (st, ...actions) => actions.reduce(historyReducer, st);
const fresh = () => ({
  past: [],
  present: { ...normalizeProject({}), media: [{ id: 'v', type: 'video', duration: 10 }, { id: 'p', type: 'image', duration: 0 }, { id: 'a', type: 'audio', duration: 5 }] },
  future: [],
});
const ov = (st) => st.present.overlayClips.map((c) => `${c.id}@${+c.start.toFixed(2)}[${+c.in.toFixed(2)}..${+c.out.toFixed(2)}]`).join(' ');

assert.deepEqual(normalizeProject({}).overlayClips, []);
assert.equal(normalizeProject({}).magnet.overlay, false);

let st = run(fresh(), { type: 'addOverlayClip', mediaId: 'v', clipId: 'o1', at: 2 }, { type: 'addOverlayClip', mediaId: 'a', clipId: 'nope', at: 0 });
assert.equal(ov(st), 'o1@2[0..10]', 'audio never becomes an overlay');
assert.equal(st.present.overlayClips[0].transform.scale, 0.5);
assert.equal(projectDuration(st.present), 12);

// Speed 2: 10 s of source last 5 s; a split at 4 s cuts the source at 4 s.
st = run(st, { type: 'update', track: 'overlay', id: 'o1', patch: { speed: 2 } });
assert.equal(freeLen('overlay', st.present.overlayClips[0]), 5);
st = run(st, { type: 'split', track: 'overlay', id: 'o1', t: 4, newId: 'o2' });
assert.equal(ov(st), 'o1@2[0..4] o2@4[4..10]');

// Magnet on: trimming 1 s (timeline) off the right of o1 removes 2 s of source and pulls o2 back by 1 s.
st = run(st, { type: 'setMagnet', track: 'overlay', on: true }, { type: 'beginGesture' },
  { type: 'trimClip', track: 'overlay', id: 'o1', edge: 'right', delta: 1 }, { type: 'endGesture' });
assert.equal(ov(st), 'o1@2[0..2] o2@3[4..10]');

// Delete right of the playhead in o2, then delete o1 with the magnet on (o2 moves back).
st = run(st, ...trimActions(st.present, { track: 'overlay', id: 'o2', t: 4, side: 'right', newId: 'x' }));
assert.equal(ov(st), 'o1@2[0..2] o2@3[4..6]');
st = run(st, { type: 'delete', track: 'overlay', id: 'o1' });
assert.equal(ov(st), 'o2@2[4..6]');

// Photos have no end: extending to the right is unlimited.
st = run(fresh(), { type: 'addOverlayClip', mediaId: 'p', clipId: 'ph', at: 0 }, { type: 'beginGesture' },
  { type: 'trimClip', track: 'overlay', id: 'ph', edge: 'right', delta: -20 }, { type: 'endGesture' });
assert.ok(st.present.overlayClips[0].out > 20);
// Removing the media removes its overlays.
st = run(st, { type: 'removeMedia', id: 'p' });
assert.equal(st.present.overlayClips.length, 0);
console.log('OVERLAY STORE OK');
