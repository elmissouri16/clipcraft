// The canvas takes the shape of the first picture put on an empty main track ("Original" format),
// unless a format was picked by hand.
// Usage: node scripts/test-ratio.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer, ratioFor } from '../src/store.js';

const reducer = (p, a) => historyReducer({ past: [], present: p, future: [] }, a).present;
const media = [
  { id: 'tall', type: 'video', duration: 5, width: 1080, height: 1920 },
  { id: 'wide', type: 'video', duration: 5, width: 1920, height: 1080 },
  { id: 'sq', type: 'image', width: 800, height: 790 },
  { id: 'nosize', type: 'video', duration: 5 },
];
const start = { ...emptyProject(), media };

assert.equal(ratioFor(1080, 1920), '9:16');
assert.equal(ratioFor(1440, 1080), '4:3');
assert.equal(ratioFor(0, 0), null);

let p = reducer(start, { type: 'addToTimeline', mediaId: 'tall', clipId: 'a' });
assert.deepEqual([p.ratio, p.width, p.height], ['9:16', 720, 1280], 'a tall first video makes a tall canvas');
p = reducer(p, { type: 'addToTimeline', mediaId: 'wide', clipId: 'b' });
assert.equal(p.ratio, '9:16', 'later clips keep the canvas');

p = reducer(start, { type: 'addToTimeline', mediaId: 'sq', clipId: 'a' });
assert.equal(p.ratio, '1:1', 'a photo sets it too');
p = reducer(start, { type: 'addToTimeline', mediaId: 'nosize', clipId: 'a' });
assert.equal(p.ratio, '16:9', 'unknown size keeps the canvas');

// Only gaps left on the track count as empty.
p = reducer({ ...start, videoClips: [{ id: 'g', gap: true, in: 0, out: 2, speed: 1 }] }, { type: 'addToTimeline', mediaId: 'tall', clipId: 'a' });
assert.equal(p.ratio, '9:16');

// A format picked by hand stays.
p = reducer({ ...start, ratio: '16:9', ratioLocked: true }, { type: 'addToTimeline', mediaId: 'tall', clipId: 'a' });
assert.equal(p.ratio, '16:9', 'a format picked by hand stays');

// Undo puts the old canvas back with the clip.
const h = historyReducer({ past: [], present: start, future: [] }, { type: 'addToTimeline', mediaId: 'tall', clipId: 'a' });
assert.equal(historyReducer(h, { type: 'undo' }).present.ratio, '16:9');

console.log('RATIO OK');
