// Item 12 proofs C: timeline-model semantics for Delete left/right (Q/W) and split.
// Runs the real store: historyReducer + trimActions + videoLayout. Asserts:
//  - Q/W land as exactly ONE undo step when wrapped in the gesture App now uses;
//  - with the main-track magnet ON, deleting the left part ripples the track closed (later
//    clips shift by the removed length, total duration shrinks, no gap clip remains);
//  - other tracks are untouched; split preserves total duration.
import {
  emptyProject, historyReducer, trimActions, uid, videoLayout, projectDuration,
} from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const media = [
  { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10 },
  { id: 'm2', path: '/x/b.mp4', type: 'video', duration: 10 },
  { id: 'm3', path: '/x/tone.wav', type: 'audio', duration: 10 },
];
const clip = (id, mediaId, extra = {}) => ({
  id, mediaId, in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, ...extra,
});
function project() {
  const p = emptyProject();
  return {
    ...p, media,
    videoClips: [clip('v1', 'm1'), clip('v2', 'm2')],
    audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 8, volume: 1 }],
  };
}
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);

// --- Q on v2 (starts at 4, playhead at 6): delete the left 2 s of v2, ripple closed.
{
  const p = project();
  const audioShape = (pp) => pp.audioClips.map((a) => [a.id, a.start, a.in, a.out]);
  const audioBefore = JSON.stringify(audioShape(p));
  let s = { past: [], present: p, future: [] };
  const before = s.past.length;
  s = run(s, [{ type: 'beginGesture' }, ...trimActions(p, { track: 'video', id: 'v2', t: 6, side: 'left', newId: 'v2b' }), { type: 'endGesture' }]);
  ok(s.past.length === before + 1, `Q lands as exactly one undo step (past ${before} -> ${s.past.length})`);
  const layout = videoLayout(s.present.videoClips);
  const videoEnd = Math.max(...layout.map((l) => l.end));
  ok(Math.abs(videoEnd - 6) < 1e-9, `ripple closed: video track 8 -> 6 (got ${videoEnd})`);
  ok(!layout.some((l) => l.clip.gap), 'no gap clip left behind');
  const v2rest = layout.find((l) => l.clip.id === 'v2b');
  ok(v2rest && Math.abs(v2rest.start - 4) < 1e-9 && Math.abs(v2rest.clip.in - 2) < 1e-9, `surviving part starts at 4 with in=2 (start ${v2rest?.start}, in ${v2rest?.clip.in})`);
  ok(JSON.stringify(audioShape(s.present)) === audioBefore, 'audio track untouched (same clips, same times)');
  const undone = historyReducer(s, { type: 'undo' });
  ok(Math.abs(projectDuration(undone.present) - 8) < 1e-9, 'one Undo restores the full 8 s');
}
// --- W on v1 (playhead at 1.5): delete the right part, v2 shifts up against v1's remainder.
{
  const p = project();
  let s = { past: [], present: p, future: [] };
  s = run(s, [{ type: 'beginGesture' }, ...trimActions(p, { track: 'video', id: 'v1', t: 1.5, side: 'right', newId: 'v1b' }), { type: 'endGesture' }]);
  const layout = videoLayout(s.present.videoClips);
  const videoEnd = Math.max(...layout.map((l) => l.end));
  ok(Math.abs(videoEnd - 5.5) < 1e-9, `W ripple: video track 8 -> 5.5 (got ${videoEnd})`);
  const v2 = layout.find((l) => l.clip.id === 'v2');
  ok(v2 && Math.abs(v2.start - 1.5) < 1e-9, `v2 shifted to start at 1.5 (got ${v2?.start})`);
}
// --- Split preserves duration and source continuity.
{
  const p = project();
  let s = { past: [], present: p, future: [] };
  s = run(s, [{ type: 'split', track: 'video', id: 'v1', t: 2.5, newId: 'v1b' }]);
  const layout = videoLayout(s.present.videoClips);
  const parts = layout.filter((l) => ['v1', 'v1b'].includes(l.clip.id));
  ok(parts.length === 2 && Math.abs(projectDuration(s.present) - 8) < 1e-9, 'split keeps total duration');
  ok(Math.abs(parts[1].clip.in - 2.5) < 1e-9, `second part continues the source at in=2.5 (got ${parts[1]?.clip.in})`);
  ok(uid() !== uid(), 'uid sanity');
}
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
