// Edits keep everything that belongs together in time together:
// - audio magnet: deleting or trimming a clip on an audio layer leaves Detach-audio sound (which
//   follows its picture) where it is, instead of refusing the whole edit; deleting a picture/sound
//   pair removes both in either order;
// - a trim drag on a linked pair follows the pointer on both sides, move after move;
// - split, trims and a magnet-off delete next to a transition keep its overlap: no later clip moves;
// - Reverse mirrors source-time data, keeps a linked partner in place, and un-reversing a cut piece
//   restores only that piece's part of the original;
// - a range cut removes the same timeline span from a picture and its offset linked mic; a cut inside a
//   transition overlap is refused with nothing changed.
// Usage: node tests/unit/editor/test-timeline-edit-sync.mjs
import assert from 'node:assert/strict';
import { cutRanges, historyReducer, normalizeProject, videoLayout } from '../../../src/state/store.js';
import { forwardWindow, reverseEase, reverseUpdates, unreverseUpdates } from '../../../src/features/timeline/reverse.js';

const R = (st, ...as) => as.reduce((s, a) => historyReducer(s, a), st);
const start = (p) => ({ past: [], present: p, future: [] });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const media = [{ id: 'm', type: 'video', duration: 60, hasAudio: true }, { id: 's', type: 'audio', duration: 10 }];

{ // C1: audio magnet ripple and linked sound.
  const p = { ...normalizeProject({}), media,
    videoClips: [{ id: 'A', mediaId: 'm', in: 0, out: 5, speed: 1 }, { id: 'B', mediaId: 'm', in: 10, out: 15, speed: 1, muted: true, linkId: 'L' }],
    audioClips: [{ id: 'X', mediaId: 's', start: 0, in: 0, out: 3, speed: 1, volume: 1 }, { id: 'Y', mediaId: 'm', start: 5, in: 10, out: 15, speed: 1, linkId: 'L', linkOff: 0, linkInOff: 0, volume: 1 },
      { id: 'Z', mediaId: 's', start: 3, in: 0, out: 1, speed: 1, volume: 1 }],
    textClips: [] };
  const del = R(start(p), { type: 'delete', track: 'audio', id: 'X' });
  assert.notEqual(del.present, p, 'deleting a sound before linked audio is applied');
  const at = (st, id) => st.present.audioClips.find((c) => c.id === id)?.start;
  assert.equal(at(del, 'Y'), 5, 'the linked sound stays under its picture');
  assert.equal(at(del, 'Z'), 0, 'an unlinked sound after it ripples');
  const trim = R(start(p), { type: 'beginGesture' }, { type: 'trimClip', track: 'audio', id: 'X', edge: 'right', delta: 1 }, { type: 'endGesture' });
  assert.equal(at(trim, 'Y'), 5);assert.equal(at(trim, 'Z'), 2);assert.equal(trim.past.length, 1, 'the trim is applied');
  // Two main clips with their detached sound back to back; delete one pair, in both selection orders.
  const q = { ...normalizeProject({}), media,
    videoClips: [{ id: 'A', mediaId: 'm', in: 0, out: 5, speed: 1, muted: true, linkId: 'LA' }, { id: 'B', mediaId: 'm', in: 10, out: 15, speed: 1, muted: true, linkId: 'LB' }],
    audioClips: [{ id: 'YA', mediaId: 'm', start: 0, in: 0, out: 5, speed: 1, linkId: 'LA', linkOff: 0, linkInOff: 0, volume: 1 }, { id: 'YB', mediaId: 'm', start: 5, in: 10, out: 15, speed: 1, linkId: 'LB', linkOff: 0, linkInOff: 0, volume: 1 }],
    textClips: [] };
  for (const order of [[['audio', 'YA'], ['video', 'A']], [['video', 'A'], ['audio', 'YA']]]) {
    const st = R(start(q), { type: 'beginGesture', group: true }, ...order.map(([track, id]) => ({ type: 'delete', track, id })), { type: 'endGesture', group: true });
    assert.deepEqual(st.present.videoClips.map((c) => c.id), ['B'], `order ${order.map((o) => o[1])}: the picture is gone`);
    assert.deepEqual(st.present.audioClips.map((c) => [c.id, c.start, c.linkId]), [['YB', 0, 'LB']], `order ${order.map((o) => o[1])}: the sound is gone and the other pair follows its picture`);
  }
}

{ // C2: trim drags on a linked pair, picture on the main track and on an overlay.
  for (const overlay of [false, true]) for (const track of overlay ? ['audio', 'overlay'] : ['audio', 'video']) {
    const pic = { id: 'b', mediaId: 'm', in: 5, out: 10, speed: 1, linkId: 'L', muted: true };
    const p = { ...normalizeProject({}), media, magnet: { video: true, overlay: true, audio: true, text: false },
      videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 4, speed: 1 }, ...(overlay ? [] : [pic])], overlayClips: overlay ? [{ ...pic, start: 4 }] : [],
      audioClips: [{ id: 'au', mediaId: 'm', start: 4, in: 5, out: 10, speed: 1, linkId: 'L', linkOff: 0, linkInOff: 0, volume: 1 }], textClips: [] };
    let st = R(start(p), { type: 'beginGesture' });
    for (const d of [0.5, 1, 1.5, 2, 1]) {
      st = R(st, { type: 'trimClip', track, id: track === 'audio' ? 'au' : 'b', edge: 'right', delta: d });
      const b = [...st.present.videoClips, ...st.present.overlayClips].find((c) => c.id === 'b'), au = st.present.audioClips[0];
      assert.deepEqual([b.out, au.out], [10 - d, 10 - d], `${overlay ? 'overlay' : 'main'} picture, dragging the ${track} edge to ${d}`);
    }
  }
}

{ // C3: edits next to a transition keep its overlap.
  const p = { ...normalizeProject({}), media: [{ id: 'm', type: 'video', duration: 60 }], magnet: { video: false, overlay: false, audio: true, text: false },
    videoClips: [{ id: 'A', mediaId: 'm', in: 0, out: 5, speed: 1 }, { id: 'B', mediaId: 'm', in: 10, out: 15, speed: 1, transition: { type: 'fade', duration: 1 } },
      { id: 'C', mediaId: 'm', in: 20, out: 25, speed: 1, transition: { type: 'fade', duration: 2.4 } }, { id: 'D', mediaId: 'm', in: 30, out: 33, speed: 1 }],
    textClips: [], audioClips: [] };
  const spans = (q) => Object.fromEntries(videoLayout(q.videoClips).filter((l) => !l.clip.gap).map((l) => [l.clip.id, [l.start, l.end]]));
  const before = spans(p);
  const same = (q, ids, msg) => ids.forEach((id) => { close(spans(q)[id][0], before[id][0], `${msg}: ${id} start`); close(spans(q)[id][1], before[id][1], `${msg}: ${id} end`); });
  same(R(start(p), { type: 'split', track: 'video', id: 'B', t: before.B[0] + 1.5, newId: 'B2' }).present, ['A', 'C', 'D'], 'split after the fade');
  same(R(start(p), { type: 'split', track: 'video', id: 'C', t: before.C[0] + 3.5, newId: 'C2' }).present, ['A', 'B', 'D'], 'split near the next clip');
  assert.equal(R(start(p), { type: 'split', track: 'video', id: 'B', t: before.B[0] + 0.5, newId: 'B2' }).present, p, 'a split inside the fade is refused');
  for (const [id, edge, delta, keep] of [['C', 'right', 2, ['A', 'B']], ['B', 'right', 3, ['A']], ['B', 'left', 0.5, ['A', 'C', 'D']], ['C', 'left', 2.5, ['A', 'B', 'D']], ['D', 'left', 0.5, ['A', 'B', 'C']]]) {
    const q = R(start(p), { type: 'trimClip', track: 'video', id, edge, delta }).present;
    assert.notEqual(q, p, `trim ${id} ${edge} applies`);
    same(q, keep, `trim ${id} ${edge} by ${delta}`);
    close(spans(q)[id][edge === 'left' ? 1 : 0], before[id][edge === 'left' ? 1 : 0], `trim ${id} ${edge}: the far edge stays`);
  }
  const short = R(start(p), { type: 'trimClip', track: 'video', id: 'C', edge: 'right', delta: 4.5 }).present;
  assert.ok(spans(short).C[1] - spans(short).C[0] >= 2.4 - 1e-9, 'a trim stops at the overlap of the transition at the far edge');
  same(R(start(p), { type: 'delete', track: 'video', id: 'B' }).present, ['A', 'C', 'D'], 'delete leaving a gap');
}

{ // C4/B2: Reverse with a linked sound, then a piece of a reversed clip back to the original.
  assert.equal(reverseEase('easeIn'), 'easeOut');assert.equal(reverseEase('smooth'), 'smooth');assert.equal(reverseEase(reverseEase('overshoot')), 'overshoot');
  const p = { ...normalizeProject({}), media: [{ id: 'm', type: 'video', duration: 60, hasAudio: true }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 30, out: 40, speed: 1, muted: true, linkId: 'L', keyframes: { scale: [{ t: 31, v: 1 }, { t: 35, v: 2, e: 'easeIn' }] },
      track: { fps: 30, points: [{ t: 30, x: .1, y: .1 }, { t: 40, x: .9, y: .9 }] }, volumeKeys: [{ t: 0, v: 1 }, { t: 35, v: .5 }, { t: 50, v: 1 }] }],
    audioClips: [{ id: 'au', mediaId: 'm', start: 0, in: 30, out: 40, speed: 1, linkId: 'L', linkOff: 0, linkInOff: 0, volume: 1 }], textClips: [] };
  const rev = { id: 'r', type: 'video', duration: 10, hasAudio: true };
  let st = R(start(p), { type: 'addMedia', items: [rev] }, { type: 'updateMany', updates: reverseUpdates(p, 'video', p.videoClips[0], rev) });
  let v = st.present.videoClips[0], au = st.present.audioClips[0];
  assert.deepEqual([v.mediaId, v.in, v.out], ['r', 0, 10]);
  assert.deepEqual(v.keyframes.scale, [{ t: 5, v: 2 }, { t: 9, v: 1, e: 'easeOut' }], 'keyframes mirror (t -> out - t) with their segment ease played backwards');
  assert.deepEqual(v.track.points.map((q) => q.t), [0, 10]);
  assert.ok(v.volumeKeys.every((k) => k.t >= 0) && Math.abs(v.volumeKeys.find((k) => k.t === 5).v - .5) < 1e-9, 'volume keys mirror inside the window');
  assert.deepEqual([au.mediaId, au.in, au.out, au.start], ['m', 30, 40, 0], 'the linked sound keeps its source window');
  st = R(st, { type: 'updateMany', updates: unreverseUpdates(st.present, 'video', v) });
  v = st.present.videoClips[0];au = st.present.audioClips[0];
  assert.deepEqual([v.mediaId, v.in, v.out, v.reversed], ['m', 30, 40, null]);
  assert.deepEqual(v.keyframes, p.videoClips[0].keyframes);assert.deepEqual(v.volumeKeys, p.videoClips[0].volumeKeys);
  assert.deepEqual([au.in, au.out, au.linkInOff], [30, 40, 0]);
  // A cut piece of a reversed clip: R plays original 10..20 backwards; the piece plays R 0..2 = original 18..20.
  const piece = { id: 'k', mediaId: 'r', in: 0, out: 2, speed: 1, reversed: { mediaId: 'm', in: 10, out: 20 }, keyframes: { x: [{ t: 1, v: .3 }] } };
  assert.deepEqual(forwardWindow(piece), { mediaId: 'm', in: 18, out: 20 });
  const q = { ...normalizeProject({}), media: p.media, videoClips: [piece], textClips: [], audioClips: [] };
  const back = R(start(q), { type: 'updateMany', updates: unreverseUpdates(q, 'video', piece) }).present.videoClips[0];
  assert.deepEqual([back.mediaId, back.in, back.out, back.keyframes.x[0].t], ['m', 18, 20, 19], 'only the piece comes back, with its own keyframes');
}

{ // B1: a picture and its separately recorded mic, placed 0.8 s later (linkOff).
  const p = { ...normalizeProject({}), media: [{ id: 'cam', type: 'video', duration: 20, hasAudio: true }, { id: 'mic', type: 'audio', duration: 25, hasAudio: true }],
    videoClips: [{ id: 'v', mediaId: 'cam', in: 0, out: 12, speed: 1, muted: true, linkId: 'L' }],
    audioClips: [{ id: 'a', mediaId: 'mic', in: 0, out: 12, start: 0.8, speed: 1, linkId: 'L', linkOff: 0.8, linkInOff: 0 }], textClips: [] };
  const q = cutRanges(p, [{ start: 2.8, end: 3.2 }], { ripple: true });
  const mic = q.audioClips.map((c) => [c.in, c.out, c.start]);
  assert.equal(mic.length, 2);
  close(mic[0][1], 2.0, 'the mic loses what plays at timeline 2.8 (source 2.0)');close(mic[1][0], 2.4, 'up to timeline 3.2 (source 2.4)');close(mic[1][2], 2.8, 'its rest follows the cut');
  const pic = videoLayout(q.videoClips).map((l) => [l.clip.in, l.clip.out]);
  close(pic[0][1], 2.8, 'the picture loses the same timeline span');close(pic[1][0], 3.2, 'the picture resumes after it');
  // A cut that does not touch the pair keeps the link.
  const late = cutRanges({ ...p, videoClips: [{ id: 'w', mediaId: 'cam', in: 0, out: 4, speed: 1 }, ...p.videoClips], audioClips: [{ ...p.audioClips[0], start: 4.8 }] }, [{ start: 1, end: 2 }], { ripple: true });
  assert.equal(late.audioClips[0].linkId, 'L');close(late.audioClips[0].start, 3.8, 'the linked mic shifts with its picture');
}

{ // B3: a cut with both ends inside a transition overlap is refused, nothing changed.
  const p = { ...normalizeProject({}), media: [{ id: 'A', type: 'video', duration: 30 }, { id: 'B', type: 'video', duration: 30 }],
    videoClips: [{ id: 'a', mediaId: 'A', in: 0, out: 10, speed: 1 }, { id: 'b', mediaId: 'B', in: 0, out: 11, speed: 1, transition: { type: 'fade', duration: 1 } }],
    textClips: [{ id: 't', text: 'B line', start: 12, duration: 2 }], audioClips: [] };
  assert.equal(cutRanges(p, [{ start: 9.2, end: 9.8 }], { ripple: true }), p);
  const st = R(start(p), { type: 'cutRanges', ranges: [{ start: 9.2, end: 9.8 }], ripple: true });
  assert.equal(st.present, p, 'the refused cut leaves the project as it was');
  const ok = cutRanges(p, [{ start: 9.5, end: 12 }], { ripple: true });
  assert.notEqual(ok, p, 'a cut from inside the overlap to after it still applies');
  close(videoLayout(ok.videoClips).at(-1).end, 20 - 2.5, 'and removes exactly its span');close(ok.textClips[0].start, 12 - 2.5, 'captions move by the same span');
}
console.log('timeline edit sync OK');
