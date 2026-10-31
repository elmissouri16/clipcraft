// Project-sequence compatibility — pure module, no imports (tested in plain Node).
//
// When media is placed on the main track, its resolution / aspect ratio / frame rate are
// compared with the project sequence. A mismatch is reported (never silently applied):
// the dialog in App lets the user adopt the clip's settings or keep the project's.

import { ratioFor } from './store.js';
import { RATIOS, sizeFor } from './effects.js';

const ratioOf = (w, h) => (w && h ? ratioFor(w, h) : null);

// media: a probed media item ({ type, width, height, fps? }); project: the store project.
// Returns null when the media matches (or has nothing comparable), otherwise
// { video: {w,h,fps,ratio}, project: {w,h,fps,ratio}, fields: ['resolution'|'ratio'|'fps', ...] }.
export function mismatchFor(project, media) {
  if (!project || !media || (media.type !== 'video' && media.type !== 'image')) return null;
  if (!media.width || !media.height) return null;
  const video = { w: media.width, h: media.height, fps: media.fps || 0, ratio: ratioOf(media.width, media.height) };
  const proj = { w: project.width || 0, h: project.height || 0, fps: project.fps || 0, ratio: project.ratio || ratioOf(project.width, project.height) };
  const fields = [];
  if (video.w !== proj.w || video.h !== proj.h) fields.push('resolution');
  if (video.ratio && proj.ratio && video.ratio !== proj.ratio) fields.push('ratio');
  // fps only counts when both sides are known and clearly different (29.97 vs 30 is fine).
  if (video.fps && proj.fps && Math.abs(video.fps - proj.fps) > 0.5) fields.push('fps');
  if (!fields.length) return null;
  return { video, project: proj, fields };
}

// The setProject patch that adopts a clip's shape as the project sequence: its ratio, the
// size for that ratio at the clip's own resolution (via sizeFor, so the resolution ladder
// stays consistent), and its frame rate when known.
export function sequencePatchFor(media) {
  const ratio = ratioOf(media.width, media.height);
  if (!ratio || !RATIOS[ratio]) return null;
  const [a, b] = RATIOS[ratio];
  const shortSide = a >= b ? media.height : media.width;
  const patch = { ratio, ...sizeFor(ratio, shortSide), resolution: shortSide, ratioLocked: true };
  if (media.fps) patch.fps = Math.round(media.fps);
  return patch;
}
