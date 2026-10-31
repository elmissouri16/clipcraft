// Template helpers: the replaceable clips ("slots") of a project and how a new video or photo fills one.
import { clipLen, projectDuration, videoLayout } from './store.js';

export const isSlot = (c) => !!c?.slot && !c.gap;

// Replaceable clips in timeline order: [{ track, clip, start, duration }].
export function slotList(p) {
  const main = videoLayout(p.videoClips).filter((l) => isSlot(l.clip)).map((l) => ({ track: 'video', clip: l.clip, start: l.start, duration: clipLen(l.clip) }));
  const over = (p.overlayClips || []).filter(isSlot).map((c) => ({ track: 'overlay', clip: c, start: c.start, duration: clipLen(c) }));
  return [...main, ...over].sort((a, b) => a.start - b.start);
}

// Patch that puts media m into slot clip c without changing its length (so the edit keeps its rhythm):
// a longer video is cut, a shorter one is slowed down to fill the slot, a photo is shown for the slot's length.
export function fillSlot(c, m) {
  const len = clipLen(c);
  if (m.type === 'image') return { mediaId: m.id, in: 0, out: len, speed: 1, filled: true };
  const speed = c.speed || 1;
  const need = len * speed;
  if ((m.duration || 0) >= need - 1e-3) return { mediaId: m.id, in: 0, out: need, filled: true };
  const d = Math.max(0.05, m.duration || 0.05);
  return { mediaId: m.id, in: 0, out: d, speed: Math.max(0.1, d / len), filled: true };
}

// What the template package records about the project.
export function templateMeta(p) {
  return { ratio: p.ratio, width: p.width, height: p.height, duration: Math.round(projectDuration(p) * 100) / 100, slots: slotList(p).length };
}
