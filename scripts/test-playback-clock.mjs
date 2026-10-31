// Playback clock regression tests: interpolation math, the single time→px mapping,
// follow-scroll decisions, and media-anchor corrections (the M-item fixes).
import assert from 'node:assert/strict';
import { interpolateTime, playheadX, followScrollTarget, anchorCorrection } from '../src/playbackClock.js';

// Interpolation: linear in the stamp delta, scaled by rate, exact at the anchor.
assert.equal(interpolateTime(10, 1000, 1000), 10);
assert.equal(interpolateTime(10, 1000, 2000), 11);
assert.equal(interpolateTime(10, 1000, 1500, 2), 11);
assert.ok(Math.abs(interpolateTime(3.25, 500, 516.7) - 3.2667) < 1e-3, 'a 60fps frame advances ~16.7ms');
// Monotonic at display rate: consecutive frames strictly increase while playing forward.
let prev = -Infinity;
for (let f = 0; f < 120; f++) {
  const t = interpolateTime(0, 0, f * 16.7);
  assert.ok(t > prev, 'interpolated time increases every frame');
  prev = t;
}

// Time→px: one mapping, monotonic in time and zoom, header offset respected.
assert.equal(playheadX(0, 60, 152), 152);
assert.equal(playheadX(2.5, 60, 152), 302);
for (const pps of [2, 30, 60, 300]) {
  let last = -Infinity;
  for (let t = 0; t <= 10; t += 0.25) {
    const x = playheadX(t, pps, 152);
    assert.ok(x > last, `playhead x increases with time at ${pps}pps`);
    last = x;
  }
}

// Follow-scroll: no fight while visible; page to ~22% from the left when it leaves.
assert.equal(followScrollTarget(500, 0, 1000, 152), null, 'visible playhead: no scrolling');
assert.equal(followScrollTarget(300, 100, 1000, 152), null, 'right of the sticky header and inside the view: still visible');
const ahead = followScrollTarget(1500, 0, 1000, 152);
assert.ok(ahead !== null && ahead > 0 && 1500 - ahead > 152 && 1500 - ahead < 1000, 'past the right edge: pages forward, playhead back in view');
const behind = followScrollTarget(200, 900, 1000, 152);
assert.ok(behind !== null && behind >= 0 && 200 - behind >= 0, 'behind the header: pages back');

// Anchor corrections vs the media clock.
assert.deepEqual(anchorCorrection(10.2, 10.0), { action: 'snap', time: 10.2 }, 'media ahead: snap forward');
assert.deepEqual(anchorCorrection(9.8, 10.0), { action: 'hold', time: 10.0 }, 'media stalled: hold, never rewind');
assert.equal(anchorCorrection(10.03, 10.0), null, 'within 50ms: keep interpolating');
assert.equal(anchorCorrection(9.97, 10.0), null, 'within 50ms behind: keep interpolating');

console.log('playback-clock ok (interpolation, px mapping, follow, anchor corrections)');
