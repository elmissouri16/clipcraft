// Sequence mismatch detection. Usage: node scripts/test-sequence.mjs
import assert from 'assert/strict';
import { mismatchFor, sequencePatchFor } from '../src/sequence.js';
import { emptyProject } from '../src/store.js';

const proj = { ...emptyProject(), width: 1920, height: 1080, ratio: '16:9', resolution: 1080, fps: 30, ratioLocked: true };
const vid = (w, h, fps) => ({ type: 'video', width: w, height: h, fps, duration: 5 });

// Exact match: no dialog.
assert.equal(mismatchFor(proj, vid(1920, 1080, 30)), null, 'identical video matches');
// 29.97 vs 30 is within tolerance.
assert.equal(mismatchFor(proj, vid(1920, 1080, 29.97)), null, 'fps tolerance');
// Resolution only.
let m = mismatchFor(proj, vid(1280, 720, 30));
assert.deepEqual(m.fields, ['resolution']);
assert.deepEqual([m.video.w, m.video.h], [1280, 720]);
// Ratio + resolution (portrait phone video in a landscape project).
m = mismatchFor(proj, vid(1080, 1920, 30));
assert.ok(m.fields.includes('ratio') && m.fields.includes('resolution'));
assert.equal(m.video.ratio, '9:16');
// fps only.
m = mismatchFor(proj, vid(1920, 1080, 60));
assert.deepEqual(m.fields, ['fps']);
// Unknown fps never fires fps.
assert.equal(mismatchFor(proj, vid(1920, 1080, 0)), null, 'unknown fps ignored');
assert.equal(mismatchFor(proj, vid(1920, 1080, undefined)), null, 'missing fps ignored');
// Audio and size-less media never fire.
assert.equal(mismatchFor(proj, { type: 'audio', duration: 3 }), null);
assert.equal(mismatchFor(proj, { type: 'video', duration: 3 }), null);
// Images compare size/ratio (no fps).
m = mismatchFor(proj, { type: 'image', width: 1080, height: 1080 });
assert.ok(m && m.fields.includes('ratio'), 'square image mismatches a 16:9 project');

// Adopting a clip's settings: ratio, size via sizeFor, fps, locked.
const patch = sequencePatchFor(vid(1080, 1920, 60));
assert.equal(patch.ratio, '9:16');
assert.equal(patch.width, 1080);
assert.equal(patch.height, 1920);
assert.equal(patch.fps, 60);
assert.equal(patch.ratioLocked, true);
const patch2 = sequencePatchFor(vid(1920, 1080, 24));
assert.deepEqual([patch2.width, patch2.height, patch2.fps], [1920, 1080, 24]);
console.log('sequence OK: match/mismatch, fps tolerance, image handling and adopt-patch verified');
