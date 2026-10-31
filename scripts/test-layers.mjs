// Item 13 proofs: layer Duplicate / Delete / Rename on the real store.
// Asserts: deep copies with unique ids placed directly above the original (unlimited — 10x),
// names travelling with their layers through insert/delete renumbering, delete clearing a full
// layer in one step, the main track duplicating onto a new overlay layer with times preserved,
// and JSON save/load round-trips.
import {
  emptyProject, historyReducer, layerCount, layerName, layerOf, uid,
} from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const media = [
  { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10, width: 720, height: 1280 },
  { id: 'm2', path: '/x/b.mp4', type: 'video', duration: 10, width: 720, height: 1280 },
];
const ov = (id, layer, start, extra = {}) => ({
  id, mediaId: 'm1', start, in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [],
  transition: null, layer, transform: { scale: 0.5, x: 0.1, y: 0.1, rot: 0, uniform: true, scaleX: 1, scaleY: 1 },
  keyframes: { scale: [{ t: 0, v: 0.5 }, { t: 1, v: 0.8 }] }, ...extra,
});
function project() {
  const p = emptyProject();
  return {
    ...p, media,
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
      { id: 'v2', mediaId: 'm2', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [ov('o1', 0, 0), ov('o2', 0, 5), ov('o3', 1, 1)],
    layers: { overlay: 2 },
  };
}
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const ids = (n) => Array.from({ length: n }, () => uid());

// --- Duplicate overlay layer 0: copies land on layer 1 (directly above), old layer 1 shifts to 2.
{
  let s = { past: [], present: project(), future: [] };
  const before = s.present.overlayClips.length;
  s = run(s, [{ type: 'duplicateLayer', track: 'overlay', layer: 0, newIds: ids(2) }]);
  const p = s.present;
  ok(layerCount(p, 'overlay') === 3, `layer count 2 -> 3 (got ${layerCount(p, 'overlay')})`);
  const on = (l) => p.overlayClips.filter((c) => layerOf(c) === l);
  ok(on(0).length === 2 && on(1).length === 2 && on(2).length === 1, `layers hold 2 / 2 / 1 clips (got ${on(0).length}/${on(1).length}/${on(2).length})`);
  ok(on(2)[0].id === 'o3', 'the old layer 1 (o3) shifted up to layer 2');
  const allIds = p.overlayClips.map((c) => c.id);
  ok(new Set(allIds).size === allIds.length && p.overlayClips.length === before + 2, 'all ids unique after duplication');
  const copy = on(1).find((c) => c.start === 0);
  const orig = on(0).find((c) => c.id === 'o1');
  ok(copy && copy !== orig && copy.transform !== orig.transform && copy.keyframes !== orig.keyframes,
    'copies are deep (transform/keyframes not shared by reference)');
  ok(copy && JSON.stringify(copy.keyframes) === JSON.stringify(orig.keyframes), 'keyframe content carried over');
  ok(s.past.length === 1, 'duplication is a single undo step');
}
// --- Unlimited: duplicate layer 0 ten more times; ids stay unique; the project JSON round-trips.
{
  let s = { past: [], present: project(), future: [] };
  for (let i = 0; i < 10; i++) {
    const n = s.present.overlayClips.filter((c) => layerOf(c) === 0).length;
    s = run(s, [{ type: 'duplicateLayer', track: 'overlay', layer: 0, newIds: ids(n) }]);
  }
  const p = s.present;
  ok(layerCount(p, 'overlay') === 12, `10 duplicates -> 12 layers (got ${layerCount(p, 'overlay')})`);
  const allIds = p.overlayClips.map((c) => c.id);
  ok(new Set(allIds).size === allIds.length, `all ${allIds.length} clip ids still unique`);
  const round = JSON.parse(JSON.stringify(p));
  ok(layerCount(round, 'overlay') === 12 && round.overlayClips.length === p.overlayClips.length, 'save/load (JSON) round-trips the duplicated project');
}
// --- Rename + delete: names follow their layer through renumbering.
{
  let s = { past: [], present: project(), future: [] };
  s = run(s, [
    { type: 'renameLayer', track: 'overlay', layer: 1, name: 'Titles backup' },
    { type: 'duplicateLayer', track: 'overlay', layer: 0, newIds: ids(2) },
  ]);
  ok(layerName(s.present, 'overlay', 2) === 'Titles backup', `renamed layer shifted 1 -> 2 with its name (got "${layerName(s.present, 'overlay', 2)}")`);
  ok(layerName(s.present, 'overlay', 1) === 'Overlay 2', 'the fresh copy layer has the default name');
  s = run(s, [{ type: 'deleteLayer', track: 'overlay', layer: 0 }]);
  ok(layerName(s.present, 'overlay', 1) === 'Titles backup', 'after deleting layer 0 the name moves down with its layer');
  ok(s.present.overlayClips.every((c) => c.id !== 'o1' && c.id !== 'o2'), 'delete removed the layer clips');
  ok(layerCount(s.present, 'overlay') === 2, `layer count back to 2 (got ${layerCount(s.present, 'overlay')})`);
}
// --- Audio direction: the copy takes the original's row (audio layer 0 is the TOP row).
{
  const p0 = project();
  const p = {
    ...p0, overlayClips: [],
    audioClips: [{ id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 5, volume: 1, layer: 0 }, { id: 'a2', mediaId: 'm1', start: 0, in: 0, out: 5, volume: 1, layer: 1 }],
    layers: { audio: 2 },
  };
  let s = { past: [], present: p, future: [] };
  s = run(s, [{ type: 'duplicateLayer', track: 'audio', layer: 0, newIds: ids(1) }]);
  const at = (l) => s.present.audioClips.filter((c) => layerOf(c) === l).map((c) => c.id);
  ok(at(0).length === 1 && at(0)[0] !== 'a1', 'audio copy sits on layer 0 (the top row)');
  ok(at(1)[0] === 'a1' && at(2)[0] === 'a2', 'original and the layer below shifted down one');
}
// --- Main track: duplicate becomes a new top overlay layer with times preserved; delete clears.
{
  let s = { past: [], present: project(), future: [] };
  s = run(s, [{ type: 'duplicateLayer', track: 'video', layer: 0, newIds: ids(2) }]);
  const p = s.present;
  const top = layerCount(p, 'overlay') - 1;
  const copies = p.overlayClips.filter((c) => layerOf(c) === top);
  ok(copies.length === 2, `both main clips copied to the new overlay layer (got ${copies.length})`);
  ok(copies.map((c) => c.start).join(',') === '0,4', `copy start times match the main-track layout (got ${copies.map((c) => c.start).join(',')})`);
  ok(p.videoClips.length === 2, 'the main track itself is untouched');
  s = run(s, [{ type: 'deleteLayer', track: 'video', layer: 0 }]);
  ok(s.present.videoClips.length === 0, 'delete layer on Main clears the main track');
}
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
