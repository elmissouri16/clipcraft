import { clipLen, clipLayer, isLayerLocked, videoLayout } from '../../state/store.js';
import { fitFactors } from '../preview/pictureGeometry.js';
import { DEFAULT_TRANSFORM } from '../preview/visual.js';

const S = { type: 'STRING' }, N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' };
export const TRACKING_DECLARATIONS = [
  { name: 'track_subject', description: 'Follow a visible source point through a video clip, optionally reframe it to fill the current canvas (default true). First inspect the raw clip at its timeline START in this request; pass that frame_id and normalized source pick x/y. Tracks a textured patch, not semantic face detection. box w/h .01–.5 optional. Reframe replaces crop, framing keys and picture animation, preserves opacity; no pin. smoothing_sec 0–2 default .2. Weak tracking is rejected unless allow_low_confidence true; always review rendered motion. Max source range 10 minutes.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, frame_id: S, pick: { type: 'OBJECT', properties: { x: N, y: N }, required: ['x', 'y'] }, box: { type: 'OBJECT', properties: { w: N, h: N }, required: ['w', 'h'] }, reframe: B, smoothing_sec: N, allow_low_confidence: B }, required: ['clip_id', 'frame_id', 'pick'] } },
  { name: 'pin_to_subject', description: 'Attach an overlay/text clip to an existing tracked source clip, keeping its initial position and adding the subject’s motion. target_clip_id must have a track_subject path covering the follower interval. Omit target_clip_id to detach. Rejects cycles and pinned sources.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, target_clip_id: S }, required: ['clip_id'] } },
];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function trackingQuality(points, from, to) {
  let weak = 0, weighted = 0, min = 1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], dt = Math.max(0, Math.min(to, points[i + 1]?.t ?? to) - Math.max(from, p.t));
    weighted += p.c * dt;weak += p.c < .35 ? dt : 0;min = Math.min(min, p.c);
  }
  return { mean: weighted / (to - from), minimum: min, weak_fraction: weak / (to - from) };
}
// A zero-phase low-pass removes tracker jitter without a persistent following
// delay. Time-based weights preserve irregularly sampled/simplified paths.
export function smoothTrack(points, seconds) {
  if (!(seconds > 0) || points.length < 3) return points.map(p => ({ ...p }));
  const out = points.map(p => ({ ...p }));
  for (let i = 1; i < out.length; i++) {
    const k = 1 - Math.exp(-(out[i].t - out[i - 1].t) / seconds);
    for (const axis of ['x', 'y']) out[i][axis] = out[i - 1][axis] + k * (out[i][axis] - out[i - 1][axis]);
  }
  for (let i = out.length - 2; i >= 0; i--) {
    const k = 1 - Math.exp(-(out[i + 1].t - out[i].t) / seconds);
    for (const axis of ['x', 'y']) out[i][axis] = out[i + 1][axis] + k * (out[i][axis] - out[i + 1][axis]);
  }
  return out;
}
export function subjectFraming(project, media, clip, points) {
  const { fx, fy } = fitFactors(project, media), scale = Math.max(1 / fx, 1 / fy);
  const keyframes = { ...(clip.keyframes || {}) };
  for (const key of ['scale', 'x', 'y', 'rot']) delete keyframes[key];
  for (const [axis, factor, mirror] of [['x', fx, 'mirror'], ['y', fy, 'flipv']]) {
    const extent = factor * scale, room = Math.max(0, (extent - 1) / 2);
    keyframes[axis] = points.map(p => ({ t: p.t, v: clamp((.5 - (clip.effects?.includes(mirror) ? 1 - p[axis] : p[axis])) * extent, -room, room) }));
  }
  return { crop: { l: 0, t: 0, r: 0, b: 0 }, transform: { ...DEFAULT_TRANSFORM, scale }, keyframes, anim: undefined };
}
export function createTrackingTools({ project, dispatch, after, findClip, api, requestId }) {
  const startOf = f => f.track === 'video' ? videoLayout(project().videoClips).find(row => row.clip.id === f.clip.id).start : f.clip.start;
  const unlocked = f => { if (isLayerLocked(project(), f.track, clipLayer(f.track, f.clip))) throw Error('The selected clip is on a locked layer.'); };
  return {
    async track_subject({ clip_id, frame_id, pick, box = { w: .08, h: .12 }, reframe = true, smoothing_sec = .2, allow_low_confidence = false }) {
      const p = project(), f = findClip(clip_id), m = f && p.media.find(m => m.id === f.clip.mediaId);
      if (!f || !['video', 'overlay'].includes(f.track) || f.clip.gap || m?.type !== 'video') throw Error('Choose a main or overlay video clip.');
      unlocked(f);
      if (f.clip.pin) throw Error('Detach this clip’s pin before tracking/reframing it.');
      if (typeof frame_id !== 'string' || !frame_id || !pick || ![pick.x, pick.y].every(n => finite(n) && n >= 0 && n <= 1)) throw Error('Use an inspected raw starting frame and a normalized source point.');
      if (![box.w, box.h].every(n => finite(n) && n >= .01 && n <= .5)) throw Error('Tracking box w/h must be from .01 to .5.');
      if (!finite(smoothing_sec) || smoothing_sec < 0 || smoothing_sec > 2 || typeof reframe !== 'boolean' || typeof allow_low_confidence !== 'boolean') throw Error('Use smoothing_sec 0–2 and boolean reframe/allow_low_confidence.');
      if (!api.agentMediaJob) throw Error('Restart ClipCraft to load tracking jobs.');
      const c = f.clip;
      const result = await api.agentMediaJob({ requestId, action: 'track', item: m, from: c.in, to: c.out, frame_ids: [frame_id], pick, box });
      if (result?.error) throw Error(result.error);
      const points = result?.points;
      if (!Array.isArray(points) || !points.length || points.length > 20000 || points.some((p, i) => !p || ![p.t, p.x, p.y, p.c].every(finite) || p.t < c.in - .001 || p.t > c.out || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.c < 0 || p.c > 1 || i > 0 && p.t <= points[i - 1].t) || Math.abs(points[0].t - c.in) > .05 || points.at(-1).t < c.out - .15) throw Error('Tracking returned an incomplete or invalid path.');
      const quality = trackingQuality(points, c.in, c.out);
      if (quality.weak_fraction > .35 && !allow_low_confidence) throw Error(`Tracking lost the target for ${Math.round(quality.weak_fraction * 100)}% of the source range. Inspect a clearer source patch or use a shorter clip. No framing was changed. Set allow_low_confidence only to explicitly accept this path.`);
      const track = { box, pick, fps: result.fps, points, quality, method: 'template' };
      const patch = { track, ...(reframe ? subjectFraming(p, m, c, smoothTrack(points, smoothing_sec * (c.speed || 1))) : {}) };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch });
      return after({ clip_id, reframed: reframe, tracking: { points: points.length, source_start_sec: c.in, source_end_sec: c.out, confidence: quality, cached: !!result.cached },
        ...(quality.weak_fraction > 0 ? { warning: 'Some source intervals have weak matches; review actual playback for subject loss.' } : {}) });
    },
    async pin_to_subject({ clip_id, target_clip_id }) {
      const f = findClip(clip_id);
      if (!f || !['overlay', 'text'].includes(f.track)) throw Error('Choose an overlay or text follower.');
      unlocked(f);
      if (!target_clip_id) { dispatch({ type: 'update', track: f.track, id: clip_id, patch: { pin: undefined } });return after({ clip_id, pinned: false }); }
      const target = findClip(target_clip_id);
      if (!target || target.clip.id === clip_id || !['video', 'overlay'].includes(target.track) || !target.clip.track?.points?.length || target.clip.pin) throw Error('Choose a different, unpinned picture source with a tracked path.');
      const start = startOf(f), end = start + (f.track === 'text' ? f.clip.duration : clipLen(f.clip)), sourceStart = startOf(target), sourceEnd = sourceStart + clipLen(target.clip);
      if (start < sourceStart || end > sourceEnd + .001) throw Error('The tracked source must cover the entire follower interval.');
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { pin: { to: target_clip_id } } });
      return after({ clip_id, pinned: true, target_clip_id });
    },
  };
}
