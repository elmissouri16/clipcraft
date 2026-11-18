import {packFilterLutRef} from '../../../shared/pluginColor.mjs';
// Filters: one-click looks, our own, drawn by the same GPU pass as Adjust (src/features/effects/grade.js), so the player and the
// export show the same picture. Most are a preset of Adjust settings; a few are their own expression.
// clip.filter: the id; clip.filterIntensity: 0..100 (default 100), how strongly the look is applied.
import { gradeExpr } from './grade.js';

import {FILTER_LOOKS} from '../../../shared/filterCatalog.mjs';
export {FILTER_LOOKS} from '../../../shared/filterCatalog.mjs';

const byId = Object.fromEntries(FILTER_LOOKS.map(f=>[f.id,f]));
export const FILTER_CATS = [...new Set(FILTER_LOOKS.map((f) => f.cat))];

// A preset scaled by the intensity: numbers times k, HSL values times k, curve points pulled towards the
// straight line.
function scaledGrade(g, k) {
  const out = {};
  for (const [key, v] of Object.entries(g)) {
    if (typeof v === 'number') out[key] = v * k;
    else if (key === 'hsl') out.hsl = Object.fromEntries(Object.entries(v).map(([c, x]) => [c, { h: x.h * k, s: x.s * k, l: x.l * k }]));
    else if (key === 'curves') out.curves = Object.fromEntries(Object.entries(v).map(([c, pts]) => [c, pts.map(([x, y]) => [x, x + (y - x) * k])]));
  }
  return out;
}

// The expression of a clip's filter at its intensity, or null (no filter, or "none").
const memo = new Map();
export function filterExpr(clip) {
  const f = byId[clip.filter];
  if (!f || f.id === 'none') return null;
  const k = Math.max(0, Math.min(1, (clip.filterIntensity ?? 100) / 100));
  if (k <= 0) return null;
  const key = `${f.id}|${k}`;
  if (memo.has(key)) return memo.get(key);
  const e = f.expr ? f.expr(Number(k.toFixed(4))) : gradeExpr(scaledGrade(f.grade, k));
  memo.set(key, e);
  return e;
}
// A LUT used as a filter: clip.filter = 'lut:<bundled file>'.
export const lutFilterRef = (clip) => (typeof clip.filter === 'string' && clip.filter.startsWith('lut:') && (clip.filterIntensity ?? 100) > 0
  ? { bundled: clip.filter.slice(4) } : (clip.filterIntensity??100)>0?packFilterLutRef(clip.filter):null);
// A filter look as a LAYER on the Effects track (project.effectClips with fx 'filter:<look>'): it acts
// on every picture under it — pictures, overlays and graphics alike — which is how the whole video
// gets a look when the content lives on overlay tracks. The layer's strength is the intensity.
// Rendered by pixelPasses (src/features/effects/apply.js) in the player and the export alike.
export const FILTER_FX = 'filter:';
export const isFilterFx = (id) => typeof id === 'string' && id.startsWith(FILTER_FX) && id.length > FILTER_FX.length;
export const filterFxLook = (id) => (isFilterFx(id) ? id.slice(FILTER_FX.length) : null);
export const filterFx = (look) => `${FILTER_FX}${look}`;
export const hasFilter = (clip) => (!!byId[clip.filter] && clip.filter !== 'none' && (clip.filterIntensity ?? 100) > 0) || !!lutFilterRef(clip);
const LUT_NAMES = { 'slay-01-amber.cube': 'Amber', 'slay-02-fade.cube': 'Fade', 'slay-03-neon.cube': 'Neon', 'slay-04-film.cube': 'Film', 'slay-05-portrait.cube': 'Portrait' };
export const filterName = (id) => byId[id]?.name || (packFilterLutRef(id)?'Pack LUT':null) || (String(id).startsWith('lut:') ? `${LUT_NAMES[id.slice(4)] || 'LUT'} (LUT)` : id);
