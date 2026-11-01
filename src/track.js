// Motion tracking, renderer side: the tracked path stored on a clip (clip.track, produced by
// electron/track.cjs) and the pin that ties a follower clip to it (clip.pin = { to: <clip id> }).
//
// Representation: the SOURCE clip keeps the path — { box, fps, points: [{ t, x, y, c }] } with t in the
// clip's SOURCE seconds and x/y the target's center in fractions of the MEDIA frame (the same time base
// clip.keyframes use, so trims and speed changes keep the path on the same picture). The FOLLOWER keeps
// only the reference. Nothing is baked into the follower's keyframes: the offset is evaluated live here,
// from the same functions in the preview and in the export's curve sampling, so the two cannot drift —
// and the follower's own keyframes stay exactly as the user made them. Deleting the source clip (or its
// track) resolves the pin to "no offset" here, and the store strips the reference on delete, so a pin
// can never dangle.
//
// The offset at timeline time T is path(sourceTime(T)) - path(sourceTime(followerStart)): the follower
// keeps whatever position it had when it started, then travels with the target. Path deltas are in media
// fractions; they are scaled by the source media's fit into the project frame (a portrait phone clip in a
// landscape frame moves its target less, in frame fractions). The source clip's OWN transform/keyframes
// are not compounded — tracking is meant for a plain full-frame clip (the normal case is exact).
import { videoLayout, clipLen, freeLen } from './store.js';
import { stateAt, hasMotion } from './anim.js';

export const CLIP_LISTS = [
  ['video', 'videoClips'],
  ['overlay', 'overlayClips'],
  ['text', 'textClips'],
  ['audio', 'audioClips'],
];

export function findClipAnywhere(project, id) {
  for (const [track, key] of CLIP_LISTS) {
    const clip = (project[key] || []).find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

// Every clip that carries a usable track (for the pin menus).
export function trackedClips(project) {
  const out = [];
  for (const [track, key] of CLIP_LISTS) {
    for (const clip of project[key] || []) {
      if (clip.track && Array.isArray(clip.track.points) && clip.track.points.length) out.push({ track, clip });
    }
  }
  return out;
}

// Where a clip starts on the timeline (the main track's starts come from its layout).
export function clipStartTl(project, track, clip) {
  if (track === 'video') {
    const item = videoLayout(project.videoClips).find((l) => l.clip.id === clip.id);
    return item ? item.start : 0;
  }
  return clip.start || 0;
}

export function clipLenTl(track, clip) {
  if (track === 'video') return clipLen(clip);
  if (track === 'overlay' || track === 'audio') return freeLen(track, clip);
  return clip.duration || 0;
}

// The tracked position (media-frame fractions) at a source time: linear between points, clamped at the ends.
export function trackAt(track, srcT) {
  const pts = track.points;
  if (!pts.length) return null;
  if (srcT <= pts[0].t) return { x: pts[0].x, y: pts[0].y };
  const last = pts[pts.length - 1];
  if (srcT >= last.t) return { x: last.x, y: last.y };
  let i = 1;
  while (pts[i].t < srcT) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const k = (srcT - a.t) / (b.t - a.t || 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// How much of the frame the source media's fitted picture occupies (width / height fractions): path
// deltas scale by this on their way from media fractions to frame fractions.
export function fitFactors(project, media) {
  const mw = media?.width;
  const mh = media?.height;
  if (!mw || !mh || !project.width || !project.height) return { fx: 1, fy: 1 };
  const k = Math.min(project.width / mw, project.height / mh);
  return { fx: (mw * k) / project.width, fy: (mh * k) / project.height };
}

const srcTimeAt = (clip, startTl, tlT) => (clip.in || 0) + (tlT - startTl) * (clip.speed || 1);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Stage (project-frame) fractions <-> media-frame fractions, through the same fit the picture uses:
// the tracking pick works in what the user sees; the path is stored in media fractions. (Assumes the
// clip is shown plainly fitted — its own transform/crop are not part of the pick mapping.)
export function stageToMedia(project, media, sx, sy) {
  const { fx, fy } = fitFactors(project, media);
  return { x: clamp01((sx - (1 - fx) / 2) / (fx || 1)), y: clamp01((sy - (1 - fy) / 2) / (fy || 1)) };
}
export function mediaToStage(project, media, p) {
  const { fx, fy } = fitFactors(project, media);
  return { x: (1 - fx) / 2 + p.x * fx, y: (1 - fy) / 2 + p.y * fy };
}

// The pin offset (project-frame fractions) a follower gets at timeline time tlT — { dx, dy }, zeros when
// the pin is missing, dangling, or the anchor moment itself. fRef: { track, clip } of the follower.
export function pinOffsetAt(project, fRef, tlT) {
  const zero = { dx: 0, dy: 0 };
  const pin = fRef?.clip?.pin;
  if (!pin || !pin.to) return zero;
  const src = findClipAnywhere(project, pin.to);
  if (!src || !src.clip.track || !src.clip.track.points?.length) return zero;
  const srcStart = clipStartTl(project, src.track, src.clip);
  const fStart = clipStartTl(project, fRef.track, fRef.clip);
  const media = src.clip.mediaId && (project.media || []).find((m) => m.id === src.clip.mediaId);
  const { fx, fy } = fitFactors(project, media);
  const p = trackAt(src.clip.track, srcTimeAt(src.clip, srcStart, tlT));
  const p0 = trackAt(src.clip.track, srcTimeAt(src.clip, srcStart, fStart));
  if (!p || !p0) return zero;
  return { dx: (p.x - p0.x) * fx, dy: (p.y - p0.y) * fy };
}

export const hasPin = (clip) => !!(clip && clip.pin && clip.pin.to);

// stateAt with the pin offset applied (the follower's own animation/keyframes first, the track on top).
export function stateAtPinned(project, fRef, lt, len) {
  const clip = fRef.clip;
  const base = stateAt(clip, lt, len);
  if (!hasPin(clip)) return base;
  const startTl = clipStartTl(project, fRef.track, clip);
  const off = pinOffsetAt(project, fRef, startTl + lt);
  if (!off.dx && !off.dy) return base;
  return {
    transform: { ...base.transform, x: base.transform.x + off.dx, y: base.transform.y + off.dy },
    opacity: base.opacity,
  };
}

// ---- Export curves ----
// The same sampling src/anim.js motionCurves does (same frame grid, rounding and simplification), but
// through stateAtPinned, so a pinned clip's curves carry its own motion plus the track's. Unpinned clips
// produce exactly the curves motionData would.
const TOL = { s: 0.002, x: 0.0006, y: 0.0006, r: 0.1, o: 0.004 };
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = a + 1;
    while (b + 1 < pts.length) {
      const c = b + 1;
      const [ta, va] = pts[a];
      const [tc, vc] = pts[c];
      let ok = true;
      for (let i = a + 1; i < c && ok; i++) {
        const [ti, vi] = pts[i];
        if (Math.abs(va + ((vc - va) * (ti - ta)) / (tc - ta) - vi) > tol) ok = false;
      }
      if (!ok) break;
      b = c;
    }
    out.push(pts[b]);
    a = b;
  }
  return out;
}
const round5 = (v) => Math.round(v * 1e5) / 1e5;

export function motionCurvesPinned(project, fRef, len, fps) {
  const n = Math.max(1, Math.ceil(len * fps));
  const raw = { s: [], x: [], y: [], r: [], o: [] };
  for (let i = 0; i <= n; i++) {
    const lt = Math.min(len, i / fps);
    const m = stateAtPinned(project, fRef, lt, len);
    raw.s.push([lt, m.transform.scale]);
    raw.x.push([lt, m.transform.x]);
    raw.y.push([lt, m.transform.y]);
    raw.r.push([lt, m.transform.rot]);
    raw.o.push([lt, m.opacity]);
  }
  const out = {};
  for (const k of Object.keys(raw)) {
    const pts = raw[k].map(([t, v]) => [round5(t), round5(v)]);
    const flat = pts.every(([, v]) => Math.abs(v - pts[0][1]) <= TOL[k] / 4);
    out[k] = flat ? [pts[0]] : simplify(pts, TOL[k]);
  }
  return out;
}

// Drop-in replacement for anim.js motionData: identical for unpinned clips; pinned video/overlay clips
// are included even without keyframes of their own, with the track folded into their x/y curves.
export function motionDataPinned(project) {
  const out = {};
  const fps = project.fps || 30;
  for (const c of project.videoClips) {
    if (c.gap || (!hasMotion(c) && !hasPin(c))) continue;
    out[c.id] = motionCurvesPinned(project, { track: 'video', clip: c }, (c.out - c.in) / (c.speed || 1), fps);
  }
  for (const c of project.overlayClips || []) {
    if (!hasMotion(c) && !hasPin(c)) continue;
    out[c.id] = motionCurvesPinned(project, { track: 'overlay', clip: c }, (c.out - c.in) / (c.speed || 1), fps);
  }
  return out;
}

// The project with every pin that points at one of `removedIds` (or at a clip that no longer has a
// track) taken off its followers. Returns the same object when nothing changed.
export function cleanPins(project, removedIds = new Set()) {
  let changed = false;
  const lists = {};
  for (const [, key] of CLIP_LISTS) {
    lists[key] = (project[key] || []).map((c) => {
      if (!hasPin(c)) return c;
      const src = removedIds.has(c.pin.to) ? null : findClipAnywhere(project, c.pin.to);
      if (src && src.clip.track?.points?.length) return c;
      changed = true;
      const { pin, ...rest } = c;
      return rest;
    });
  }
  return changed ? { ...project, ...lists } : project;
}
