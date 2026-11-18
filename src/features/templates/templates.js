// Template helpers: the replaceable clips ("slots") of a project and how a new video or photo fills one.
import { clipLen, projectDuration, retimeSourceData, videoLayout } from "../../state/store.js";

export const isSlot = (c) => !!c?.slot && !c.gap;

// Replaceable clips in timeline order: [{ track, clip, start, duration }].
export function slotList(p) {
  const main = videoLayout(p.videoClips).filter((l) => isSlot(l.clip)).map((l) => ({ track: 'video', clip: l.clip, start: l.start, duration: clipLen(l.clip) }));
  const over = (p.overlayClips || []).filter(isSlot).map((c) => ({ track: 'overlay', clip: c, start: c.start, duration: clipLen(c) }));
  return [...main, ...over].sort((a, b) => a.start - b.start);
}

// Patch that puts media m into slot clip c without changing its length (so the edit keeps its rhythm):
// a longer video is cut, a shorter one is slowed down to fill the slot, a photo is shown for the slot's length.
// The slot's keyframes (and other source-time data) move to the new source time, so its animation keeps
// its beat; a link to audio detached from the placeholder is dropped (that sound stays, as its own clip).
export function fillSlot(c, m) {
  const len = clipLen(c);
  const unlink = c.linkId ? { linkId: undefined, linkOff: undefined, linkInOff: undefined } : {};
  const done = (patch) => ({ ...patch, ...retimeSourceData(c, patch.in, patch.speed ?? (c.speed || 1)), ...unlink, filled: true });
  if (m.type === 'image') return done({ mediaId: m.id, in: 0, out: len, speed: 1 });
  const speed = c.speed || 1;
  const need = len * speed;
  if ((m.duration || 0) >= need - 1e-3) return done({ mediaId: m.id, in: 0, out: need });
  const d = Math.max(0.05, m.duration || 0.05);
  return done({ mediaId: m.id, in: 0, out: d, speed: Math.max(0.1, d / len) });
}

// What the template package records about the project.
export function templateMeta(p) {
  return { ratio: p.ratio, width: p.width, height: p.height, duration: Math.round(projectDuration(p) * 100) / 100, slots: slotList(p).length };
}
