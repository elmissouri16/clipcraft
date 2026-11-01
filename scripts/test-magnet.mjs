// Unit checks for the track magnet logic in src/store.js. Usage: node scripts/test-magnet.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, videoLayout } from '../src/store.js';

const mk = (id, len) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1 });
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${l.start}-${l.end}`).join(' ');
const audio = (p) => p.audioClips.map((c) => `${c.id}@${c.start}(${c.out - c.in})`).join(' ');
const fresh = () => ({
  past: [],
  present: {
    ...normalizeProject({}),
    media: [{ id: 'm', type: 'video', duration: 20 }],
    videoClips: [mk('a', 4), mk('b', 4), mk('c', 4)],
    audioClips: [
      { id: 'x', mediaId: 'm', start: 0, in: 0, out: 2 },
      { id: 'y', mediaId: 'm', start: 3, in: 0, out: 2 },
      { id: 'z', mediaId: 'm', start: 6, in: 0, out: 2 },
    ],
    textClips: [
      { id: 't1', text: 'a', start: 0, duration: 2 },
      { id: 't2', text: 'b', start: 3, duration: 2 },
    ],
  },
  future: [],
});
const run = (st, ...actions) => actions.reduce(historyReducer, st);

// Main track, magnet on: deleting closes the gap.
let st = run(fresh(), { type: 'delete', track: 'video', id: 'b' });
assert.equal(layout(st.present), 'a@0-4 c@4-8');

// Magnet off: deleting leaves a gap, and deleting the gap closes it again.
st = run(fresh(), { type: 'setMagnet', track: 'video', on: false }, { type: 'delete', track: 'video', id: 'b' });
assert.equal(layout(st.present), 'a@0-4 GAP@4-8 c@8-12');
st = run(st, { type: 'delete', track: 'video', id: 'b' });
assert.equal(layout(st.present), 'a@0-4 c@4-8');

// Magnet off: trimming the right edge keeps later clips in place; repeated moves do not accumulate.
st = run(fresh(), { type: 'setMagnet', track: 'video', on: false }, { type: 'beginGesture' },
  { type: 'trimClip', track: 'video', id: 'a', edge: 'right', delta: 1 },
  { type: 'trimClip', track: 'video', id: 'a', edge: 'right', delta: 1.5 });
assert.equal(layout(st.present), 'a@0-2.5 GAP@2.5-4 b@4-8 c@8-12');
// ...and dragging it back out uses up the gap but never pushes b.
st = run(st, { type: 'endGesture' }, { type: 'beginGesture' }, { type: 'trimClip', track: 'video', id: 'a', edge: 'right', delta: -9 });
assert.equal(layout(st.present), 'a@0-4 b@4-8 c@8-12');

// Left edge with magnet off leaves a gap before the clip.
st = run(fresh(), { type: 'setMagnet', track: 'video', on: false }, { type: 'beginGesture' },
  { type: 'trimClip', track: 'video', id: 'b', edge: 'left', delta: 1 });
assert.equal(layout(st.present), 'a@0-4 GAP@4-5 b@5-8 c@8-12');

// Turning the magnet back on closes all gaps.
st = run(st, { type: 'endGesture' }, { type: 'setMagnet', track: 'video', on: true });
assert.equal(layout(st.present), 'a@0-4 b@4-7 c@7-11');

// Audio magnet on (default): delete ripples; trim ripples; later clips never move before the edit.
st = run(fresh(), { type: 'delete', track: 'audio', id: 'y' });
assert.equal(audio(st.present), 'x@0(2) z@4(2)');
st = run(fresh(), { type: 'beginGesture' }, { type: 'trimClip', track: 'audio', id: 'x', edge: 'right', delta: 1 });
assert.equal(audio(st.present), 'x@0(1) y@2(2) z@5(2)');
st = run(fresh(), { type: 'beginGesture' }, { type: 'trimClip', track: 'audio', id: 'y', edge: 'left', delta: 0.5 });
assert.equal(audio(st.present), 'x@0(2) y@3(1.5) z@5.5(2)');

// Audio magnet off: deleting does not move anything.
st = run(fresh(), { type: 'setMagnet', track: 'audio', on: false }, { type: 'delete', track: 'audio', id: 'y' });
assert.equal(audio(st.present), 'x@0(2) z@6(2)');

// Text magnet is off by default (captions keep their timing); turning it on ripples.
st = run(fresh(), { type: 'delete', track: 'text', id: 't1' });
assert.equal(st.present.textClips.map((c) => `${c.id}@${c.start}`).join(' '), 't2@3');
st = run(fresh(), { type: 'setMagnet', track: 'text', on: true }, { type: 'delete', track: 'text', id: 't1' });
assert.equal(st.present.textClips.map((c) => `${c.id}@${c.start}`).join(' '), 't2@1');

// Undo restores a delete in one step.
st = run(fresh(), { type: 'delete', track: 'audio', id: 'y' }, { type: 'undo' });
assert.equal(audio(st.present), 'x@0(2) y@3(2) z@6(2)');

// Old project files get default magnets.
// R1 (2026-11-01): the sticker magnet toggle was removed with the Stickers feature.
assert.deepEqual(normalizeProject({ videoClips: [] }).magnet, { video: true, overlay: false, audio: true, text: false });

console.log('MAGNET OK');
