// Timeline layers (like CapCut's tracks): every free clip gets a layer where it fits, empty layers stay, the lists
// keep drawing order and the magnet only moves clips of the same layer.
// Usage: node scripts/test-tracks.mjs
import { emptyProject, historyReducer, layerCount, layerFree } from '../src/store.js';

const assert = (ok, what) => { if (!ok) { console.error('FAIL:', what); process.exit(1); } };
let st = { past: [], present: emptyProject(), future: [] };
const go = (a) => { st = historyReducer(st, a); return st.present; };
const media = [
  { id: 'song', type: 'audio', duration: 20, name: 'song.mp3' },
  { id: 'fx', type: 'audio', duration: 4, name: 'fx.mp3' },
  { id: 'cam', type: 'video', duration: 8, name: 'cam.mp4', width: 1280, height: 720 },
];
go({ type: 'load', project: { ...emptyProject(), media } });

// Music, then a sound at the same time: it goes on a second audio layer (it used to sit on top of the music).
let p = go({ type: 'addToTimeline', mediaId: 'song', clipId: 'a1', at: 0 });
p = go({ type: 'addToTimeline', mediaId: 'fx', clipId: 'a2', at: 2 });
assert(p.audioClips.find((c) => c.id === 'a1').layer === 0 && p.audioClips.find((c) => c.id === 'a2').layer === 1, 'second sound on layer 1');
assert(layerCount(p, 'audio') === 2, 'two audio layers');
// After the music it fits on the first layer again.
p = go({ type: 'addToTimeline', mediaId: 'fx', clipId: 'a3', at: 25 });
assert(p.audioClips.find((c) => c.id === 'a3').layer === 0, 'free space: first layer');
// Dropped on a chosen layer.
p = go({ type: 'addToTimeline', mediaId: 'fx', clipId: 'a4', at: 30, layer: 1 });
assert(p.audioClips.find((c) => c.id === 'a4').layer === 1, 'dropped layer kept');

// Layers stay when emptied; + adds one; an empty one can be removed, a used one cannot.
p = go({ type: 'delete', track: 'audio', id: 'a2' });
p = go({ type: 'delete', track: 'audio', id: 'a4' });
assert(layerCount(p, 'audio') === 2, 'empty layer stays');
p = go({ type: 'addLayer', track: 'audio' });
assert(layerCount(p, 'audio') === 3, 'layer added');
p = go({ type: 'removeLayer', track: 'audio', layer: 0 });
assert(layerCount(p, 'audio') === 3, 'a used layer is not removed');
p = go({ type: 'removeLayer', track: 'audio', layer: 2 });
p = go({ type: 'removeLayer', track: 'audio', layer: 1 });
assert(layerCount(p, 'audio') === 1, 'empty layers removed');

// As many overlays as wanted, each on its own layer, drawn in layer order (higher on top).
['o1', 'o2', 'o3'].forEach((id) => go({ type: 'addOverlayClip', mediaId: 'cam', clipId: id, at: 1 }));
p = st.present;
assert(p.overlayClips.map((c) => c.layer).join() === '0,1,2' && layerCount(p, 'overlay') === 3, 'three overlay layers');
// Moved down onto a used layer: the clip goes to a free one, never on top of another clip.
assert(!layerFree(p, 'overlay', 0, 1, 8, 'o3'), 'layer 0 is busy');
p = go({ type: 'update', track: 'overlay', id: 'o1', patch: { layer: 2 } });
const layers = p.overlayClips.map((c) => c.layer);
assert(new Set(layers).size === 3, `no two overlapping overlays share a layer: ${layers}`);
assert(p.overlayClips.every((c, i) => !i || p.overlayClips[i - 1].layer <= c.layer), 'list in drawing order');

// The magnet closes gaps only on the clip's own layer.
go({ type: 'load', project: { ...emptyProject(), media, magnet: { ...emptyProject().magnet, audio: true },
  audioClips: [
    { id: 'x', mediaId: 'fx', start: 0, in: 0, out: 4, layer: 0 },
    { id: 'y', mediaId: 'fx', start: 4, in: 0, out: 4, layer: 0 },
    { id: 'z', mediaId: 'fx', start: 6, in: 0, out: 4, layer: 1 },
  ] } });
p = go({ type: 'delete', track: 'audio', id: 'x' });
assert(p.audioClips.find((c) => c.id === 'y').start === 0 && p.audioClips.find((c) => c.id === 'z').start === 6, 'magnet stays on its layer');

// An old project (no layers): overlapping texts get the rows they used to show.
p = go({ type: 'load', project: { ...emptyProject(), textClips: [
  { id: 't1', text: 'a', start: 0, duration: 4 }, { id: 't2', text: 'b', start: 1, duration: 2 }, { id: 't3', text: 'c', start: 3.5, duration: 1 },
] } });
const by = Object.fromEntries(p.textClips.map((c) => [c.id, c.layer]));
assert(by.t1 === 0 && by.t2 === 1 && by.t3 === 1, `old project rows: ${JSON.stringify(by)}`);
// Loading gives no undo step and an unchanged project keeps its identity (no needless re-render).
assert(historyReducer(st, { type: 'update', track: 'text', id: 't1', patch: {} }).present.textClips.length === 3, 'update ok');
console.log('TRACKS OK');
