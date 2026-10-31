// Filters: one-click looks, our own, drawn by the same GPU pass as Adjust (src/fx/grade.js), so the player and the
// export show the same picture. Most are a preset of Adjust settings; a few are their own expression.
// clip.filter: the id; clip.filterIntensity: 0..100 (default 100), how strongly the look is applied.
import { gradeExpr } from './grade.js';

// Split toning with curves: red up / blue down in the highlights, the opposite in the shadows (teal & orange).
const split = (k) => ({
  r: [[0, 0], [0.25, 0.25 - 0.06 * k], [0.75, 0.75 + 0.06 * k], [1, 1]],
  b: [[0, 0], [0.25, 0.25 + 0.07 * k], [0.75, 0.75 - 0.07 * k], [1, 1]],
});

export const FILTER_LOOKS = [
  { id: 'none', name: 'None', cat: 'Basic' },
  { id: 'vivid', name: 'Vivid', cat: 'Basic', grade: { saturation: 55, contrast: 15 } },
  { id: 'vibrance', name: 'Vibrance', cat: 'Basic', grade: { saturation: 32, brilliance: 15 } },
  { id: 'warm', name: 'Warm', cat: 'Basic', grade: { temp: 40, saturation: 10 } },
  { id: 'cool', name: 'Cool', cat: 'Basic', grade: { temp: -40, tint: -5 } },
  { id: 'fade', name: 'Faded', cat: 'Basic', grade: { fade: 60, saturation: -30, contrast: -15 } },
  { id: 'lighten', name: 'Lighten', cat: 'Basic', grade: { exposure: 25, shadow: 15 } },
  { id: 'darken', name: 'Darken', cat: 'Basic', grade: { exposure: -25, highlight: -10 } },

  { id: 'cinematic', name: 'Cinematic', cat: 'Cinematic', grade: { contrast: 20, saturation: -10, vignette: 20, curves: split(0.7) } },
  { id: 'tealorange', name: 'Teal & Orange', cat: 'Cinematic', grade: { contrast: 15, saturation: 20, curves: split(1.3) } },
  { id: 'drama', name: 'Drama', cat: 'Cinematic', grade: { contrast: 45, saturation: -20, exposure: -10, vignette: 30 } },
  { id: 'bleach', name: 'Bleach', cat: 'Cinematic', grade: { saturation: -55, contrast: 35 } },
  { id: 'lowkey', name: 'Low Key', cat: 'Cinematic', grade: { exposure: -20, contrast: 35, highlight: -20, vignette: 25 } },
  { id: 'hdr', name: 'HDR', cat: 'Cinematic', grade: { shadow: 50, highlight: -50, clarity: 60, saturation: 25 } },

  { id: 'bw', name: 'Black & White', cat: 'Black & White', grade: { saturation: -100 } },
  { id: 'noir', name: 'Noir', cat: 'Black & White', grade: { saturation: -100, contrast: 50, exposure: -10, vignette: 40 } },
  { id: 'silver', name: 'Silver', cat: 'Black & White', grade: { saturation: -100, contrast: 15, exposure: 8 } },

  { id: 'golden', name: 'Golden', cat: 'Warm', grade: { temp: 45, tint: 5, saturation: 20, highlight: 10 } },
  { id: 'sunset', name: 'Sunset', cat: 'Warm', grade: { temp: 55, tint: 15, saturation: 30 } },
  { id: 'autumn', name: 'Autumn', cat: 'Warm', grade: { temp: 30, saturation: 10, hsl: { green: { h: -60, s: 10, l: 0 }, orange: { h: 0, s: 30, l: 0 } } } },
  { id: 'tungsten', name: 'Tungsten', cat: 'Cool', grade: { temp: -60, tint: 5 } },
  { id: 'moonlight', name: 'Moonlight', cat: 'Cool', grade: { temp: -50, exposure: -15, saturation: -25 } },
  { id: 'ice', name: 'Ice', cat: 'Cool', grade: { temp: -35, exposure: 8, saturation: -10 } },
  { id: 'forest', name: 'Forest', cat: 'Cool', grade: { tint: -25, temp: -10, hsl: { green: { h: 0, s: 30, l: -10 } } } },

  { id: 'pastel', name: 'Pastel', cat: 'Soft', grade: { saturation: -25, fade: 25, exposure: 10, contrast: -15 } },
  { id: 'matte', name: 'Matte', cat: 'Soft', grade: { fade: 50, contrast: -10 } },
  { id: 'highkey', name: 'High Key', cat: 'Soft', grade: { exposure: 25, contrast: -15, shadow: 30 } },
  { id: 'dreamy', name: 'Dreamy', cat: 'Soft', grade: { exposure: 8, saturation: 10, fade: 15, highlight: 15, tint: 8 } },
  { id: 'crisp', name: 'Crisp', cat: 'Soft', grade: { sharpen: 50, contrast: 15, saturation: 15 } },

  { id: 'vintage', name: 'Vintage', cat: 'Vintage', grade: { fade: 40, temp: 25, saturation: -20, contrast: -10, vignette: 15 } },
  { id: 'sepia', name: 'Sepia', cat: 'Vintage', expr: (k) => `st(1, L(X,Y)); clip(S(X,Y) + (C(ld(1) * 1.07 + 20, ld(1) * 0.94 + 8, ld(1) * 0.74) - S(X,Y)) * ${k}, 0, 255)` },
  { id: 'film', name: 'Film', cat: 'Vintage', grade: { fade: 25, temp: 15, particles: 30, contrast: 10 } },
  { id: 'polaroid', name: 'Polaroid', cat: 'Vintage', grade: { temp: 20, fade: 30, saturation: -15, contrast: -10 } },
  { id: 'xpro', name: 'Cross Process', cat: 'Vintage', grade: { saturation: 25, curves: { r: [[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]], g: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]], b: [[0, 0.08], [0.5, 0.5], [1, 0.9]] } } },

  { id: 'cyber', name: 'Cyber', cat: 'Creative', grade: { tint: 40, temp: -40, saturation: 45, contrast: 15 } },
  { id: 'neonpink', name: 'Neon Pink', cat: 'Creative', grade: { tint: 60, saturation: 50 } },
  { id: 'duoblue', name: 'Duotone Blue', cat: 'Creative', expr: (k) => `st(1, L(X,Y) / 255); clip(S(X,Y) + (C(20 + 200 * ld(1), 30 + 180 * ld(1), 90 + 160 * ld(1)) - S(X,Y)) * ${k}, 0, 255)` },
  { id: 'duopink', name: 'Duotone Pink', cat: 'Creative', expr: (k) => `st(1, L(X,Y) / 255); clip(S(X,Y) + (C(70 + 185 * ld(1), 10 + 200 * ld(1), 60 + 180 * ld(1)) - S(X,Y)) * ${k}, 0, 255)` },
  { id: 'posterize', name: 'Posterize', cat: 'Creative', expr: (k) => `S(X,Y) + (floor(S(X,Y) / 51 + 0.5) * 51 - S(X,Y)) * ${k}` },
  { id: 'sketch', name: 'Sketch', cat: 'Creative', expr: (k) => `st(1, 255 - clip((abs(L(X+1,Y) - L(X-1,Y)) + abs(L(X,Y+1) - L(X,Y-1))) * 2.2, 0, 255)); S(X,Y) + (ld(1) - S(X,Y)) * ${k}` },
  { id: 'invert', name: 'Negative', cat: 'Creative', expr: (k) => `S(X,Y) + (255 - 2 * S(X,Y)) * ${k}` },

  // §C collections below are plain Adjust-parameter looks — the same grade engine, no fake filters.
  { id: 'foodfresh', name: 'Food Fresh', cat: 'Food', grade: { saturation: 35, temp: 15, clarity: 30, exposure: 8 } },
  { id: 'foodwarm', name: 'Food Warm', cat: 'Food', grade: { temp: 35, saturation: 25, highlight: 10, brilliance: 10 } },
  { id: 'travelpop', name: 'Travel Pop', cat: 'Travel', grade: { saturation: 40, clarity: 35, contrast: 10, curves: split(1.1) } },
  { id: 'travelsky', name: 'Travel Sky', cat: 'Travel', grade: { saturation: 20, hsl: { blue: { h: 0, s: 35, l: 5 }, cyan: { h: 0, s: 25, l: 0 } } } },
  { id: 'portraitsoft', name: 'Portrait Soft', cat: 'Portrait', grade: { fade: 10, saturation: -5, exposure: 8, brilliance: 20 } },
  { id: 'portraitglow', name: 'Portrait Glow', cat: 'Portrait', grade: { exposure: 12, highlight: 15, tint: 5, saturation: 5 } },
  { id: 'weddingairy', name: 'Wedding Airy', cat: 'Wedding', grade: { exposure: 18, fade: 20, contrast: -12, saturation: -8 } },
  { id: 'weddingwarm', name: 'Wedding Warm', cat: 'Wedding', grade: { temp: 25, fade: 15, exposure: 10, highlight: 8 } },
  { id: 'commercialclean', name: 'Commercial Clean', cat: 'Commercial', grade: { contrast: 15, saturation: 10, exposure: 5, clarity: 25 } },
  { id: 'productcrisp', name: 'Product Crisp', cat: 'Product', grade: { sharpen: 60, clarity: 40, contrast: 12, saturation: 12 } },
  { id: 'productstudio', name: 'Product Studio', cat: 'Product', grade: { exposure: 10, contrast: 18, saturation: 8, highlight: -10 } },
  { id: 'animepop', name: 'Anime Pop', cat: 'Anime', grade: { saturation: 50, contrast: 25, sharpen: 30 } },
];

const byId = Object.fromEntries(FILTER_LOOKS.map((f) => [f.id, f]));
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
  ? { bundled: clip.filter.slice(4) } : null);
export const hasFilter = (clip) => (!!byId[clip.filter] && clip.filter !== 'none' && (clip.filterIntensity ?? 100) > 0) || !!lutFilterRef(clip);
const LUT_NAMES = { 'slay-01-amber.cube': 'Amber', 'slay-02-fade.cube': 'Fade', 'slay-03-neon.cube': 'Neon', 'slay-04-film.cube': 'Film', 'slay-05-portrait.cube': 'Portrait' };
export const filterName = (id) => byId[id]?.name || (String(id).startsWith('lut:') ? `${LUT_NAMES[id.slice(4)] || 'LUT'} (LUT)` : id);
