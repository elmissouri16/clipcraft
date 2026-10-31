// Unit checks for delete-left/right, markers and the new project defaults. Usage: node scripts/test-toolbar.mjs
import assert from 'node:assert/strict';
import { historyReducer, markerNear, normalizeProject, trimActions, videoLayout } from '../src/store.js';

const mk = (id, len) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1 });
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${+l.start.toFixed(2)}-${+l.end.toFixed(2)}[${+l.clip.in.toFixed(2)}..${+l.clip.out.toFixed(2)}]`).join(' ');
const fresh = () => ({
  past: [],
  present: {
    ...normalizeProject({}),
    media: [{ id: 'm', type: 'video', duration: 30 }],
    videoClips: [mk('a', 4), mk('b', 6)],
    audioClips: [{ id: 'x', mediaId: 'm', start: 1, in: 0, out: 6 }, { id: 'y', mediaId: 'm', start: 8, in: 0, out: 2 }],
    textClips: [{ id: 't', text: 'hi', start: 2, duration: 4 }],
  },
  future: [],
});
const run = (st, ...actions) => actions.reduce(historyReducer, st);
const apply = (st, spec) => run(st, ...trimActions(st.present, { newId: 'n', ...spec }));

// Defaults for new and old projects.
assert.deepEqual(normalizeProject({}).markers, []);
assert.equal(normalizeProject({}).snapping, true);
assert.equal(normalizeProject({ snapping: false }).snapping, false);

// Main track, magnet on: delete right of the playhead keeps the left half; delete left closes the space.
let st = apply(fresh(), { track: 'video', id: 'b', t: 6, side: 'right' });
assert.equal(layout(st.present), 'a@0-4[0..4] b@4-6[0..2]');
st = apply(fresh(), { track: 'video', id: 'b', t: 6, side: 'left' });
assert.equal(layout(st.present), 'a@0-4[0..4] n@4-8[2..6]');

// Magnet off: deleting the left half leaves a gap, the right half stays where it was.
st = run(fresh(), { type: 'setMagnet', track: 'video', on: false });
st = apply(st, { track: 'video', id: 'b', t: 6, side: 'left' });
assert.equal(layout(st.present), 'a@0-4[0..4] GAP@4-6[0..2] n@6-10[2..6]');

// Too close to an edge (or outside the clip): nothing to do.
assert.deepEqual(trimActions(fresh().present, { track: 'video', id: 'b', t: 4.02, side: 'left', newId: 'n' }), []);
assert.deepEqual(trimActions(fresh().present, { track: 'video', id: 'a', t: 7, side: 'left', newId: 'n' }), []);
assert.deepEqual(trimActions(fresh().present, { track: 'video', id: 'nope', t: 1, side: 'left', newId: 'n' }), []);

// Audio track (magnet on): the right half (3s to 7s, 4 s long) goes, later clips shift by 4.
st = apply(fresh(), { track: 'audio', id: 'x', t: 3, side: 'right' });
assert.equal(st.present.audioClips.map((c) => `${c.id}@${c.start}(${c.out - c.in})`).join(' '), 'x@1(2) y@4(2)');
// Left half of a text clip (magnet off by default): the remainder keeps its time.
st = apply(fresh(), { track: 'text', id: 't', t: 3, side: 'left' });
assert.equal(st.present.textClips.map((c) => `${c.id}@${c.start}(${c.duration})`).join(' '), 'n@3(3)');

// One undo restores a delete-left.
st = apply(fresh(), { track: 'audio', id: 'x', t: 3, side: 'left' });
assert.notEqual(st.present.audioClips.length, 0);
st = run(st, { type: 'undo' }, { type: 'undo' });
assert.equal(st.present.audioClips[0].out, 6);

// Markers: added sorted, found near a time, removed.
st = run(fresh(), { type: 'addMarker', id: 'm2', time: 5 }, { type: 'addMarker', id: 'm1', time: 2 });
assert.deepEqual(st.present.markers.map((m) => m.id), ['m1', 'm2']);
assert.equal(markerNear(st.present.markers, 2.03).id, 'm1');
assert.equal(markerNear(st.present.markers, 3), null);
st = run(st, { type: 'removeMarker', id: 'm1' });
assert.deepEqual(st.present.markers.map((m) => m.id), ['m2']);

console.log('TOOLBAR OK');
