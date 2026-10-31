// Multi-select bulk operations (Stage E) at the store layer: the primitives the UI drives
// — a gesture-wrapped multi delete, an updateMany layer move, and bulk duplicate — each
// land as ONE undo step, and locked members refuse their own op without blocking the rest.
import { emptyProject, historyReducer, layerOf, uid } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const media = [{ id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10, hasAudio: true }];
const aud = (id, layer, start) => ({ id, mediaId: 'm1', start, in: 0, out: 3, volume: 1, layer });
const base = () => ({
  ...emptyProject(), media,
  audioClips: [aud('a1', 0, 0), aud('a2', 0, 5), aud('a3', 1, 0)],
  layers: { audio: 2 },
});
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const state = (p) => ({ past: [], present: p, future: [] });
const gesture = (actions) => [{ type: 'beginGesture' }, ...actions, { type: 'endGesture' }];

// --- Multi delete inside one gesture = one undo step, restoring everything.
{
  let s = run(state(base()), gesture([
    { type: 'delete', track: 'audio', id: 'a1' },
    { type: 'delete', track: 'audio', id: 'a3' },
  ]));
  ok(s.present.audioClips.map((c) => c.id).join(',') === 'a2', 'both selected clips deleted');
  ok(s.past.length === 1, `the bulk delete is one undo step (past=${s.past.length})`);
  s = run(s, [{ type: 'undo' }]);
  ok(s.present.audioClips.length === 3, 'one undo brings both clips back');
}

// --- Bulk Move to layer via updateMany = one action, one undo step.
{
  let s = run(state(base()), [{
    type: 'updateMany',
    updates: [
      { track: 'audio', id: 'a1', patch: { layer: 1 } },
      { track: 'audio', id: 'a2', patch: { layer: 1 } },
    ],
  }]);
  // placeLayers keeps one layer per row position: a1/a2 overlap on layer 1 with a3, so
  // they cascade to free layers — what matters is that they left layer 0 together.
  ok(s.present.audioClips.filter((c) => layerOf(c) === 0).length === 0, 'both clips moved off layer 0 together');
  ok(s.past.length === 1, 'updateMany is a single undo step');
  s = run(s, [{ type: 'undo' }]);
  ok(s.present.audioClips.filter((c) => layerOf(c) === 0).length === 2, 'undo restores both to layer 0');
}

// --- Bulk duplicate inside one gesture: copies for all, one undo step.
{
  let s = run(state(base()), gesture([
    { type: 'duplicate', track: 'audio', id: 'a1', newId: uid() },
    { type: 'duplicate', track: 'audio', id: 'a2', newId: uid() },
  ]));
  ok(s.present.audioClips.length === 5, `two duplicates added (got ${s.present.audioClips.length})`);
  ok(s.past.length === 1, 'bulk duplicate is one undo step');
}

// --- A locked member refuses its own delete; the rest of the bulk op still applies.
{
  let s = run(state(base()), [{ type: 'setLayerState', track: 'audio', layer: 1, patch: { locked: true } }]);
  s = run(s, gesture([
    { type: 'delete', track: 'audio', id: 'a1' },
    { type: 'delete', track: 'audio', id: 'a3' },
  ]));
  const ids = s.present.audioClips.map((c) => c.id);
  ok(ids.includes('a3') && !ids.includes('a1'), 'locked member kept, unlocked member deleted');
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
