// Stabilize (ClipInspector's Stabilize section): the clip's window of the original video is steadied into
// a new file that starts at that window, and the clip plays the file instead. clip.stabilize keeps
// { level, mediaId, in, out }: the original media and the window the file was rendered from.
//
// Swapping files moves the clip's source time: what was at original time T is at T - stabilize.in in the
// file. Everything stored in source time moves with it in the same update (keyframes, volume keys, the
// motion-track path, the Voice Enhancer window, and the linked audio partner's source offset), and the
// window a clip stands for is always derived from its CURRENT window — a split half of a stabilized clip
// turned Off gets its own part of the original back, not the whole range that was rendered.
// Pure: tests/unit/editor/test-stabilize-window.mjs drives it.
import { findLinkPartner, retimeSourceData } from '../../state/store.js';

// The original media's window the clip plays now: { mediaId, in, out }.
export function originalWindow(clip) {
  const st = clip.stabilize;
  if (!st) return { mediaId: clip.mediaId, in: clip.in || 0, out: clip.out };
  const base = st.in || 0;
  return { mediaId: st.mediaId, in: base + (clip.in || 0), out: Math.min(st.out ?? Infinity, base + clip.out) };
}

// The updateMany entries that make the clip play `mediaId` from `newIn` to `newOut` (one undo step).
function swapUpdates(project, track, clip, mediaId, newIn, newOut, extra) {
  const delta = newIn - (clip.in || 0);
  const patch = { mediaId, in: newIn, out: newOut, ...retimeSourceData(clip, newIn), ...extra };
  const e = clip.enhance;
  if (e && Number.isFinite(e.from) && Number.isFinite(e.to)) patch.enhance = { ...e, from: e.from + delta, to: e.to + delta };
  const updates = [];
  // The partner's source offset first, so the link sync keeps its sound where it is.
  const partner = findLinkPartner(project, clip);
  if (partner && partner.track === 'audio') updates.push({ track: 'audio', id: partner.clip.id, patch: { linkInOff: (partner.clip.linkInOff || 0) - delta } });
  updates.push({ track, id: clip.id, patch });
  return updates;
}

// Off: back to the original media, on the part of it this clip plays now.
export function stabilizeOffUpdates(project, track, clip) {
  if (!clip.stabilize) return [];
  const w = originalWindow(clip);
  return swapUpdates(project, track, clip, w.mediaId, w.in, w.out, { stabilize: null });
}

// A level was rendered for originalWindow(clip) into `media` (which starts at that window).
export function stabilizeUpdates(project, track, clip, media, level) {
  const w = originalWindow(clip);
  return swapUpdates(project, track, clip, media.id, 0, Math.min(media.duration, w.out - w.in), { stabilize: { level, mediaId: w.mediaId, in: w.in, out: w.out } });
}
