// Color grade of a picture clip (Adjust > Basic): temperature, tint, saturation, exposure,
// contrast, highlights, shadows, whites, blacks, brilliance, sharpen, clarity, grain (particles), fade, vignette.
// Our own formulas, written in the effects' expression language: gradeExpr() becomes one GPU pass, drawn by the
// player and by the export's effects pass alike (src/fx/apply.js), so both show the same picture.

export const GRADE_GROUPS = [
  {
    name: 'Color',
    items: [
      { id: 'temp', name: 'Temp', min: -100, max: 100, track: 'linear-gradient(90deg, #3b5bdb, #8a8f98, #fcc419)' },
      { id: 'tint', name: 'Tint', min: -100, max: 100, track: 'linear-gradient(90deg, #2f9e44, #8a8f98, #d6336c)' },
      { id: 'saturation', name: 'Saturation', min: -100, max: 100, track: 'linear-gradient(90deg, #6b6b6b, #e03131)' },
    ],
  },
  {
    name: 'Lightness',
    items: [
      { id: 'exposure', name: 'Exposure', min: -100, max: 100 },
      { id: 'contrast', name: 'Contrast', min: -100, max: 100 },
      { id: 'highlight', name: 'Highlight', min: -100, max: 100 },
      { id: 'shadow', name: 'Shadow', min: -100, max: 100 },
      { id: 'whites', name: 'Whites', min: -100, max: 100 },
      { id: 'blacks', name: 'Blacks', min: -100, max: 100 },
      { id: 'brilliance', name: 'Brilliance', min: -100, max: 100 },
    ],
  },
  {
    name: 'Effects',
    items: [
      { id: 'sharpen', name: 'Sharpen', min: 0, max: 100 },
      { id: 'clarity', name: 'Clarity', min: 0, max: 100 },
      { id: 'particles', name: 'Particles', min: 0, max: 100 },
      { id: 'fade', name: 'Fade', min: 0, max: 100 },
      { id: 'vignette', name: 'Vignette', min: -100, max: 100 },
    ],
  },
];
export const GRADE_KEYS = GRADE_GROUPS.flatMap((g) => g.items.map((i) => i.id));
export const DEFAULT_GRADE = Object.fromEntries(GRADE_KEYS.map((k) => [k, 0]));
export const gradeOf = (clip) => ({ ...DEFAULT_GRADE, ...(clip.grade || {}) });

// HSL: eight color ranges (hue centers in degrees), each with hue / saturation / lightness from -100 to 100.
export const HSL_COLORS = [
  { id: 'red', name: 'Red', hue: 0, css: '#ef4444' },
  { id: 'orange', name: 'Orange', hue: 30, css: '#f97316' },
  { id: 'yellow', name: 'Yellow', hue: 60, css: '#eab308' },
  { id: 'green', name: 'Green', hue: 120, css: '#22c55e' },
  { id: 'cyan', name: 'Cyan', hue: 180, css: '#06b6d4' },
  { id: 'blue', name: 'Blue', hue: 240, css: '#3b82f6' },
  { id: 'purple', name: 'Purple', hue: 275, css: '#a855f7' },
  { id: 'magenta', name: 'Magenta', hue: 315, css: '#ec4899' },
];
const hslOn = (hsl) => HSL_COLORS.some((c) => hsl?.[c.id] && (hsl[c.id].h || hsl[c.id].s || hsl[c.id].l));

// Curves: points [x, y] from 0 to 1 for the master (all channels) and red, green, blue.
export const CURVE_CHANNELS = ['master', 'r', 'g', 'b'];
export const IDENTITY_CURVE = [[0, 0], [1, 1]];
const curveOn = (pts) => Array.isArray(pts) && pts.length >= 2 && pts.some(([x, y]) => Math.abs(x - y) > 1e-4);
const curvesOn = (curves) => CURVE_CHANNELS.some((c) => curveOn(curves?.[c]));

export const hasGrade = (clip) => GRADE_KEYS.some((k) => Number(clip.grade?.[k]) || 0) || hslOn(clip.grade?.hsl) || curvesOn(clip.grade?.curves);

// Smooth curve through the points (monotone cubic, so it never overshoots), as a function of x in 0..1.
export function curveFn(points) {
  const p = [...(points || IDENTITY_CURVE)].map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]).sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return (x) => x;
  const nn = p.length;
  const dx = [];
  const sl = [];
  for (let i = 0; i < nn - 1; i++) {
    dx.push(Math.max(1e-6, p[i + 1][0] - p[i][0]));
    sl.push((p[i + 1][1] - p[i][1]) / dx[i]);
  }
  const m = [sl[0]];
  for (let i = 1; i < nn - 1; i++) m.push(sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2);
  m.push(sl[nn - 2]);
  for (let i = 0; i < nn - 1; i++) {
    if (sl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / sl[i];
    const b = m[i + 1] / sl[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * sl[i]; m[i + 1] = t * b * sl[i]; }
  }
  return (x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[nn - 1][0]) return p[nn - 1][1];
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const t = (x - p[i][0]) / dx[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * dx[i] * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * dx[i] * m[i + 1];
  };
}

// A curve as an expression of `v` (0..1): straight pieces between 33 samples, written as a flat sum.
function curveExprOf(points, v) {
  const f = curveFn(points);
  const N = 32;
  let e = n(f(0));
  let prev = f(0);
  for (let i = 1; i <= N; i++) {
    const y = f(i / N);
    const k = (y - prev) * N;
    if (Math.abs(k) > 1e-6) e += `${k < 0 ? '-' : '+'}${n(Math.abs(k))}*(clip(${v},${n((i - 1) / N)},${n(i / N)})-${n((i - 1) / N)})`;
    prev = y;
  }
  return e;
}

const n = (v) => {
  const s = Number(v.toFixed(5)).toString();
  return s.includes('e') ? Number(v).toFixed(6) : s;
};

// The pass for a clip's grade, or null when everything is at 0. Registers: 0 the channel (0..1), 1 the source
// luminance (0..1), 2 / 3 detail for sharpen / clarity, 4 the distance from the frame center.
export function gradeExpr(grade) {
  const g = { ...DEFAULT_GRADE, ...(grade || {}) };
  if (!g.hsl) g.hsl = {};
  if (!g.curves) g.curves = {};
  const k = (id) => Math.max(-1, Math.min(1, (Number(g[id]) || 0) / 100));
  const steps = ['st(0, S(X,Y)/255)', 'st(1, L(X,Y)/255)'];
  let any = false;
  const add = (s) => { steps.push(s); any = true; };

  // HSL first, on the source color: hue of the pixel (8), how colorful it is (9), then per color range a hue turn
  // (2, up to 30 degrees), a saturation factor (3) and a lightness change (4), blended by distance to each range.
  if (hslOn(g.hsl)) {
    steps.push('st(5, PR(X,Y)/255)', 'st(6, PG(X,Y)/255)', 'st(7, PB(X,Y)/255)',
      'st(2, max(ld(5), max(ld(6), ld(7))))', 'st(3, min(ld(5), min(ld(6), ld(7))))', 'st(4, ld(2) - ld(3))',
      'st(8, if(lt(ld(4), 0.0001), 0, if(eq(ld(2), ld(5)), 60 * mod((ld(6) - ld(7)) / ld(4) + 6, 6), if(eq(ld(2), ld(6)), 60 * ((ld(7) - ld(5)) / ld(4) + 2), 60 * ((ld(5) - ld(6)) / ld(4) + 4)))))',
      'st(9, smooth(0.03, 0.25, ld(4)))');
    const bands = HSL_COLORS.map((c, i) => {
      const v = g.hsl[c.id] || {};
      const prevHue = HSL_COLORS[(i + HSL_COLORS.length - 1) % HSL_COLORS.length].hue;
      const nextHue = HSL_COLORS[(i + 1) % HSL_COLORS.length].hue;
      const gap = (a, b) => ((b - a) % 360 + 360) % 360;
      const span = Math.max(gap(prevHue, c.hue), gap(c.hue, nextHue));
      const w = `clip(1 - min(abs(ld(8) - ${c.hue}), 360 - abs(ld(8) - ${c.hue})) / ${span}, 0, 1)`;
      return { w, h: (Number(v.h) || 0) / 100, s: (Number(v.s) || 0) / 100, l: (Number(v.l) || 0) / 100 };
    });
    const sum = (key, scale) => bands.filter((b) => b[key]).map((b) => `${n(b[key] * scale)} * ${b.w}`).join(' + ') || '0';
    steps.push(`st(2, (${sum('h', Math.PI / 6)}) * ld(9))`, `st(3, 1 + (${sum('s', 1)}) * ld(9))`, `st(4, (${sum('l', 0.3)}) * ld(9))`);
    // Hue turn around the grey axis, saturation around the source luminance, lightness towards white or black.
    const a = '(1 - cos(ld(2))) / 3';
    const b = '0.57735 * sin(ld(2))';
    const cs = 'cos(ld(2))';
    add(`st(0, C((${cs} + ${a}) * ld(5) + (${a} - ${b}) * ld(6) + (${a} + ${b}) * ld(7), (${a} + ${b}) * ld(5) + (${cs} + ${a}) * ld(6) + (${a} - ${b}) * ld(7), (${a} - ${b}) * ld(5) + (${a} + ${b}) * ld(6) + (${cs} + ${a}) * ld(7)))`);
    add('st(0, ld(1) + (ld(0) - ld(1)) * ld(3))');
    add('st(0, ld(0) + ld(4) * if(gt(ld(4), 0), 1 - ld(0), ld(0)))');
  }

  // Saturation around the source luminance (-100: black and white, +100: twice as colorful).
  if (k('saturation')) add(`st(0, ld(1) + (ld(0) - ld(1)) * ${n(1 + k('saturation'))})`);
  // Temperature: warmer adds red and takes blue; tint: towards magenta (+) or green (-).
  if (k('temp') || k('tint')) {
    const t = k('temp') * 0.18;
    const ti = k('tint') * 0.14;
    add(`st(0, ld(0) * C(${n(1 + t + ti / 2)}, ${n(1 - ti)}, ${n(1 - t + ti / 2)}))`);
  }
  // Exposure: up to one stop each way.
  if (k('exposure')) add(`st(0, ld(0) * ${n(2 ** k('exposure'))})`);
  // Contrast around mid grey.
  if (k('contrast')) add(`st(0, (ld(0) - 0.5) * ${n(1 + k('contrast') * (k('contrast') > 0 ? 0.6 : 0.5))} + 0.5)`);
  // Tones by luminance range: highlights, shadows, the brightest whites, the darkest blacks, and brilliance
  // (mid tones up, the ends kept).
  const tones = [];
  if (k('highlight')) tones.push(`${n(k('highlight') * 0.25)} * smooth(0.45, 1, ld(1))`);
  if (k('shadow')) tones.push(`${n(k('shadow') * 0.25)} * (1 - smooth(0, 0.55, ld(1)))`);
  if (k('whites')) tones.push(`${n(k('whites') * 0.18)} * smooth(0.7, 1, ld(1))`);
  if (k('blacks')) tones.push(`${n(k('blacks') * 0.15)} * (1 - smooth(0, 0.3, ld(1)))`);
  if (k('brilliance')) tones.push(`${n(k('brilliance') * 0.6)} * ld(1) * (1 - ld(1)) * (1 - ld(0))`);
  if (tones.length) add(`st(0, ld(0) + ${tones.join(' + ')})`);
  // Sharpen: the source's fine detail (a 3x3 Laplacian) added back; clarity: coarser detail, in the mid tones.
  if (k('sharpen') > 0) {
    steps.push('st(2, S(X,Y)*4 - S(X-1,Y) - S(X+1,Y) - S(X,Y-1) - S(X,Y+1))');
    add(`st(0, ld(0) + ld(2) / 255 * ${n(k('sharpen') * 0.9)})`);
  }
  if (k('clarity') > 0) {
    steps.push('st(3, S(X,Y) - (S(X-5,Y) + S(X+5,Y) + S(X,Y-5) + S(X,Y+5)) / 4)');
    add(`st(0, ld(0) + ld(3) / 255 * ${n(k('clarity') * 2.4)} * ld(1) * (1 - ld(1)))`);
  }
  // Fade: lifted blacks and softer whites, like old film.
  if (k('fade') > 0) add(`st(0, ld(0) * ${n(1 - k('fade') * 0.3)} + ${n(k('fade') * 0.13)})`);
  // Vignette: darker edges (+) or lighter (-).
  if (k('vignette')) {
    steps.push('st(4, hypot((X/W - 0.5) * 1.5, (Y/H - 0.5) * 1.5))');
    add(`st(0, ld(0) * (1 - ${n(k('vignette') * 0.75)} * smooth(0.35, 1.06, ld(4))))`);
  }
  // Particles: film grain, the same on the three channels, changing 24 times a second.
  if (k('particles') > 0) add(`st(0, ld(0) + ${n(k('particles') * 0.22)} * (hash(X * 12.9898 + Y * 78.233 + floor(T * 24) * 37.719) - 0.5))`);
  // Curves last: the master curve on every channel, then each channel's own.
  if (curvesOn(g.curves)) {
    if (curveOn(g.curves.master)) add(`st(0, ${curveExprOf(g.curves.master, 'clip(ld(0), 0, 1)')})`);
    const ch = ['r', 'g', 'b'].map((c) => (curveOn(g.curves[c]) ? curveExprOf(g.curves[c], 'clip(ld(0), 0, 1)') : 'ld(0)'));
    if (ch.some((e) => e !== 'ld(0)')) add(`st(0, C(${ch.join(', ')}))`);
  }
  if (!any) return null;
  steps.push('clip(ld(0), 0, 1) * 255');
  return steps.join('; ');
}
