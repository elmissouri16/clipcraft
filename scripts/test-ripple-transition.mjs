// Fix 1 proofs: ripple delete-left (Q) must preserve the clip's incoming transition.
// Runs the real store: historyReducer + trimActions + videoLayout + transitionDur.
// Before the fix, splitAt built the right half with `transition: null` and Q deleted the
// left half (the one carrying the transition), so the remainder lost it silently.
// The surviving transition object is stored verbatim (as everywhere else in the store);
// its EFFECTIVE length is clamped at use time by transitionDur — half of either
// neighbour — exactly like the plain split/trim paths. These tests lock that in.
import assert from 'node:assert';
import {
  emptyProject, historyReducer, trimActions, transitionDur, videoLayout,
} from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const media = [
  { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10 },
  { id: 'm2', path: '/x/b.mp4', type: 'video', duration: 10 },
];
const clip = (id, mediaId, extra = {}) => ({
  id, mediaId, in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, ...extra,
});
// The E2E shape: an FX-style transition (type + duration + ease) into v2.
const TR = { type: 'fade', duration: 0.7, ease: 'smooth' };
function project() {
  const p = emptyProject();
  return { ...p, media, videoClips: [clip('v1', 'm1'), clip('v2', 'm2', { transition: { ...TR } })] };
}
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const gesture = (p, actions) => run({ past: [], present: p, future: [] }, [{ type: 'beginGesture' }, ...actions, { type: 'endGesture' }]);

// Layout sanity: v1 [0,4]; v2 overlaps by td=0.7 -> [3.3, 7.3].
{
  const layout = videoLayout(project().videoClips);
  ok(near(layout[1].start, 3.3) && near(layout[1].end, 7.3), `fixture layout v2 [3.3, 7.3] (got [${layout[1].start}, ${layout[1].end}])`);
}

// --- Q on v2 at t=5: the remainder keeps the incoming transition, verbatim.
{
  const p = project();
  const s = gesture(p, trimActions(p, { track: 'video', id: 'v2', t: 5, side: 'left', newId: 'v2b' }));
  ok(s.past.length === 1, 'Q lands as exactly one undo step');
  const layout = videoLayout(s.present.videoClips);
  const rest = layout.find((l) => l.clip.id === 'v2b');
  ok(!!rest, 'remainder clip v2b exists');
  try {
    assert.deepStrictEqual(rest.clip.transition, TR);
    ok(true, `remainder keeps the transition verbatim ${JSON.stringify(rest.clip.transition)}`);
  } catch {
    ok(false, `remainder keeps the transition verbatim (got ${JSON.stringify(rest.clip.transition)})`);
  }
  // Still adjacent to v1, overlapping by the (clamped) transition: start 4 - 0.7, end 5.6.
  ok(near(rest.start, 3.3) && near(rest.end, 5.6), `remainder still overlaps v1 by the transition [3.3, 5.6] (got [${rest.start}, ${rest.end}])`);
  ok(near(rest.clip.in, 1.7), `remainder source in=1.7 (got ${rest.clip.in})`);
  const undone = historyReducer(s, { type: 'undo' });
  try {
    assert.deepStrictEqual(undone.present.videoClips, p.videoClips);
    ok(true, 'one Undo restores the pre-Q clips exactly');
  } catch {
    ok(false, 'one Undo restores the pre-Q clips exactly');
  }
}

// --- W on v2 at t=5: the kept left part is the original clip — transition untouched.
{
  const p = project();
  const s = gesture(p, trimActions(p, { track: 'video', id: 'v2', t: 5, side: 'right', newId: 'v2b' }));
  const layout = videoLayout(s.present.videoClips);
  const kept = layout.find((l) => l.clip.id === 'v2');
  ok(!!kept && !layout.some((l) => l.clip.id === 'v2b'), 'W keeps v2 and deletes the right part');
  try {
    assert.deepStrictEqual(kept.clip.transition, TR);
    ok(true, 'W leaves the incoming transition untouched');
  } catch {
    ok(false, `W leaves the incoming transition untouched (got ${JSON.stringify(kept.clip.transition)})`);
  }
  ok(near(kept.start, 3.3) && near(kept.end, 5), `W remainder [3.3, 5] (got [${kept.start}, ${kept.end}])`);
}

// --- Stored verbatim, clamped at use: Q leaving a 0.8 s remainder under a 0.7 s transition.
{
  const p = project();
  const s = gesture(p, trimActions(p, { track: 'video', id: 'v2', t: 6.5, side: 'left', newId: 'v2b' }));
  const layout = videoLayout(s.present.videoClips);
  const rest = layout.find((l) => l.clip.id === 'v2b');
  try {
    assert.deepStrictEqual(rest.clip.transition, TR);
    ok(true, 'short remainder: transition still stored verbatim (no second clamp invented)');
  } catch {
    ok(false, `short remainder: transition stored verbatim (got ${JSON.stringify(rest.clip.transition)})`);
  }
  // transitionDur clamps the effective overlap to half the remainder (0.8/2 = 0.4).
  ok(near(transitionDur(s.present.videoClips, 1), 0.4), `effective overlap clamped by transitionDur to 0.4 (got ${transitionDur(s.present.videoClips, 1)})`);
  ok(near(rest.start, 3.6), `layout uses the clamped overlap: start 3.6 (got ${rest.start})`);
}

// --- Whole-clip consumption: Q/W can never eat a whole clip (guards return []), and a
// plain delete removes the transition WITH the clip — nothing inherits it.
{
  const p = project();
  ok(trimActions(p, { track: 'video', id: 'v2', t: 7.29, side: 'left', newId: 'x' }).length === 0, 'Q within MIN_CLIP of the end is a no-op');
  ok(trimActions(p, { track: 'video', id: 'v2', t: 3.31, side: 'right', newId: 'x' }).length === 0, 'W within MIN_CLIP of the start is a no-op');
  const s = run({ past: [], present: p, future: [] }, [{ type: 'delete', track: 'video', id: 'v2' }]);
  ok(!s.present.videoClips.some((c) => c.transition), 'deleting the whole clip takes its transition with it');
  ok(s.present.videoClips.length === 1 && s.present.videoClips[0].id === 'v1', 'v1 untouched by the delete');
}

// --- Non-video tracks: Q on an audio clip still splits + deletes as before.
{
  const p0 = emptyProject();
  const p = {
    ...p0, media: [{ id: 'm3', path: '/x/tone.wav', type: 'audio', duration: 10 }],
    audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 8, volume: 1 }],
  };
  const s = gesture(p, trimActions(p, { track: 'audio', id: 'a1', t: 3, side: 'left', newId: 'a1b' }));
  const rest = s.present.audioClips.find((c) => c.id === 'a1b');
  // Audio magnet defaults on: deleting the left part ripples the remainder to 0, source in=3.
  ok(!!rest && near(rest.in, 3) && near(rest.start, 0), `audio Q unchanged: remainder ripples to start 0 with in=3 (got start ${rest?.start}, in ${rest?.in})`);
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
