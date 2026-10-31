// Layer state (Stage A/B): the model, its persistence, and what renderable() — the one
// project the preview and the export both read — does with hidden / muted / solo layers.
// Asserts: defaults for old projects, setLayerState applying without an undo step and
// surviving undo, JSON round-trip, hidden layers leaving the renderable project, muted
// picture layers going silent but staying visible, solo isolating the mix.
import {
  emptyProject, historyReducer, layerSounds, layerStateOf, normalizeProject, renderable, videoLayout,
} from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const media = [
  { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10, width: 720, height: 1280, hasAudio: true },
  { id: 'm2', path: '/x/music.wav', type: 'audio', duration: 10, hasAudio: true },
];
const base = () => ({
  ...emptyProject(), media,
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  overlayClips: [{ id: 'o1', mediaId: 'm1', start: 0, in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], layer: 0 },
    { id: 'o2', mediaId: 'm1', start: 5, in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], layer: 1 }],
  audioClips: [{ id: 'a1', mediaId: 'm2', start: 0, in: 0, out: 5, volume: 1, layer: 0 },
    { id: 'a2', mediaId: 'm2', start: 0, in: 0, out: 5, volume: 1, layer: 1 }],
  textClips: [{ id: 't1', text: 'hi', start: 0, duration: 2, layer: 0 }],
  layers: { overlay: 2, audio: 2 },
});
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const S = (track, layer, patch) => ({ type: 'setLayerState', track, layer, patch });

// --- Defaults: a project without layerState reads all-default and renders as itself.
{
  const p = base();
  delete p.layerState;
  ok(layerStateOf(p, 'audio', 1).muted === false && layerStateOf(p, 'video', 0).locked === false, 'missing layerState reads as defaults');
  ok(renderable(p) === p, 'no state, no disabled clips: renderable is the project itself');
  const loaded = normalizeProject(JSON.parse(JSON.stringify(p)));
  ok(loaded.layerState && typeof loaded.layerState === 'object', 'an old project file normalizes with a layerState object');
}

// --- setLayerState: applies, is NOT an undo step, and undo does not revert it.
{
  let s = { past: [], present: base(), future: [] };
  s = run(s, [{ type: 'renameLayer', track: 'audio', layer: 1, name: 'Music' }]);
  ok(s.past.length === 1, 'a document edit pushed one undo step');
  s = run(s, [S('audio', 1, { muted: true })]);
  ok(layerStateOf(s.present, 'audio', 1).muted === true, 'mute toggle applied');
  ok(s.past.length === 1, 'the toggle pushed NO undo step');
  s = run(s, [{ type: 'undo' }]);
  ok(s.present.layerNames?.audio?.[1] === undefined, 'undo reverted the rename (a document edit)');
  ok(layerStateOf(s.present, 'audio', 1).muted === true, 'undo did NOT revert the mute toggle');
  s = run(s, [S('audio', 1, { muted: false })]);
  ok(!('audio:1' in (s.present.layerState || {})), 'toggling everything off removes the entry (defaults)');
}

// --- Persistence: states survive a JSON save/load round-trip.
{
  let s = { past: [], present: base(), future: [] };
  s = run(s, [S('overlay', 1, { hidden: true }), S('video', 0, { locked: true }), S('audio', 0, { solo: true })]);
  const round = JSON.parse(JSON.stringify(s.present));
  ok(layerStateOf(round, 'overlay', 1).hidden && layerStateOf(round, 'video', 0).locked && layerStateOf(round, 'audio', 0).solo,
    'lock / hide / solo all survive the JSON round-trip');
}

// --- renderable: hidden layers vanish (main track leaves a gap), clips stay in the project.
{
  let s = { past: [], present: base(), future: [] };
  s = run(s, [S('overlay', 1, { hidden: true }), S('text', 0, { hidden: true }), S('audio', 0, { hidden: true })]);
  const r = renderable(s.present);
  ok(r.overlayClips.map((c) => c.id).join(',') === 'o1', 'hidden overlay layer dropped from the render');
  ok(r.textClips.length === 0, 'hidden text layer dropped from the render');
  ok(r.audioClips.map((c) => c.id).join(',') === 'a2', 'hidden audio layer dropped from the render');
  ok(s.present.overlayClips.length === 2 && s.present.audioClips.length === 2, 'the document still holds every clip');
  const s2 = run(s, [S('video', 0, { hidden: true })]);
  const r2 = renderable(s2.present);
  ok(r2.videoClips.every((c) => c.gap) && videoLayout(r2.videoClips).length === 1, 'hidden main track renders as a gap of the same length');
}

// --- renderable: mute silences a picture layer's sound but keeps its picture.
{
  let s = { past: [], present: base(), future: [] };
  s = run(s, [S('video', 0, { muted: true }), S('overlay', 0, { muted: true }), S('audio', 1, { muted: true })]);
  const r = renderable(s.present);
  ok(r.videoClips[0].muted === true && !r.videoClips[0].gap, 'muted main layer: picture stays, sound off');
  ok(r.overlayClips.find((c) => c.id === 'o1').muted === true, 'muted overlay layer: its clips go silent');
  ok(r.overlayClips.find((c) => c.id === 'o2').muted === false, 'the other overlay layer still sounds');
  ok(r.audioClips.map((c) => c.id).join(',') === 'a1', 'muted audio layer leaves the mix');
}

// --- Solo: once anything is soloed, only soloed layers sound (in renderable AND layerSounds).
{
  let s = { past: [], present: base(), future: [] };
  s = run(s, [S('audio', 1, { solo: true })]);
  const p = s.present;
  ok(layerSounds(p, 'audio', 1) && !layerSounds(p, 'audio', 0) && !layerSounds(p, 'video', 0) && !layerSounds(p, 'overlay', 0),
    'layerSounds: the soloed layer alone sounds');
  const r = renderable(p);
  ok(r.audioClips.map((c) => c.id).join(',') === 'a2', 'renderable keeps only the soloed audio layer');
  ok(r.videoClips[0].muted === true && r.overlayClips.every((c) => c.muted), 'renderable silences every non-solo picture layer');
  const s2 = run(s, [S('audio', 1, { solo: false }), S('video', 0, { solo: true })]);
  ok(layerSounds(s2.present, 'video', 0) && !layerSounds(s2.present, 'audio', 1), 'solo on the main layer isolates the main track sound');
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
