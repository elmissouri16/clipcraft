// Every gap made on the main track gets an id of its own: never the id of the clip it replaces
// (a later lookup of that clip would find the gap) and never one another gap already has.
// Usage: node tests/unit/editor/test-gap-ids.mjs
import { historyReducer, normalizeProject, videoLayout } from '../../../src/state/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const run = (s, ...actions) => actions.reduce((st, a) => historyReducer(st, a), s);
const show = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${l.start}-${l.end}`).join(' ');
const unique = (p) => new Set([...p.videoClips, ...p.overlayClips].map((c) => c.id)).size === p.videoClips.length + p.overlayClips.length;
const trim = (id, edge, delta) => [{ type: 'beginGesture' }, { type: 'trimClip', track: 'video', id, edge, delta }, { type: 'endGesture' }];
const fresh = () => run({ past: [], present: normalizeProject({
  id: 'p', media: [{ id: 'v', type: 'video', path: '/v.mp4', duration: 60, hasAudio: true }],
  videoClips: [{ id: 'a', mediaId: 'v', in: 0, out: 5 }, { id: 'b', mediaId: 'v', in: 10, out: 15 }, { id: 'c', mediaId: 'v', in: 20, out: 25 }],
}), future: [] }, { type: 'setMagnet', track: 'video', on: false });

// Up to the overlay and back: the gap left behind is not "b", so editing b edits the clip.
{
  let s = run(fresh(), { type: 'moveToOverlay', id: 'b', at: 12 }, { type: 'moveToMain', id: 'b', index: 3 });
  ok(unique(s.present), 'no two main/overlay items share an id');
  ok(show(s.present) === 'a@0-5 GAP@5-10 c@10-15 b@15-20', 'b is back at the end, its gap kept');
  s = run(s, { type: 'update', track: 'video', id: 'b', patch: { speed: 2 } });
  ok(show(s.present) === 'a@0-5 GAP@5-10 c@10-15 b@15-17.5', 'a speed change on b changes the clip, not the gap');
  s = run(s, { type: 'delete', track: 'video', id: 'b' });
  ok(show(s.present) === 'a@0-5 GAP@5-10 c@10-15', 'deleting b deletes the clip, and the gap stays');
}

// Two head trims of the same clip at different places make two gaps with different ids.
{
  let s = run(fresh(), ...trim('b', 'left', 1), { type: 'moveVideo', id: 'b', toIndex: 0 }, ...trim('b', 'left', 1));
  const gaps = s.present.videoClips.filter((c) => c.gap);
  ok(gaps.length === 2 && gaps[0].id !== gaps[1].id && unique(s.present), 'the two trim gaps have their own ids');
  s = run(s, { type: 'delete', track: 'video', id: gaps[1].id });
  ok(show(s.present) === 'GAP@0-1 b@1-4 a@4-9 c@9-14', 'deleting one gap removes only that gap');
}

// A tail trim's gap and a delete's gap are fresh too.
{
  const s = run(fresh(), ...trim('a', 'right', 1), { type: 'delete', track: 'video', id: 'c' }, { type: 'delete', track: 'video', id: 'b' });
  ok(unique(s.present) && !s.present.videoClips.some((c) => c.gap && ['a', 'b', 'c'].includes(c.id)), 'no gap takes a clip id');
}

if (fails.length) { console.log(`${fails.length} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');
