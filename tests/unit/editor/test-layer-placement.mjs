// Layer placement after an edit: the clip that was added or moved onto a taken spot is the one
// relocated, never an untouched neighbour, and never onto a locked, hidden or muted layer. Auto
// captions follow the same rule, and regenerating them is not blocked by a locked track the
// regeneration keeps. Usage: node tests/unit/editor/test-layer-placement.mjs
import { historyReducer, normalizeProject, renderable } from '../../../src/state/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const run = (s, ...actions) => actions.reduce((st, a) => historyReducer(st, a), s);
const layer = (p, key, id) => p[key].find((c) => c.id === id)?.layer;
const layerState = (track, l, patch) => ({ type: 'setLayerState', track, layer: l, patch });
const make = () => ({ past: [], present: normalizeProject({
  id: 'p', media: [{ id: 'a', type: 'audio', path: '/m/a.wav', duration: 30, hasAudio: true }],
  textClips: [
    { id: 'cap1', text: 'hello there', caption: true, start: 0, duration: 2, layer: 0 },
    { id: 'cap2', text: 'second line', caption: true, start: 2.2, duration: 1.8, layer: 0 },
    { id: 'title', text: 'Title', start: 10, duration: 3, layer: 1 },
  ],
  audioClips: [
    { id: 'v1', mediaId: 'a', start: 0, in: 0, out: 4, layer: 0 },
    { id: 'v2', mediaId: 'a', start: 6, in: 6, out: 9, layer: 0 },
    { id: 'music', mediaId: 'a', start: 12, in: 0, out: 10, layer: 1 },
  ],
}), future: [] });

// A duplicate overlapping a later caption: the copy moves, past the hidden layer 1.
{
  const s = run(make(), layerState('text', 1, { hidden: true }), { type: 'duplicate', track: 'text', id: 'cap1', newId: 'copy' });
  ok(layer(s.present, 'textClips', 'cap2') === 0, 'the untouched caption keeps its layer');
  ok(layer(s.present, 'textClips', 'copy') === 2, 'the copy skips the hidden layer and opens a new one');
  ok(renderable(s.present).textClips.some((c) => c.id === 'cap2'), 'the untouched caption still renders');
}

// A drag over an untouched neighbour, with the next layer muted or locked.
for (const flag of ['muted', 'locked']) {
  const s = run(make(), layerState('audio', 1, { [flag]: true }), { type: 'beginGesture' },
    ...[3, 0.5].map((start) => ({ type: 'update', track: 'audio', id: 'v1', patch: { start } })), { type: 'endGesture' });
  ok(layer(s.present, 'audioClips', 'v2') === 0, `the untouched neighbour stays on layer 0 (layer 1 ${flag})`);
  ok(layer(s.present, 'audioClips', 'v1') === 2, `the dragged clip moved past the ${flag} layer`);
}

// An add onto a free spot of its own layer is not moved at all.
{
  const s = run(make(), { type: 'addText', clipId: 'new', at: 5, patch: { duration: 1 } });
  ok(layer(s.present, 'textClips', 'new') === 0, 'an add that fits stays on its layer');
}

// Auto captions: new cues overlapping cues the regeneration keeps go past a hidden layer.
{
  let s = run(make(), { type: 'load', project: normalizeProject({ id: 'p', textClips: [
    { id: 'e1', text: 'ext', caption: true, source: 'extension', start: 1, duration: 2, layer: 0 },
    { id: 'n', text: 'note', caption: true, source: 'extension', start: 10, duration: 2, layer: 1 }] }) });
  s = run(s, layerState('text', 1, { hidden: true }),
    { type: 'setCaptions', style: {}, segments: [{ id: 'a1', start: 1, end: 3, text: 'one' }, { id: 'a2', start: 5, end: 6, text: 'two' }] });
  ok(layer(s.present, 'textClips', 'a1') === 2 && layer(s.present, 'textClips', 'a2') === 0, 'new captions stay off the hidden layer');
}

// A locked extension caption track does not block Generate / Remove captions (it is kept).
{
  let s = run(make(), { type: 'load', project: normalizeProject({ id: 'p', textClips: [
    { id: 'auto', text: 'old', caption: true, start: 1, duration: 2, layer: 0 },
    { id: 'fr', text: 'bonjour', caption: true, source: 'extension', start: 1, duration: 2, layer: 1 }] }) });
  s = run(s, layerState('text', 1, { locked: true }));
  const regen = run(s, { type: 'setCaptions', style: {}, segments: [{ id: 'n1', start: 1, end: 3, text: 'new' }] });
  ok(regen.present.textClips.some((c) => c.id === 'n1') && !regen.present.textClips.some((c) => c.id === 'auto'), 'regenerating replaces the auto captions');
  ok(regen.present.textClips.some((c) => c.id === 'fr' && c.layer === 1), 'the locked extension track is kept as it was');
  const removed = run(s, { type: 'setCaptions', segments: [] });
  ok(!removed.present.textClips.some((c) => c.id === 'auto') && removed.present.textClips.some((c) => c.id === 'fr'), 'Remove captions works with the extension track locked');
  const lockedAuto = run(s, layerState('text', 0, { locked: true }), { type: 'setCaptions', segments: [] });
  ok(lockedAuto.present.textClips.some((c) => c.id === 'auto'), 'a locked auto-caption track still refuses');
}

if (fails.length) { console.log(`${fails.length} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');
