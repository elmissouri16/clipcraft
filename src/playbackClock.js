// Playback clock math (pure, tested by scripts/test-playback-clock.mjs).
//
// The master playback clock is anchored to the lead media element: an anchor pairs a
// media position (timeline seconds) with a performance.now() stamp, and the position at
// any later stamp is interpolated — anchorTime + (stamp − anchorStamp) × rate — so the
// playhead glides at display refresh rate between the media element's own (coarse)
// timeupdate ticks, while re-anchoring keeps it sample-true to the media position.

export const interpolateTime = (anchorTime, anchorStamp, stamp, rate = 1) =>
  anchorTime + ((stamp - anchorStamp) / 1000) * rate;

// The ONE time→px mapping for the timeline: the playhead, the ruler and every clip use
// header + time × pps in content coordinates. Keeping it in one place is what stops the
// playhead drifting away from the clips it points at.
export const playheadX = (time, pps, header) => header + time * pps;

// Follow-scroll decision while playing: returns the scrollLeft that keeps the playhead
// in view, or null when it is already comfortably visible (a manual scroll that keeps
// the playhead on screen is never fought). Re-engages only when the playhead leaves
// the view — past the right edge, or behind the sticky lane header on the left.
export const followScrollTarget = (x, scrollLeft, clientWidth, header) => {
  if (x > scrollLeft + clientWidth - 24) return Math.max(0, x - header - clientWidth * 0.22);
  if (x < scrollLeft + header + 4) return Math.max(0, x - header - clientWidth * 0.22);
  return null;
};

// How the master clock reacts to the lead media element's position:
//  - media ahead by more than the tolerance: snap the anchor forward to the media;
//  - media behind (a stall): hold — freeze the anchor at the current interpolated time
//    so the clock waits instead of running ahead and forcing a jump-cut seek later;
//  - within tolerance: keep interpolating (null = no change).
export const anchorCorrection = (mediaTime, clockTime) => {
  const diff = mediaTime - clockTime;
  if (diff > 0.05) return { action: 'snap', time: mediaTime };
  if (diff < -0.05) return { action: 'hold', time: clockTime };
  return null;
};
