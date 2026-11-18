// Swapping what a clip plays keeps its source-time data on the same moment:
// - Stabilize (src/features/inspector/stabilize.js) moves keyframes, the motion-track path, volume keys,
//   the Voice Enhancer window and a linked audio partner's offset with the window, and back on Off;
//   a split half of a stabilized clip turned Off gets back only its own part of the original.
// - A template slot filled with new media (src/features/templates/templates.js fillSlot) keeps its
//   keyframed animation on the beat, and lets go of audio detached from the placeholder.
// Usage: node tests/unit/editor/test-stabilize-window.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer, videoLayout } from '../../../src/state/store.js';
import { baseAt } from '../../../src/features/timeline/anim.js';
import { originalWindow, stabilizeOffUpdates, stabilizeUpdates } from '../../../src/features/inspector/stabilize.js';
import { fillSlot } from '../../../src/features/templates/templates.js';

const base = { speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null };
const load = (p) => historyReducer({ past: [], present: p, future: [] }, { type: 'load', project: p });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

{
  // A clip on source 10..15 with zoom keyframes, a tracked path, volume keys, an enhanced sound and detached audio.
  const p = { ...emptyProject(), media: [
    { id: 'orig', type: 'video', path: '/v.mp4', duration: 30, width: 1920, height: 1080, hasAudio: true },
    { id: 'aud', type: 'audio', path: '/v-detached.m4a', duration: 5 },
  ] };
  p.videoClips = [{ ...base, id: 'c1', mediaId: 'orig', in: 10, out: 15, muted: true, linkId: 'L',
    keyframes: { scale: [{ t: 10, v: 1 }, { t: 12, v: 2 }] }, volumeKeys: [{ t: 11, v: 0.5 }, { t: 13, v: 1 }],
    track: { box: {}, fps: 30, points: [{ t: 10, x: .2, y: .2 }, { t: 15, x: .8, y: .8 }] },
    enhance: { on: true, strength: 1, path: '/e.wav', from: 10, to: 15 } }];
  p.audioClips = [{ id: 'a1', mediaId: 'aud', start: 0, in: 0, out: 5, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, linkId: 'L', linkOff: 0, linkInOff: -10 }];
  let st = load(p);
  const before = st.present.videoClips[0];
  const scales = (c) => [0, 1, 2, 3].map((t) => baseAt(c, t).scale);
  assert.deepEqual(originalWindow(before), { mediaId: 'orig', in: 10, out: 15 });
  const stab = { id: 'stab', type: 'video', path: '/v-stab.mp4', duration: 5, width: 1920, height: 1080, hasAudio: true };
  st = historyReducer(st, { type: 'batch', actions: [{ type: 'addMedia', items: [stab] }, { type: 'updateMany', updates: stabilizeUpdates(st.present, 'video', before, stab, 'recommended') }] });
  const on = st.present.videoClips[0], audio = st.present.audioClips[0];
  assert.equal(on.mediaId, 'stab');assert.equal(on.in, 0);assert.equal(on.out, 5);
  assert.deepEqual(on.stabilize, { level: 'recommended', mediaId: 'orig', in: 10, out: 15 });
  assert.deepEqual(scales(on), scales(before), 'the zoom plays at the same moments');
  assert.deepEqual(on.keyframes.scale.map((k) => k.t), [0, 2]);
  assert.deepEqual(on.track.points.map((q) => q.t), [0, 5], 'the tracked path moves with the window');
  assert.deepEqual(on.volumeKeys.map((q) => q.t), [1, 3]);
  assert.deepEqual([on.enhance.from, on.enhance.to], [0, 5], 'the enhanced sound still matches the window');
  assert.deepEqual([audio.mediaId, audio.in, audio.out, audio.start], ['aud', 0, 5, 0], 'the detached audio still plays the same sound');
  assert.equal(audio.linkInOff, 0);
  assert.equal(st.past.length, 1, 'one undo step');
  // Off restores everything.
  st = historyReducer(st, { type: 'updateMany', updates: stabilizeOffUpdates(st.present, 'video', on) });
  const off = st.present.videoClips[0];
  assert.deepEqual([off.mediaId, off.in, off.out, off.stabilize], ['orig', 10, 15, null]);
  assert.deepEqual(off.keyframes, before.keyframes);assert.deepEqual(off.track, before.track);assert.deepEqual(off.volumeKeys, before.volumeKeys);assert.deepEqual(off.enhance, before.enhance);
  assert.deepEqual(st.present.audioClips[0], p.audioClips[0], 'the partner is exactly as before');
}

{
  // A stabilized clip split in two: Off on the right half gives back only source 13..15.
  const p = { ...emptyProject(), media: [{ id: 'orig', type: 'video', path: '/v.mp4', duration: 30, width: 1920, height: 1080 },
    { id: 'stab', type: 'video', path: '/v-stab.mp4', duration: 5, width: 1920, height: 1080 }, { id: 'next', type: 'video', path: '/n.mp4', duration: 4, width: 1920, height: 1080 }] };
  p.videoClips = [{ ...base, id: 'c1', mediaId: 'stab', in: 0, out: 5, stabilize: { level: 'recommended', mediaId: 'orig', in: 10, out: 15 } }, { ...base, id: 'c2', mediaId: 'next', in: 0, out: 4 }];
  let st = historyReducer(load(p), { type: 'split', track: 'video', id: 'c1', t: 3, newId: 'c1b' });
  const right = st.present.videoClips.find((c) => c.id === 'c1b');
  assert.deepEqual(originalWindow(right), { mediaId: 'orig', in: 13, out: 15 });
  st = historyReducer(st, { type: 'updateMany', updates: stabilizeOffUpdates(st.present, 'video', right) });
  const layout = videoLayout(st.present.videoClips).map((l) => [l.clip.id, l.clip.mediaId, l.clip.in, l.clip.out, l.start, l.end]);
  assert.deepEqual(layout, [['c1', 'stab', 0, 3, 0, 3], ['c1b', 'orig', 13, 15, 3, 5], ['c2', 'next', 0, 4, 5, 9]], 'nothing after the half moves');
  // A new level on the left half renders only its own part (source 10..13).
  const left = st.present.videoClips[0];
  assert.deepEqual(originalWindow(left), { mediaId: 'orig', in: 10, out: 13 });
  const ups = stabilizeUpdates(st.present, 'video', left, { id: 'stab2', duration: 3 }, 'most');
  assert.deepEqual(ups.at(-1).patch.stabilize, { level: 'most', mediaId: 'orig', in: 10, out: 13 });
  assert.equal(ups.at(-1).patch.out, 3);
}

{
  // A template slot with a zoom punch on source 21..22 of the placeholder.
  const p = { ...emptyProject(), media: [{ id: 'ph', type: 'video', path: '/placeholder.mp4', duration: 60, width: 1920, height: 1080, hasAudio: true },
    { id: 'mine', type: 'video', path: '/mine.mp4', duration: 20, width: 1920, height: 1080, hasAudio: true },
    { id: 'short', type: 'video', path: '/short.mp4', duration: 1.5, width: 1920, height: 1080, hasAudio: true },
    { id: 'pic', type: 'image', path: '/pic.png', width: 1920, height: 1080 }] };
  const slot = { ...base, id: 's', mediaId: 'ph', in: 20, out: 23, slot: true, keyframes: { scale: [{ t: 21, v: 1 }, { t: 21.3, v: 1.4 }, { t: 22, v: 1 }] } };
  p.videoClips = [slot];
  const at = [0, 1, 1.3, 2, 2.5];
  const want = at.map((t) => baseAt(slot, t).scale);
  for (const id of ['mine', 'short', 'pic']) {
    let st = load(p);
    st = historyReducer(st, { type: 'update', track: 'video', id: 's', patch: fillSlot(st.present.videoClips[0], st.present.media.find((m) => m.id === id)) });
    const c = st.present.videoClips[0];
    assert.equal(c.mediaId, id);
    at.forEach((t, i) => close(baseAt(c, t).scale, want[i], `${id} scale at ${t}s`));
  }
  // The slot's audio had been detached: filling it unlinks the pair, the sound stays as it was.
  const q = structuredClone(p);
  q.videoClips[0] = { ...q.videoClips[0], muted: true, linkId: 'L' };
  q.media.push({ id: 'det', type: 'audio', path: '/ph-detach.wav', duration: 3 });
  q.audioClips = [{ id: 'a', mediaId: 'det', start: 0, in: 0, out: 3, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, linkId: 'L', linkOff: 0, linkInOff: -20 }];
  let st = load(q);
  st = historyReducer(st, { type: 'update', track: 'video', id: 's', patch: fillSlot(st.present.videoClips[0], st.present.media.find((m) => m.id === 'mine')) });
  const a = st.present.audioClips[0], v = st.present.videoClips[0];
  assert.deepEqual([a.mediaId, a.in, a.out, a.start], ['det', 0, 3, 0], 'the detached sound keeps its source range');
  assert.equal(a.linkId, undefined);assert.equal(v.linkId, undefined);
}
console.log('stabilize window and template fill OK');
