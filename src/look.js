// Look edits (filter, color adjustments) applied to every selected picture clip at once, like CapCut.
// An edit is made on one clip (the one the panel shows); only what changed is copied to the others, so each clip
// keeps its own other settings (a brightness change does not overwrite another clip's saturation).

import { DEFAULT_ADJUST } from './effects.js';
import { DEFAULT_GRADE } from './fx/grade.js';

const LOOK_KEYS = ['filter', 'filterIntensity', 'adjust', 'grade'];
const DEFAULTS = { adjust: DEFAULT_ADJUST, grade: DEFAULT_GRADE };
export const isLookPatch = (patch) => Object.keys(patch).length > 0 && Object.keys(patch).every((k) => LOOK_KEYS.includes(k));

// The patch for `clip`, given the patch made on `base`.
export function lookPatchFor(base, patch, clip) {
  const out = {};
  if ('filter' in patch) out.filter = patch.filter;
  if ('filterIntensity' in patch) out.filterIntensity = patch.filterIntensity;
  for (const key of ['adjust', 'grade']) {
    if (!(key in patch)) continue;
    const next = patch[key] || {};
    if (!Object.keys(next).length) out[key] = {}; // reset
    else {
      // Panels send the full set (defaults filled in): compare with the same, so only the moved slider counts.
      const prev = { ...DEFAULTS[key], ...(base[key] || {}) };
      const changed = Object.keys(next).filter((k) => next[k] !== prev[k]);
      out[key] = { ...(clip[key] || {}), ...Object.fromEntries(changed.map((k) => [k, next[k]])) };
    }
  }
  return out;
}

// Selected picture clips (main and overlay), when several are selected; otherwise [].
export function selectedPictures(project, selection) {
  if (!selection?.items) return [];
  const lists = { video: project.videoClips, overlay: project.overlayClips || [] };
  return selection.items
    .filter((it) => lists[it.track])
    .map((it) => ({ track: it.track, clip: lists[it.track].find((c) => c.id === it.id) }))
    .filter((x) => x.clip && !x.clip.gap);
}

// One undoable action that applies a look edit made on `base` to all `items` ([{ track, clip }]).
export function lookAction(items, base, patch) {
  return { type: 'updateMany', updates: items.map((it) => ({ track: it.track, id: it.clip.id, patch: lookPatchFor(base, patch, it.clip) })) };
}
