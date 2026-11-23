// Reverse (clip menu, and the assistant's clip_tools reverse): the clip's window of its media is
// rendered backwards into a new file, and the clip plays that file; Reverse again plays the
// original forwards. clip.reversed keeps { mediaId, in, out, original }: the media and window the
// file was rendered from, and the source-time data the clip had then.
//
// The file holds original time t at file time `out - t`, so swapping files mirrors the clip's
// source time: everything stored in source time (keyframes, volume keys, the motion-track path)
// is mirrored with it, and a linked audio partner's source offset is rewritten so the pair's link
// keeps both sides where they are. The window a reversed clip stands for is derived from its
// CURRENT window: a piece of a reversed clip that was cut or trimmed gets back only its own part
// of the original. Pure: tests/unit/editor/test-timeline-edit-sync.mjs drives it.
import { EASE_PRESETS, ptsOf } from '../effects/easing.js';
import { volumeAt } from '../audio/fades.js';
import { findLinkPartner } from '../../state/store.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;
const tidy = (v) => Number(v.toFixed(9));

// The same easing played backwards: the curve turned half a turn (an ease-in becomes an ease-out).
export function reverseEase(e) {
  if (!e || e === 'linear') return e;
  const [x1, y1, x2, y2] = ptsOf(e), r = [1 - x2, 1 - y2, 1 - x1, 1 - y1].map(tidy);
  const preset = EASE_PRESETS.find((p) => p.pts.every((v, i) => near(v, r[i])));
  return preset ? preset.id : { ...(typeof e === 'object' ? e : {}), p1x: r[0], p1y: r[1], p2x: r[2], p2y: r[3] };
}

// Keyframes at mirrored times, in time order. A key's ease shapes the segment arriving at it, so
// each segment's ease moves to its new arriving key and plays backwards.
function mirrorKeys(keys, at) {
  if (!Array.isArray(keys)) return keys;
  const list = [...keys].filter((k) => k && Number.isFinite(k.t)).sort((a, b) => a.t - b.t), n = list.length;
  // New key j is old key n-1-j; the segment arriving at it was the one arriving at old key n-j.
  return list.map((_, j) => {
    const { e, ...key } = list[n - 1 - j], ease = j ? reverseEase(list[n - j].e) : undefined;
    return { ...key, t: tidy(at - key.t), ...(ease && ease !== 'linear' ? { e: ease } : {}) };
  });
}

// Volume keys of the window [lo, hi] mirrored (t >= 0 and increasing, as the export requires):
// the curve inside the window is kept exactly, with its values at the window's edges.
function mirrorVolume(keys, at, lo, hi) {
  if (!Array.isArray(keys) || !keys.length) return keys;
  const inside = keys.filter((k) => k.t > lo && k.t < hi);
  const edges = [{ t: lo, v: volumeAt(keys, lo) }, ...inside, { t: hi, v: volumeAt(keys, hi) }];
  return edges.map((k) => ({ ...k, t: tidy(Math.max(0, at - k.t)) })).reverse().filter((k, i, a) => !i || k.t > a[i - 1].t);
}

// The source-time data of `clip` on the mirrored clock t -> at - t, for a clip window [lo, hi] of the old clock.
function mirrorSourceData(clip, at, lo, hi) {
  const patch = {};
  if (clip.keyframes && typeof clip.keyframes === 'object') patch.keyframes = Object.fromEntries(Object.entries(clip.keyframes).map(([k, list]) => [k, mirrorKeys(list, at)]));
  if (Array.isArray(clip.volumeKeys)) patch.volumeKeys = mirrorVolume(clip.volumeKeys, at, lo, hi);
  if (clip.track && Array.isArray(clip.track.points)) patch.track = { ...clip.track, points: clip.track.points.map((q) => (q && Number.isFinite(q.t) ? { ...q, t: tidy(at - q.t) } : q)).sort((a, b) => a.t - b.t) };
  return patch;
}

// The original media's window a clip plays now, forwards: { mediaId, in, out }.
export function forwardWindow(clip) {
  const r = clip.reversed;
  if (!r) return { mediaId: clip.mediaId, in: clip.in || 0, out: clip.out };
  return { mediaId: r.mediaId, in: Math.max(r.in || 0, r.out - clip.out), out: Math.min(r.out, r.out - (clip.in || 0)) };
}

// The updateMany entries that put `patch` (a new media window) on the clip, keeping a linked
// partner's sound or picture where it is (its source offset follows the new window).
function swapUpdates(project, track, clip, patch) {
  const partner = findLinkPartner(project, clip), updates = [];
  if (partner && partner.track === 'audio') updates.push({ track: 'audio', id: partner.clip.id, patch: { linkInOff: (partner.clip.in || 0) - patch.in } });
  updates.push({ track, id: clip.id, patch: partner && track === 'audio' ? { ...patch, linkInOff: patch.in - (partner.clip.in || 0) } : patch });
  return updates;
}

// Reverse on: `media` was rendered backwards from the clip's window (forwardWindow(clip) of a clip that is not reversed).
export function reverseUpdates(project, track, clip, media) {
  const from = clip.in || 0, to = clip.out;
  const patch = { mediaId: media.id, in: 0, out: Math.min(media.duration ?? Infinity, to - from), ...mirrorSourceData(clip, to, from, to),
    // The Voice Enhancer's render is of the forward sound: it waits until Reverse is undone.
    enhance: undefined,
    reversed: { mediaId: clip.mediaId, in: from, out: to, original: { keyframes: clip.keyframes, track: clip.track, enhance: clip.enhance, volumeKeys: clip.volumeKeys } } };
  return swapUpdates(project, track, clip, patch);
}

// Reverse off: the clip plays the part of the original its current window stands for. A clip still
// on its whole rendered window gets its saved source-time data back exactly; a cut or trimmed piece
// gets its own data mirrored back.
export function unreverseUpdates(project, track, clip) {
  const r = clip.reversed;
  if (!r || !project.media.some(m => m.id === r.mediaId && !m.missing)) return [];
  const w = forwardWindow(clip);
  const whole = near(w.in, r.in || 0) && near(w.out, r.out) && r.original;
  const data = whole ? { keyframes: r.original.keyframes, track: r.original.track, volumeKeys: r.original.volumeKeys }
    : mirrorSourceData(clip, r.out, clip.in || 0, clip.out);
  const patch = { mediaId: r.mediaId, in: w.in, out: w.out, ...data, enhance: r.original ? r.original.enhance : clip.enhance, reversed: null };
  return swapUpdates(project, track, clip, patch);
}
