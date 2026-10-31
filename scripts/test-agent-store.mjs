// Unit checks for cutRanges and collapseHistory. Usage: node scripts/test-agent-store.mjs
import assert from 'node:assert/strict';
import { cutRanges, historyReducer, normalizeProject, videoLayout, projectDuration } from '../src/store.js';

const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${+l.start.toFixed(2)}-${+l.end.toFixed(2)}[${+l.clip.in.toFixed(2)}..${+l.clip.out.toFixed(2)}]`).join(' ');
const base = () => ({ ...normalizeProject({}), media: [{ id: 'm', type: 'video', duration: 30 }], videoClips: [mk('a', 10)] });

// Cut the middle of one clip: two pieces, the source in/out points stay right, the timeline closes up.
let p = cutRanges(base(), [{ start: 3, end: 5 }]);
assert.equal(layout(p), 'a@0-3[0..3] a-c1@3-8[5..10]');
assert.equal(projectDuration(p), 8);

// Several cuts, given out of order, including one at the very start and one at the end.
p = cutRanges(base(), [{ start: 8, end: 10 }, { start: 0, end: 1 }, { start: 4, end: 5 }]);
assert.equal(layout(p), 'a@0-3[1..4] a-c1@3-6[5..8]');

// A cut that spans a clip boundary trims both neighbours.
let q = { ...base(), videoClips: [mk('a', 5), mk('b', 5)] };
q = cutRanges(q, [{ start: 4, end: 6 }]);
assert.equal(layout(q), 'a@0-4[0..4] b@4-8[1..5]');

// A cut that covers a whole clip removes it.
q = cutRanges({ ...base(), videoClips: [mk('a', 5), mk('b', 5), mk('c', 5)] }, [{ start: 5, end: 10 }]);
assert.equal(layout(q), 'a@0-5[0..5] c@5-10[0..5]');

// Speed is respected: a 2x clip of 10 source seconds lasts 5 timeline seconds.
q = cutRanges({ ...base(), videoClips: [mk('a', 10, { speed: 2 })] }, [{ start: 1, end: 2 }]);
assert.equal(layout(q), 'a@0-1[0..2] a-c1@1-4[4..10]');

// Tiny cuts are ignored; the project is returned unchanged.
const same = base();
assert.equal(cutRanges(same, [{ start: 2, end: 2.005 }]), same);

// collapseHistory folds many edits into one undo step.
let st = { past: [], present: base(), future: [] };
const startLen = st.past.length;
st = historyReducer(st, { type: 'cutRanges', ranges: [{ start: 1, end: 2 }] });
st = historyReducer(st, { type: 'cutRanges', ranges: [{ start: 1, end: 2 }] });
st = historyReducer(st, { type: 'cutRanges', ranges: [{ start: 1, end: 2 }] });
assert.equal(st.past.length, 3);
st = historyReducer(st, { type: 'collapseHistory', from: startLen });
assert.equal(st.past.length, 1);
assert.equal(projectDuration(st.present), 7);
st = historyReducer(st, { type: 'undo' });
assert.equal(projectDuration(st.present), 10);

console.log('AGENT STORE OK');
