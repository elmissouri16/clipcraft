// Lock enforcement (Stage B): a locked layer refuses edits at the DISPATCH layer — every
// action that would touch its clips comes back with the state unchanged — while edits to
// other layers, layer-state toggles themselves, and undo all keep working.
import { emptyProject, historyReducer, layerStateOf, uid } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const media = [
  { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10, width: 720, height: 1280, hasAudio: true },
  { id: 'm2', path: '/x/music.wav', type: 'audio', duration: 10, hasAudio: true },
];
const base = () => ({
  ...emptyProject(), media,
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  overlayClips: [{ id: 'o1', mediaId: 'm1', start: 0, in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['mirror'], layer: 0 }],
  audioClips: [{ id: 'a1', mediaId: 'm2', start: 0, in: 0, out: 5, volume: 1, layer: 0 },
    { id: 'a2', mediaId: 'm2', start: 6, in: 0, out: 3, volume: 1, layer: 1 }],
  layers: { audio: 2 },
});
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const lock = (track, layer) => ({ type: 'setLayerState', track, layer, patch: { locked: true } });
const state = (p) => ({ past: [], present: p, future: [] });

// Every edit aimed at the locked audio layer 0 is refused; layer 1 stays editable.
{
  let s = run(state(base()), [lock('audio', 0)]);
  const attempts = [
    ['update', { type: 'update', track: 'audio', id: 'a1', patch: { volume: 0.2 } }],
    ['updateMany', { type: 'updateMany', updates: [{ track: 'audio', id: 'a1', patch: { start: 2 } }] }],
    ['delete', { type: 'delete', track: 'audio', id: 'a1' }],
    ['duplicate', { type: 'duplicate', track: 'audio', id: 'a1', newId: uid() }],
    ['split', { type: 'split', track: 'audio', id: 'a1', t: 2, newId: uid() }],
    ['trimClip', { type: 'trimClip', track: 'audio', id: 'a1', edge: 'right', delta: 1 }],
    ['paste onto it', { type: 'paste', track: 'audio', clip: { id: 'x', mediaId: 'm2', start: 0, in: 0, out: 2, layer: 0 }, at: 1, newId: uid() }],
    ['deleteLayer', { type: 'deleteLayer', track: 'audio', layer: 0 }],
    ['insertAudioClip onto it', { type: 'insertAudioClip', clip: { id: uid(), mediaId: 'm2', start: 0, in: 0, out: 2, layer: 0 } }],
  ];
  for (const [name, action] of attempts) {
    const before = s.present;
    s = run(s, [action]);
    ok(s.present === before, `${name} on a locked layer changed nothing`);
  }
  const before = s.present;
  s = run(s, [{ type: 'update', track: 'audio', id: 'a2', patch: { volume: 0.3 } }]);
  ok(s.present !== before && s.present.audioClips.find((c) => c.id === 'a2').volume === 0.3, 'the unlocked layer 1 still edits');
  s = run(s, [{ type: 'split', track: 'audio', id: 'a2', t: 7, newId: uid() }]);
  ok(s.present.audioClips.length === 3, 'split still works on the unlocked layer');
}

// Main track lock: trims, reorders, cuts and effect changes are refused.
{
  let s = run(state(base()), [lock('video', 0), { type: 'update', track: 'overlay', id: 'o1', patch: { effects: ['mirror', 'grain'] } }]);
  const attempts = [
    ['update (volume)', { type: 'update', track: 'video', id: 'v1', patch: { volume: 0.1 } }],
    ['trimClip', { type: 'trimClip', track: 'video', id: 'v1', edge: 'left', delta: 1 }],
    ['moveVideo', { type: 'moveVideo', id: 'v1', toIndex: 0 }],
    ['cutRanges', { type: 'cutRanges', ranges: [{ start: 1, end: 2 }] }],
    ['moveToOverlay', { type: 'moveToOverlay', id: 'v1', at: 0 }],
    ['split', { type: 'split', track: 'video', id: 'v1', t: 3, newId: uid() }],
    ['addToTimeline (video)', { type: 'addToTimeline', mediaId: 'm1', clipId: uid() }],
  ];
  for (const [name, action] of attempts) {
    const before = s.present;
    s = run(s, [action]);
    ok(s.present === before, `${name} on the locked main track changed nothing`);
  }
  // Removing an effect FROM a clip on the locked overlay-adjacent path: the effect belongs
  // to overlay clip o1 — its layer is unlocked here, but the main track lock must not leak.
  const before = s.present;
  s = run(s, [{ type: 'removeEffect', id: 'overlay|o1|grain' }]);
  ok(s.present !== before, 'removeEffect on an unlocked clip still works while Main is locked');
}

// Effect removal and edits follow the OWNING clip's layer lock.
{
  let s = run(state(base()), [lock('overlay', 0)]);
  const before = s.present;
  s = run(s, [{ type: 'removeEffect', id: 'overlay|o1|mirror' }]);
  ok(s.present === before, 'removeEffect refused: the owning clip is on a locked layer');
  s = run(s, [{ type: 'update', track: 'overlay', id: 'o1', patch: { opacity: 0.5 } }]);
  ok(s.present === before, 'update refused on the locked overlay layer');
}

// Captions land on text layer 0: locking it refuses caption generation.
{
  let s = run(state(base()), [lock('text', 0)]);
  const before = s.present;
  s = run(s, [{ type: 'setCaptions', style: {}, segments: [{ id: 'c1', text: 'x', start: 0, end: 1, words: [] }] }]);
  ok(s.present === before, 'setCaptions refused while the text layer is locked');
}

// Undo is never blocked by a lock, and the lock itself survives the undo.
{
  let s = run(state(base()), [{ type: 'update', track: 'audio', id: 'a1', patch: { volume: 0.4 } }]);
  s = run(s, [lock('audio', 0)]);
  s = run(s, [{ type: 'undo' }]);
  ok(s.present.audioClips.find((c) => c.id === 'a1').volume === 1, 'undo restored the pre-edit project despite the lock');
  ok(layerStateOf(s.present, 'audio', 0).locked === true, 'the lock itself was not undone');
}

// Placement check: an overlay drop whose target layer is full gets bumped by placeLayers —
// when the bump lands it on a LOCKED layer, the add is refused as a whole.
{
  const p = base();
  p.overlayClips = [{ id: 'o9', mediaId: 'm1', start: 0, in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], layer: 0 }];
  p.layers = { overlay: 2, audio: 2 };
  let s = run(state(p), [lock('overlay', 1)]);
  const before = s.present;
  // Layer 0 is occupied 0..6, so a clip dropped at t=1 on layer 0 can only fit on layer 1.
  s = run(s, [{ type: 'addOverlayClip', mediaId: 'm1', clipId: 'oNew', at: 1, layer: 0 }]);
  ok(s.present === before, 'add bumped onto a locked layer was refused entirely');
  s = run(s, [{ type: 'setLayerState', track: 'overlay', layer: 1, patch: { locked: false } },
    { type: 'addOverlayClip', mediaId: 'm1', clipId: 'oNew', at: 1, layer: 0 }]);
  ok(s.present.overlayClips.some((c) => c.id === 'oNew' && c.layer === 1), 'the same add lands on layer 1 once unlocked');
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
