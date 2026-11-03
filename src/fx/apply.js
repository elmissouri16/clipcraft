// Which animated effects act at a moment, shared by the player and the export.
// Effects come from two places:
//   - on a clip (clip.effects): they last the whole clip, their time T starts with the clip;
//   - on the Effects track (project.effectClips: { id, fx, start, duration }): free objects you move and trim;
//     they act on every picture under them, their time T starts with the effect.
// The Effects panel offers the same tiles for both places, including the six classic effects of
// src/effects.js (blur, grain, vignette, pixel, mirror, flipv). On a clip those run through CSS
// (preview) and FFmpeg look filters (export); on the track they need a shader form, because a
// track effect covers only part of a clip. TRACK_CLASSIC below is that form — the same looks as
// shader passes, so the player and the export bake them identically over the covered frames.
// (Before this map existed, a classic effect on the Effects track rendered NOTHING anywhere:
// freeOn collected the clip, then both pass builders discarded it as neither pixel nor overlay.)
import { OVERLAY_EFFECTS, PIXEL_EFFECTS } from './catalog.js';
import { freeLen, videoLayout } from '../store.js';
import { gradeExpr, hasGrade } from './grade.js';
import { getLut, lutOn } from './lut.js';
import { filterExpr, hasFilter, lutFilterRef } from './filters.js';

const PIXEL = Object.fromEntries(PIXEL_EFFECTS.map((e) => [e.id, e.expr]));
const OVERLAY = Object.fromEntries(OVERLAY_EFFECTS.map((e) => [e.id, e.draw]));
export const isPixel = (id) => !!PIXEL[id];
export const isOverlay = (id) => !!OVERLAY[id];

// Shader forms of the classic effects, for Effects-track use (strengths mirror the per-clip
// export filters in electron/ffmpeg.cjs: boxblur, noise alls=18, iw/24 mosaic, vignette).
const TRACK_CLASSIC = {
  blur: `st(0, H*0.012); (S(X, Y)*2 + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0)) + S(X+ld(0), Y+ld(0)) + S(X-ld(0), Y-ld(0)) + S(X+ld(0), Y-ld(0)) + S(X-ld(0), Y+ld(0)))/10`,
  grain: `S(X, Y) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*36`,
  pixel: `st(0, max(2, W/24)); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`,
  vignette: `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); S(X, Y) * (1 - 0.6*smooth(0.4, 1.0, ld(0)))`,
  mirror: `S(W - 1 - X, Y)`,
  flipv: `S(X, H - 1 - Y)`,
};
export const isClassic = (id) => !!TRACK_CLASSIC[id];
// Effects that end up baked into a clip's frames by the export's effects pass.
export const isShaderFx = (id) => isPixel(id) || isClassic(id);

const freeOn = (project, t) => (project.effectClips || []).filter((e) => !e.disabled && t >= e.start && t < e.start + e.duration);

// Shader passes for a picture clip that starts at clipStart on the timeline, lt seconds into it: [{ expr, T }].
// The clip's color grade (Adjust) comes first, then its effects, then the free effects over it.
export function pixelPasses(project, clip, clipStart, lt) {
  const list = [];
  // The filter first, then the LUT, then the Adjust settings on top of them.
  // A filter is one look: one of ours (an expression) or a LUT ("lut:<file>"), at the filter intensity.
  if (lutFilterRef(clip)) {
    const l = getLut(lutFilterRef(clip));
    if (l) list.push({ lut: l, K: (clip.filterIntensity ?? 100) / 100 });
  } else {
    const look = hasFilter(clip) ? filterExpr(clip) : null;
    if (look) list.push({ expr: look, T: lt });
  }
  const lut = lutOn(clip.grade?.lut) ? getLut(clip.grade.lut.ref) : null;
  if (lut) list.push({ lut, K: (clip.grade.lut.intensity ?? 100) / 100 });
  const grade = hasGrade(clip) ? gradeExpr(clip.grade) : null;
  if (grade) list.push({ expr: grade, T: lt });
  list.push(...(clip.effects || []).filter(isPixel).map((id) => ({ expr: PIXEL[id], T: lt })));
  const t = clipStart + lt;
  for (const e of freeOn(project, t)) {
    if (isPixel(e.fx)) list.push({ expr: PIXEL[e.fx], T: t - e.start });
    else if (isClassic(e.fx)) list.push({ expr: TRACK_CLASSIC[e.fx], T: t - e.start });
  }
  return list;
}

// True when some pixel effect touches the clip's time range (it then needs the effects pass at export).
export function clipHasPixelFx(project, clip, clipStart, len) {
  if (hasFilter(clip) || hasGrade(clip) || lutOn(clip.grade?.lut) || (clip.effects || []).some(isPixel)) return true;
  return (project.effectClips || []).some((e) => !e.disabled && isShaderFx(e.fx) && e.start < clipStart + len && e.start + e.duration > clipStart);
}

// Particle / light layers drawn over the frame at time t (project pixels W x H).
export function drawOverlayPasses(ctx, project, t, W, H) {
  for (const l of videoLayout(project.videoClips)) {
    if (l.clip.gap || t < l.start || t >= l.end) continue;
    for (const id of l.clip.effects || []) if (OVERLAY[id]) OVERLAY[id](ctx, W, H, t - l.start);
  }
  for (const c of project.overlayClips || []) {
    if (t < c.start || t >= c.start + freeLen('overlay', c)) continue;
    for (const id of c.effects || []) if (OVERLAY[id]) OVERLAY[id](ctx, W, H, t - c.start);
  }
  for (const e of freeOn(project, t)) if (OVERLAY[e.fx]) OVERLAY[e.fx](ctx, W, H, t - e.start);
}

// Time ranges with a particle / light layer, so the export knows which frames to draw.
export function overlayRanges(project) {
  const has = (c) => (c.effects || []).some(isOverlay);
  return [
    ...videoLayout(project.videoClips).filter((l) => !l.clip.gap && has(l.clip)).map((l) => [l.start, l.end]),
    ...(project.overlayClips || []).filter(has).map((c) => [c.start, c.start + freeLen('overlay', c)]),
    ...(project.effectClips || []).filter((e) => !e.disabled && isOverlay(e.fx)).map((e) => [e.start, e.start + e.duration]),
  ];
}
