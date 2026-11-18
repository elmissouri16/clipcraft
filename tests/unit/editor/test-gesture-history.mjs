// A held drag (gesture) and the history: Undo / Redo wait for the release, and a group of edits
// (a clip job's result, a shortcut; beginGesture/endGesture with group: true) that lands mid-drag nests
// inside it instead of ending it. Usage: node tests/unit/editor/test-gesture-history.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer } from '../../../src/state/store.js';

const media = [{ id: 'm', name: 'talk', type: 'video', duration: 60, width: 100, height: 100, hasAudio: false },
  { id: 'rev', name: 'reversed', type: 'video', duration: 20, width: 100, height: 100, hasAudio: false }];
const base = { ...emptyProject(), media, videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 20, speed: 1 }, { id: 'b', mediaId: 'm', in: 20, out: 40, speed: 1 }] };
const run = () => {
  let s = { past: [], future: [], present: base };
  const d = (a) => { s = historyReducer(s, a); };
  const clip = (id) => s.present.videoClips.find((c) => c.id === id);
  return { d, clip, get s() { return s; } };
};
const trim = (delta) => ({ type: 'trimClip', track: 'video', id: 'a', edge: 'left', delta });

// 1) Undo / Redo pressed while a trim is held change nothing; the drag ends as one Undo step.
{
  const h = run();
  h.d({ type: 'setProject', patch: { name: 'My edit' } });
  h.d({ type: 'beginGesture' });
  for (const delta of [0.5, 1, 1.5, 2]) h.d(trim(delta));
  const held = h.s;
  h.d({ type: 'undo' });
  assert.equal(h.s, held, 'Undo during a held gesture is ignored');
  h.d({ type: 'redo' });
  assert.equal(h.s, held, 'Redo during a held gesture is ignored');
  for (let delta = 2.5; delta <= 10; delta += 0.5) h.d(trim(delta));
  h.d({ type: 'endGesture' });
  assert.equal(h.clip('a').in, 10, 'the trim follows the pointer from where it was pressed');
  assert.equal(h.s.past.length, 2, 'the whole drag is one Undo step');
  h.d({ type: 'undo' });
  assert.equal(h.clip('a').in, 0);assert.equal(h.s.present.name, 'My edit', 'one Undo removes the drag, not the earlier edit');
  // After the release Undo / Redo work as usual.
  h.d({ type: 'redo' });assert.equal(h.clip('a').in, 10);
}

// 2) A clip job's grouped result landing mid-drag nests: the drag keeps its start, the result survives
// the drag's later updates, and each becomes its own Undo step.
{
  const h = run();
  h.d({ type: 'beginGesture' });
  for (const delta of [0.5, 1, 1.5, 2]) h.d(trim(delta));
  h.d({ type: 'beginGesture', group: true });
  h.d({ type: 'update', track: 'video', id: 'b', patch: { mediaId: 'rev', in: 0, out: 20 } });
  h.d({ type: 'update', track: 'video', id: 'b', patch: { muted: true } });
  h.d({ type: 'endGesture', group: true });
  assert.ok(h.s.gestureStart, 'the drag is still held after the group ends');
  assert.equal(h.clip('a').in, 2);
  for (let delta = 2.5; delta <= 6; delta += 0.5) h.d(trim(delta));
  assert.equal(h.clip('a').in, 6, 'trims do not stack');
  assert.equal(h.clip('b').mediaId, 'rev', 'the group result is kept by the drag updates');
  assert.equal(h.clip('b').muted, true);
  h.d({ type: 'endGesture' });
  assert.equal(h.s.past.length, 2, 'the group and the drag: two Undo steps');
  h.d({ type: 'undo' });
  assert.equal(h.clip('a').in, 0, 'first Undo: the drag');assert.equal(h.clip('b').mediaId, 'rev');
  h.d({ type: 'undo' });
  assert.equal(h.clip('b').mediaId, 'm', 'second Undo: the group, as one step');assert.equal(h.clip('b').muted, undefined);
}

// 3) Groups nest more than once; only their own ends close them, and a group alone still makes one step.
{
  const h = run();
  h.d({ type: 'beginGesture' });h.d(trim(1));
  h.d({ type: 'beginGesture', group: true });h.d({ type: 'beginGesture', group: true });
  h.d({ type: 'update', track: 'video', id: 'b', patch: { volume: 0.5 } });
  h.d({ type: 'endGesture', group: true });
  assert.equal(h.s.past.length, 0, 'an inner end commits nothing while its group is open');
  h.d({ type: 'endGesture', group: true });
  assert.equal(h.s.past.length, 1);
  h.d(trim(3));h.d({ type: 'endGesture' });
  assert.equal(h.clip('a').in, 3);assert.equal(h.clip('b').volume, 0.5);assert.equal(h.s.past.length, 2);
  assert.equal(h.s.gestureNest, undefined);assert.equal(h.s.gestureStart, null);
  const g = run();
  g.d({ type: 'beginGesture', group: true });
  g.d({ type: 'update', track: 'video', id: 'a', patch: { volume: 0.2 } });g.d({ type: 'update', track: 'video', id: 'b', patch: { volume: 0.3 } });
  g.d({ type: 'endGesture', group: true });
  assert.equal(g.s.past.length, 1, 'a group outside a drag is one Undo step');
  // A plain begin (a new press after a lost release) still restarts the gesture, as before.
  g.d({ type: 'beginGesture' });g.d({ type: 'beginGesture' });g.d({ type: 'update', track: 'video', id: 'a', patch: { volume: 0.9 } });g.d({ type: 'endGesture' });
  assert.equal(g.s.gestureStart, null);assert.equal(g.s.past.length, 2);
}
console.log('gesture history ok: Undo/Redo wait for the release; groups nest in a held drag and keep their result as their own step');
