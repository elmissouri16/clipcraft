// Clip animations (In / Out / Combo) and keyframes for picture clips (main track and overlay).
//
// The motion of a clip at a local time (seconds since the clip starts on the timeline) is its transform and
// opacity, keyframed or not, combined with its animation. The player calls stateAt() every frame; the export
// samples the same function (motionCurves) and FFmpeg follows those curves (electron/layers.cjs), so both show
// the same movement. No DOM here: tests import this file directly.

import { DEFAULT_TRANSFORM } from './visual.js';
import { easeValue } from './fx/easing.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const outCubic = (p) => 1 - (1 - p) ** 3;
const inOutSine = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
const outBack = (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
function outBounce(p) {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

// What an animation adds on top of the clip's own transform: scale and opacity multiply, x / y (fractions of the
// frame) and r (degrees) add.
const REST = { s: 1, x: 0, y: 0, r: 0, o: 1 };

// In animations. p goes from 0 (start of the animation) to 1 (the clip at rest). Out animations run them backwards
// (p from 1 to 0), so each one is written once.
const MOVES = {
  fade: (p) => ({ o: p }),
  grow: (p) => ({ s: 0.5 + 0.5 * outCubic(p), o: clamp01(p * 2) }),
  shrink: (p) => ({ s: 1.6 - 0.6 * outCubic(p), o: clamp01(p * 2) }),
  fromRight: (p) => ({ x: 1 - outCubic(p) }),
  fromLeft: (p) => ({ x: outCubic(p) - 1 }),
  fromBottom: (p) => ({ y: 1 - outCubic(p) }),
  fromTop: (p) => ({ y: outCubic(p) - 1 }),
  // Smooth slides: a shorter glide eased at both ends, with a soft fade — the "smooth" feel of pro preset packs.
  smoothFromRight: (p) => ({ x: 0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  smoothFromLeft: (p) => ({ x: -0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  smoothFromBottom: (p) => ({ y: 0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  smoothFromTop: (p) => ({ y: -0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  spin: (p) => ({ r: -180 * (1 - outCubic(p)), s: 0.3 + 0.7 * outCubic(p), o: clamp01(p * 2) }),
  pop: (p) => ({ s: Math.max(0.01, outBack(p)), o: clamp01(p * 3) }),
  drop: (p) => ({ y: outBounce(p) - 1 }),
  swing: (p) => ({ r: 25 * (1 - p) * Math.cos(p * Math.PI * 3.5), o: clamp01(p * 4) }),
  shake: (p) => ({ x: 0.05 * (1 - p) * Math.sin(p * Math.PI * 12), o: clamp01(p * 4) }),
  rock: (p) => ({ y: 0.06 * (1 - p) * Math.sin(p * Math.PI * 10), o: clamp01(p * 4) }),
  twist: (p) => ({ r: 90 * (1 - outCubic(p)), s: 1.4 - 0.4 * outCubic(p), o: clamp01(p * 2) }),
};

// Combo animations play over the whole clip. lt: local time (s), len: clip length (s).
const COMBOS = {
  pulse: (lt) => ({ s: 1 + 0.06 * Math.sin(lt * Math.PI * 2.5) }),
  heartbeat: (lt) => ({ s: 1 + 0.1 * Math.max(0, Math.sin(lt * Math.PI * 2.4)) ** 6 }),
  wobble: (lt) => ({ r: 6 * Math.sin(lt * Math.PI * 2) }),
  sway: (lt) => ({ x: 0.03 * Math.sin(lt * Math.PI * 1.2), r: 2.5 * Math.sin(lt * Math.PI * 1.2 + 0.6) }),
  vibrate: (lt) => ({ x: 0.012 * Math.sin(lt * 47), y: 0.012 * Math.sin(lt * 39 + 1) }),
  bounce: (lt) => ({ y: -0.06 * Math.abs(Math.sin(lt * Math.PI * 1.8)) }),
  kenburns: (lt, len) => ({ s: 1 + 0.18 * inOutSine(clamp01(lt / len)) }),
  pullback: (lt, len) => ({ s: 1.18 - 0.18 * inOutSine(clamp01(lt / len)) }),
  driftRight: (lt, len) => ({ s: 1.12, x: -0.04 + 0.08 * inOutSine(clamp01(lt / len)) }),
  orbit: (lt, len) => ({ r: 360 * inOutSine(clamp01(lt / len)), s: 1 - 0.25 * Math.sin(Math.PI * clamp01(lt / len)) }),
};

// The catalog shown in the Animation tab. move: entry of MOVES (in / out) or COMBOS (combo).
export const ANIMATIONS = {
  in: [
    { id: 'fade_in', name: 'Fade In', move: 'fade', cat: 'Basic' },
    { id: 'zoom_in', name: 'Zoom In', move: 'grow', cat: 'Basic' },
    { id: 'zoom_out_in', name: 'Zoom Out', move: 'shrink', cat: 'Basic' },
    { id: 'slide_left', name: 'Slide Left', move: 'fromRight', cat: 'Slide' },
    { id: 'slide_right', name: 'Slide Right', move: 'fromLeft', cat: 'Slide' },
    { id: 'slide_up', name: 'Slide Up', move: 'fromBottom', cat: 'Slide' },
    { id: 'slide_down', name: 'Slide Down', move: 'fromTop', cat: 'Slide' },
    { id: 'slide_up_smooth', name: 'Slide Up Smooth', move: 'smoothFromBottom', cat: 'Slide' },
    { id: 'slide_down_smooth', name: 'Slide Down Smooth', move: 'smoothFromTop', cat: 'Slide' },
    { id: 'slide_left_smooth', name: 'Slide Left Smooth', move: 'smoothFromRight', cat: 'Slide' },
    { id: 'slide_right_smooth', name: 'Slide Right Smooth', move: 'smoothFromLeft', cat: 'Slide' },
    { id: 'spin_in', name: 'Spin In', move: 'spin', cat: 'Spin' },
    { id: 'twist_in', name: 'Twist', move: 'twist', cat: 'Spin' },
    { id: 'pop_in', name: 'Pop', move: 'pop', cat: 'Bounce' },
    { id: 'drop_in', name: 'Drop', move: 'drop', cat: 'Bounce' },
    { id: 'swing_in', name: 'Swing', move: 'swing', cat: 'Vibration' },
    { id: 'shake_in', name: 'Shake', move: 'shake', cat: 'Vibration' },
    { id: 'rock_in', name: 'Rock Vertically', move: 'rock', cat: 'Vibration' },
  ],
  out: [
    { id: 'fade_out', name: 'Fade Out', move: 'fade', cat: 'Basic' },
    { id: 'zoom_out', name: 'Zoom Out', move: 'grow', cat: 'Basic' },
    { id: 'zoom_in_out', name: 'Zoom In', move: 'shrink', cat: 'Basic' },
    { id: 'slide_left_out', name: 'Slide Left', move: 'fromLeft', cat: 'Slide' },
    { id: 'slide_right_out', name: 'Slide Right', move: 'fromRight', cat: 'Slide' },
    { id: 'slide_up_out', name: 'Slide Up', move: 'fromTop', cat: 'Slide' },
    { id: 'slide_down_out', name: 'Slide Down', move: 'fromBottom', cat: 'Slide' },
    { id: 'slide_up_smooth_out', name: 'Slide Up Smooth', move: 'smoothFromTop', cat: 'Slide' },
    { id: 'slide_down_smooth_out', name: 'Slide Down Smooth', move: 'smoothFromBottom', cat: 'Slide' },
    { id: 'slide_left_smooth_out', name: 'Slide Left Smooth', move: 'smoothFromLeft', cat: 'Slide' },
    { id: 'slide_right_smooth_out', name: 'Slide Right Smooth', move: 'smoothFromRight', cat: 'Slide' },
    { id: 'spin_out', name: 'Spin Out', move: 'spin', cat: 'Spin' },
    { id: 'twist_out', name: 'Twist', move: 'twist', cat: 'Spin' },
    { id: 'pop_out', name: 'Pop', move: 'pop', cat: 'Bounce' },
    { id: 'swing_out', name: 'Swing', move: 'swing', cat: 'Vibration' },
    { id: 'shake_out', name: 'Shake', move: 'shake', cat: 'Vibration' },
    { id: 'rock_out', name: 'Rock Vertically', move: 'rock', cat: 'Vibration' },
  ],
  combo: [
    { id: 'pulse', name: 'Pulse', move: 'pulse', cat: 'Loop' },
    { id: 'heartbeat', name: 'Heartbeat', move: 'heartbeat', cat: 'Loop' },
    { id: 'wobble', name: 'Wobble', move: 'wobble', cat: 'Loop' },
    { id: 'sway', name: 'Sway', move: 'sway', cat: 'Loop' },
    { id: 'vibrate', name: 'Vibrate', move: 'vibrate', cat: 'Loop' },
    { id: 'bounce', name: 'Bounce', move: 'bounce', cat: 'Loop' },
    { id: 'kenburns', name: 'Slow Zoom In', move: 'kenburns', cat: 'Camera' },
    { id: 'pullback', name: 'Slow Zoom Out', move: 'pullback', cat: 'Camera' },
    { id: 'drift', name: 'Pan Right', move: 'driftRight', cat: 'Camera' },
    { id: 'orbit', name: 'Orbit', move: 'orbit', cat: 'Camera' },
  ],
};
export const DEFAULT_ANIM_DURATION = 0.5;
export const animById = (kind, id) => ANIMATIONS[kind].find((a) => a.id === id) || null;

// The clip's animations, kept valid for its length: In and Out never overlap, a Combo replaces both.
export function animOf(clip, len) {
  const a = clip.anim || {};
  if (a.combo && animById('combo', a.combo.type)) return { combo: a.combo };
  const out = {};
  const inA = a.in && animById('in', a.in.type) ? a.in : null;
  const outA = a.out && animById('out', a.out.type) ? a.out : null;
  let di = inA ? Math.max(0.05, inA.duration ?? DEFAULT_ANIM_DURATION) : 0;
  let dout = outA ? Math.max(0.05, outA.duration ?? DEFAULT_ANIM_DURATION) : 0;
  if (di + dout > len && di + dout > 0) {
    const k = len / (di + dout);
    di *= k;
    dout *= k;
  }
  if (inA) out.in = { type: inA.type, duration: di };
  if (outA) out.out = { type: outA.type, duration: dout };
  return out;
}

// Animation part of the motion at local time lt.
export function animState(clip, lt, len) {
  const a = animOf(clip, len);
  const st = { ...REST };
  const mix = (m) => {
    if (m.s !== undefined) st.s *= m.s;
    if (m.o !== undefined) st.o *= m.o;
    if (m.x !== undefined) st.x += m.x;
    if (m.y !== undefined) st.y += m.y;
    if (m.r !== undefined) st.r += m.r;
  };
  if (a.combo) {
    mix(COMBOS[animById('combo', a.combo.type).move](lt, len));
    return st;
  }
  if (a.in && lt < a.in.duration) mix(MOVES[animById('in', a.in.type).move](clamp01(lt / a.in.duration)));
  if (a.out && lt > len - a.out.duration) mix(MOVES[animById('out', a.out.type).move](clamp01((len - lt) / a.out.duration)));
  return st;
}

// Preview of one animation alone, for the Animation tab tiles. p: 0..1 through the animation.
export function previewState(kind, id, p) {
  const a = animById(kind, id);
  if (!a) return { ...REST };
  if (kind === 'combo') return { ...REST, ...COMBOS[a.move](p * 2.4, 2.4) };
  return { ...REST, ...MOVES[a.move](kind === 'in' ? p : 1 - p) };
}

// ---- Keyframes ----
// clip.keyframes: { scale: [{ t, v }], x: [...], y: [...], rot: [...], opacity: [...] } sorted by t. t is in the
// clip's source time (seconds of the media, like clip.in / clip.out), so trimming, splitting or changing the speed
// keeps every keyframe on the same picture, as in CapCut.
export const KEY_PROPS = ['scale', 'x', 'y', 'rot', 'opacity'];
const sourceTime = (clip, lt) => (clip.in || 0) + lt * (clip.speed || 1);
export const localTime = (clip, srcT) => (srcT - (clip.in || 0)) / (clip.speed || 1);

// How a value travels to a keyframe, stored on the keyframe it arrives at ({ t, v, e }), like Remotion's Easing.
// No `e` is linear, so older projects play as before. spring: Remotion's spring without bounce (critically
// damped); back: a small overshoot that settles. The ids below are the original set; segments can also carry
// a cubic-bezier preset id or a custom { p1x, p1y, p2x, p2y } object from fx/easing.js — segEase resolves all
// three vocabularies, and because the export samples stateAt (motionCurves), preview and export agree.
const SPRING_END = 1 - Math.exp(-7) * 8;
export const EASINGS = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  inout: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  spring: (p) => (1 - Math.exp(-7 * p) * (1 + 7 * p)) / SPRING_END,
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
const segEase = (e, p) => {
  if (e == null) return p;
  if (typeof e === 'string' && EASINGS[e]) return EASINGS[e](p);
  return easeValue(e, p);
};

function interp(list, t) {
  if (t <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (list[i].t < t) i++;
  const a = list[i - 1];
  const b = list[i];
  return a.v + (b.v - a.v) * segEase(b.e, (t - a.t) / (b.t - a.t));
}

// ---- Segment easing (the curve editor's keyframe side) ----
// The next arrival keyframe after local time lt: the first key (any property) that has a predecessor in
// its own list and sits after the playhead. Its `e` eases the segment that leads into it.
export function nextArrival(clip, lt, fps = 30) {
  if (!clip.keyframes) return null;
  const tol = (0.5 / fps) * (clip.speed || 1) + EPS;
  let best = null;
  for (const p of KEY_PROPS) {
    const list = clip.keyframes[p] || [];
    for (let i = 1; i < list.length; i++) {
      if (localTime(clip, list[i].t) > lt + tol && (best === null || list[i].t < best)) best = list[i].t;
    }
  }
  return best;
}
// The easing stored on that arrival (first property that has a key there), or undefined.
export function segmentEase(clip, lt, fps = 30) {
  const at = nextArrival(clip, lt, fps);
  if (at === null) return undefined;
  for (const p of KEY_PROPS) {
    const k = (clip.keyframes[p] || []).find((x) => Math.abs(x.t - at) <= EPS);
    if (k) return k.e;
  }
  return undefined;
}
// Patch writing `ease` onto every property's keyframe at that arrival (undefined/'linear' clears it).
export function setSegmentEase(clip, lt, ease, fps = 30) {
  const at = nextArrival(clip, lt, fps);
  if (at === null) return {};
  const keyframes = { ...(clip.keyframes || {}) };
  for (const p of KEY_PROPS) {
    const k = (keyframes[p] || []).find((x) => Math.abs(x.t - at) <= EPS);
    if (k) keyframes[p] = upsert(keyframes[p], at, k.v, ease === undefined ? 'linear' : ease);
  }
  return { keyframes };
}

export const hasKeys = (clip, prop) => !!clip.keyframes?.[prop]?.length;
export const hasAnyKeys = (clip) => KEY_PROPS.some((p) => hasKeys(clip, p));
export const hasMotion = (clip) => hasAnyKeys(clip) || !!(clip.anim && (clip.anim.in || clip.anim.out || clip.anim.combo));

// Transform values (scale, x, y, rot) and opacity at local time lt, keyframes applied, without the animation.
export function baseAt(clip, lt) {
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  const v = { scale: t.scale, x: t.x, y: t.y, rot: t.rot, opacity: clip.opacity === undefined ? 1 : clip.opacity };
  if (clip.keyframes) {
    const st = sourceTime(clip, lt);
    for (const p of KEY_PROPS) if (hasKeys(clip, p)) v[p] = interp(clip.keyframes[p], st);
  }
  return v;
}

// The full motion of a clip at local time lt: { transform (like clip.transform), opacity }.
export function stateAt(clip, lt, len) {
  const b = baseAt(clip, lt);
  const a = animState(clip, lt, len);
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  return {
    transform: { ...t, scale: b.scale * a.s, x: b.x + a.x, y: b.y + a.y, rot: b.rot + a.r },
    opacity: Math.max(0, Math.min(1, b.opacity * a.o)),
  };
}

const EPS = 1e-4;
// Keyframe of `prop` at local time lt (within half a frame), or null.
export function keyAt(clip, prop, lt, fps = 30) {
  const st = sourceTime(clip, lt);
  const tol = (0.5 / fps) * (clip.speed || 1) + EPS;
  return (clip.keyframes?.[prop] || []).find((k) => Math.abs(k.t - st) <= tol) || null;
}

// Times (local) of the clip's keyframes, for the given props, sorted and without duplicates.
export function keyTimes(clip, props = KEY_PROPS) {
  const set = new Set();
  props.forEach((p) => (clip.keyframes?.[p] || []).forEach((k) => set.add(Math.round(localTime(clip, k.t) * 1000) / 1000)));
  return [...set].sort((a, b) => a - b);
}

// Sets the keyframe at t; a keyframe replaced there keeps its easing unless `e` is given.
function upsert(list, t, v, e) {
  const old = (list || []).find((k) => Math.abs(k.t - t) <= EPS);
  const out = (list || []).filter((k) => k !== old);
  const ease = e ?? old?.e;
  out.push(ease && ease !== 'linear' ? { t, v, e: ease } : { t, v });
  return out.sort((a, b) => a.t - b.t);
}

// Adds (or replaces) keyframes of `props` at local time lt with the clip's current values there. Returns the patch.
// A keyframe created where none existed starts a new segment, which defaults to Smooth; replacing an existing
// keyframe keeps its easing (upsert with no `e`).
export function addKeys(clip, props, lt) {
  const b = baseAt(clip, lt);
  const st = sourceTime(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  props.forEach((p) => {
    const isNew = !(keyframes[p] || []).some((k) => Math.abs(k.t - st) <= EPS);
    keyframes[p] = upsert(keyframes[p], st, b[p], isNew ? 'smooth' : undefined);
  });
  return { keyframes };
}

// Moves every keyframe at local time `from` (any property) to local time `to`, like dragging a diamond on the
// timeline in CapCut. A keyframe already at `to` is replaced. Returns the patch.
export function moveKeys(clip, from, to, fps = 30) {
  const st = sourceTime(clip, to);
  const keyframes = { ...(clip.keyframes || {}) };
  KEY_PROPS.forEach((p) => {
    const k = keyAt(clip, p, from, fps);
    if (k) keyframes[p] = upsert(keyframes[p].filter((x) => x !== k), st, k.v, k.e);
  });
  return { keyframes };
}

// Removes the keyframes of `props` at local time lt. Returns the patch; a property left without keyframes keeps
// the value it had there.
export function removeKeys(clip, props, lt, fps = 30) {
  const b = baseAt(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  let opacity = clip.opacity;
  props.forEach((p) => {
    const k = keyAt(clip, p, lt, fps);
    if (!k) return;
    keyframes[p] = keyframes[p].filter((x) => x !== k);
    if (!keyframes[p].length) {
      delete keyframes[p];
      if (p === 'opacity') opacity = b.opacity;
      else t[p] = b[p];
    }
  });
  return { keyframes, transform: t, opacity };
}

// Patch for an edit of transform / opacity values made at local time lt (inspector, player handles): a property
// that has keyframes gets a keyframe at lt, the others change for the whole clip. values: { scale, x, y, rot,
// opacity, and any other transform field such as uniform or scaleX }.
export function editAt(clip, values, lt) {
  const st = sourceTime(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  const patch = {};
  let keyed = false;
  for (const [p, v] of Object.entries(values)) {
    if (KEY_PROPS.includes(p) && hasKeys(clip, p)) {
      const isNew = !(keyframes[p] || []).some((k) => Math.abs(k.t - st) <= EPS);
      keyframes[p] = upsert(keyframes[p], st, v, isNew ? 'smooth' : undefined);
      keyed = true;
    } else if (p === 'opacity') patch.opacity = v;
    else t[p] = v;
  }
  patch.transform = t;
  if (keyed) patch.keyframes = keyframes;
  return patch;
}

// ---- Export ----
// The motion as point lists for FFmpeg, sampled at every frame and simplified (straight runs merged) within a
// tolerance far below a pixel. Each list is [[t, v], ...] in local seconds; one point means a constant.
const TOL = { s: 0.002, x: 0.0006, y: 0.0006, r: 0.1, o: 0.004 };

function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = a + 1;
    // Extend the segment while every point in between stays on the line within tol.
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

const round = (v) => Math.round(v * 1e5) / 1e5;
export function motionCurves(clip, len, fps) {
  const n = Math.max(1, Math.ceil(len * fps));
  const raw = { s: [], x: [], y: [], r: [], o: [] };
  for (let i = 0; i <= n; i++) {
    const lt = Math.min(len, i / fps);
    const m = stateAt(clip, lt, len);
    raw.s.push([lt, m.transform.scale]);
    raw.x.push([lt, m.transform.x]);
    raw.y.push([lt, m.transform.y]);
    raw.r.push([lt, m.transform.rot]);
    raw.o.push([lt, m.opacity]);
  }
  const out = {};
  for (const k of Object.keys(raw)) {
    const pts = raw[k].map(([t, v]) => [round(t), round(v)]);
    const flat = pts.every(([, v]) => Math.abs(v - pts[0][1]) <= TOL[k] / 4);
    out[k] = flat ? [pts[0]] : simplify(pts, TOL[k]);
  }
  return out;
}

// Curves of every animated picture clip, keyed by clip id (sent with the project when exporting).
export function motionData(project) {
  const out = {};
  const fps = project.fps || 30;
  for (const c of project.videoClips) {
    if (c.gap || !hasMotion(c)) continue;
    out[c.id] = motionCurves(c, (c.out - c.in) / (c.speed || 1), fps);
  }
  for (const c of project.overlayClips || []) {
    if (!hasMotion(c)) continue;
    out[c.id] = motionCurves(c, (c.out - c.in) / (c.speed || 1), fps);
  }
  return out;
}
