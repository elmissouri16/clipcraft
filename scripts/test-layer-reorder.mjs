// Layer reorder (Stage C): moveLayer remaps clip.layer, layerNames and layerState through
// one permutation in a single undo step; the main track cannot be reordered.
import { emptyProject, historyReducer, layerCount, layerName, layerOf, layerStateOf } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const media = [{ id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10, hasAudio: true }];
const aud = (id, layer, start) => ({ id, mediaId: 'm1', start, in: 0, out: 3, volume: 1, layer });
const base = () => ({
  ...emptyProject(), media,
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  audioClips: [aud('a0', 0, 0), aud('a1', 1, 0), aud('a2', 2, 0)],
  overlayClips: [
    { id: 'o0', mediaId: 'm1', start: 0, in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], layer: 0 },
    { id: 'o2', mediaId: 'm1', start: 4, in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], layer: 2 },
  ],
  layers: { audio: 3, overlay: 3 },
  layerNames: { audio: { 0: 'Music', 2: 'Voice' }, overlay: { 2: 'B-roll' } },
  layerState: { 'audio:0': { muted: true }, 'audio:2': { locked: true }, 'overlay:2': { hidden: true } },
});
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const state = (p) => ({ past: [], present: p, future: [] });
const layerOfId = (p, list, id) => layerOf(p[list].find((c) => c.id === id));

// --- Audio: move layer 0 to position 2 (bottom). Everything follows.
{
  let s = run(state(base()), [{ type: 'moveLayer', track: 'audio', from: 0, to: 2 }]);
  const p = s.present;
  ok(layerOfId(p, 'audioClips', 'a0') === 2 && layerOfId(p, 'audioClips', 'a1') === 0 && layerOfId(p, 'audioClips', 'a2') === 1,
    `clips remapped 0->2, 1->0, 2->1 (got ${['a0', 'a1', 'a2'].map((id) => layerOfId(p, 'audioClips', id)).join('/')})`);
  ok(layerName(p, 'audio', 2) === 'Music' && layerName(p, 'audio', 1) === 'Voice', 'names travel with their layers');
  ok(layerStateOf(p, 'audio', 2).muted === true, 'the muted state followed layer 0 to index 2');
  ok(layerStateOf(p, 'audio', 1).locked === true, 'the locked state followed layer 2 to index 1');
  ok(layerCount(p, 'audio') === 3, 'layer count unchanged');
  ok(s.past.length === 1, 'the reorder is exactly one undo step');
  s = run(s, [{ type: 'undo' }]);
  const q = s.present;
  ok(layerOfId(q, 'audioClips', 'a0') === 0 && layerName(q, 'audio', 0) === 'Music' && layerStateOf(q, 'audio', 0).muted,
    'undo restores the exact prior order, names and states');
}

// --- Overlay: move layer 2 down to 0 (across an empty layer 1).
{
  let s = run(state(base()), [{ type: 'moveLayer', track: 'overlay', from: 2, to: 0 }]);
  const p = s.present;
  ok(layerOfId(p, 'overlayClips', 'o2') === 0 && layerOfId(p, 'overlayClips', 'o0') === 1,
    'overlay clips remapped across the empty layer');
  ok(layerName(p, 'overlay', 0) === 'B-roll' && layerStateOf(p, 'overlay', 0).hidden === true,
    'overlay name + hidden state followed the moved layer');
}

// --- No-ops and the fixed main track.
{
  const p = base();
  let s = state(p);
  const before = s.present;
  s = run(s, [{ type: 'moveLayer', track: 'audio', from: 1, to: 1 }]);
  ok(s.present === before, 'moving a layer onto itself is a no-op');
  s = run(s, [{ type: 'moveLayer', track: 'audio', from: 0, to: 9 }]);
  ok(s.present === before, 'an out-of-range target is a no-op');
  s = run(s, [{ type: 'moveLayer', track: 'video', from: 0, to: 0 }]);
  ok(s.present === before, 'the main track cannot be reordered');
  s = run(s, [{ type: 'moveLayer', track: 'effect', from: 0, to: 1 }]);
  ok(s.present === before, 'the (unlayered) Effects lane cannot be reordered');
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
