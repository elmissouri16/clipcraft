// Travel along a path: one smooth journey through waypoints (troops across a map, a ship along a
// coast, a camera drifting over an illustration). Written as ordinary keyframes at the waypoints
// with easing 'continuous' (src/features/timeline/anim.js), so the motion flows through every
// waypoint instead of stopping at each one, stays editable in the inspector, and survives trims,
// splits and speed changes like any keyframe. Measured right away with motionQuality.
import { CONTINUOUS, KEY_PROPS } from '../timeline/anim.js';
import { motionQuality } from '../timeline/motionQuality.js';
import { stateAtPinned } from '../timeline/track.js';

const N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' }, S = { type: 'STRING' };
export const PATH_DECLARATIONS = [
  { name: 'move_along_path', description: 'Move a main/overlay clip along waypoints as ONE smooth journey: from rest, through every point without stopping, to rest. points: 2–24 x/y (set_transform offsets), optional scale and time_sec (timeline; each all or none; default even speed). start_sec/end_sec default to the clip. orient faces the travel direction; heading_deg = way the artwork faces (0 right, 90 down, 180 left). Replaces x/y (scale/rotation) keys in range. Returns motion.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, points: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: N, y: N, scale: N, time_sec: N }, required: ['x', 'y'] } },
      start_sec: N, end_sec: N, orient: B, heading_deg: N }, required: ['clip_id', 'points'] } },
];

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const r3 = (n) => Math.round(n * 1000) / 1000;

// Keys of the journey in local seconds: { x: [[lt, v, e]], y, scale?, rot? }. Without explicit
// times, waypoints are spaced by on-screen distance; the first and last legs get 1.5x their share,
// because they accelerate from and settle to rest (an even share makes the speed bulge there).
export function pathKeys(points, { from, to, width, height, orient = false, heading = 0 }) {
  const n = points.length, px = points.map((p) => [p.x * width, p.y * height]);
  let times;
  if (points.every((p) => finite(p.time_sec))) times = points.map((p) => p.time_sec);
  else {
    const legs = px.slice(1).map((q, i) => Math.max(1e-6, Math.hypot(q[0] - px[i][0], q[1] - px[i][1])) * (n > 2 && (i === 0 || i === n - 2) ? 1.5 : 1));
    const total = legs.reduce((a, b) => a + b, 0);
    times = [from]; for (const leg of legs) times.push(times.at(-1) + (to - from) * leg / total);
    times[n - 1] = to;
  }
  const key = (i, v) => [times[i], v, i ? CONTINUOUS : undefined];
  const out = { x: points.map((p, i) => key(i, p.x)), y: points.map((p, i) => key(i, p.y)) };
  if (points.every((p) => finite(p.scale))) out.scale = points.map((p, i) => key(i, p.scale));
  if (orient) {
    let previous = null;
    out.rot = px.map((_, i) => {
      const a = px[Math.max(0, i - 1)], b = px[Math.min(n - 1, i + 1)];
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI - heading;
      // Unwrap, so the picture turns the short way between waypoints.
      if (previous !== null) angle = previous + ((angle - previous + 540) % 360) - 180;
      previous = angle;
      return key(i, angle);
    });
  }
  return { times, keys: out };
}

export function createPathTools({ project, dispatch, after, needPicture }) {
  return {
    async move_along_path({ clip_id, points, start_sec, end_sec, orient = false, heading_deg = 0 }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      if (!Array.isArray(points) || points.length < 2 || points.length > 24) return { error: 'Give 2 to 24 points.' };
      if (points.some((p) => !finite(p?.x) || !finite(p?.y) || Math.abs(p.x) > 2 || Math.abs(p.y) > 2)) return { error: 'Every point needs x and y between -2 and 2 (canvas offsets from the centre).' };
      const scaled = points.filter((p) => p.scale !== undefined), timed = points.filter((p) => p.time_sec !== undefined);
      if (scaled.length && (scaled.length < points.length || scaled.some((p) => !finite(p.scale) || p.scale < 0.01 || p.scale > 10))) return { error: 'Give scale (0.01–10) on every point or on none.' };
      if (timed.length && timed.length < points.length) return { error: 'Give time_sec on every point or on none.' };
      if (!finite(heading_deg)) return { error: 'heading_deg must be a number.' };
      const p = project(), clipEnd = f.start + f.len;
      const a = finite(start_sec) ? start_sec : timed.length ? points[0].time_sec : f.start;
      const b = finite(end_sec) ? end_sec : timed.length ? points.at(-1).time_sec : clipEnd;
      if (a < f.start - 0.01 || b > clipEnd + 0.01 || b - a < 0.2) return { error: `The journey must last at least 0.2 s inside the clip (${r3(f.start)}s to ${r3(clipEnd)}s).` };
      if (timed.length && points.some((q, i) => q.time_sec < a - 0.01 || q.time_sec > b + 0.01 || (i && q.time_sec - points[i - 1].time_sec < 0.05))) return { error: 'Point times must rise by at least 0.05 s and stay inside start_sec..end_sec.' };
      const local = (t) => Math.min(f.len, Math.max(0, t - f.start));
      const { keys } = pathKeys(timed.length ? points.map((q) => ({ ...q, time_sec: local(q.time_sec) })) : points,
        { from: local(a), to: local(b), width: p.width || 1920, height: p.height || 1080, orient, heading: heading_deg });
      // Keys in source time, like add_keyframes; existing keys of these properties inside the journey go.
      const src = (lt) => (f.clip.in || 0) + lt * (f.clip.speed || 1), lo = src(local(a)) - 1e-4, hi = src(local(b)) + 1e-4;
      const keyframes = { ...(f.clip.keyframes || {}) };
      for (const [prop, list] of Object.entries(keys)) {
        if (!KEY_PROPS.includes(prop)) continue;
        const kept = (keyframes[prop] || []).filter((k) => k.t < lo || k.t > hi);
        keyframes[prop] = [...kept, ...list.map(([lt, v, e]) => ({ t: src(lt), v, ...(e ? { e } : {}) }))].sort((x, y) => x.t - y.t);
      }
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { keyframes } });
      const clip = { ...f.clip, keyframes };
      const motion = motionQuality((lt) => stateAtPinned(p, { clip, track: f.track }, lt, f.len),
        { len: f.len, fps: p.fps || 30, width: p.width || 1920, height: p.height || 1080, start: f.start, entrance: f.track === 'overlay' });
      return after({ waypoints: points.length, journey_sec: r3(b - a), properties: Object.keys(keys), motion });
    },
  };
}
