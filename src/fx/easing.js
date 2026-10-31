// Easing curves for transitions and keyframe segments: named cubic-bezier presets + custom curves.
// One solver shared by the preview, the export and the tests, so an eased motion renders identically
// everywhere. A missing ease value means linear — projects saved before easing existed render exactly
// as they did. Overshoot's control points push y past 1 on purpose (the curve settles from beyond the
// target); the solver therefore never clamps its output, only its input.

export const EASE_PRESETS = [
  { id: 'linear', name: 'Linear', pts: [0, 0, 1, 1] },
  { id: 'smooth', name: 'Smooth', pts: [0.42, 0, 0.58, 1] },
  { id: 'easeIn', name: 'Ease In', pts: [0.42, 0, 1, 1] },
  { id: 'easeOut', name: 'Ease Out', pts: [0, 0, 0.58, 1] },
  { id: 'snapIn', name: 'Snap In', pts: [0.16, 1, 0.3, 1] },
  { id: 'snapOut', name: 'Snap Out', pts: [0.7, 0, 0.84, 0] },
  { id: 'overshoot', name: 'Overshoot', pts: [0.34, 1.56, 0.64, 1] },
];
const BY_ID = new Map(EASE_PRESETS.map((p) => [p.id, p]));
export const easePreset = (id) => BY_ID.get(id) || null;
export const isCustomEase = (e) => !!e && typeof e === 'object'
  && ['p1x', 'p1y', 'p2x', 'p2y'].every((k) => Number.isFinite(e[k]));
export const customPts = (e) => [e.p1x, e.p1y, e.p2x, e.p2y];
export const ptsOf = (e) => {
  if (!e) return [0, 0, 1, 1];
  if (typeof e === 'string') return (BY_ID.get(e) || BY_ID.get('linear')).pts;
  if (isCustomEase(e)) return customPts(e);
  return [0, 0, 1, 1];
};
export const easeName = (e) => {
  if (!e || e === 'linear') return 'Linear';
  if (typeof e === 'string') return (BY_ID.get(e)?.name) || e;
  if (isCustomEase(e)) return 'Custom';
  return 'Linear';
};

// Cubic bezier solver: given x (time), find y (progress). Newton iterations with a bisection fallback,
// the standard browser algorithm. Solvers are cached per control-point set.
const cache = new Map();
export function bezierSolver(x1, y1, x2, y2) {
  const key = [x1, y1, x2, y2].join(',');
  if (cache.has(key)) return cache.get(key);
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const xAt = (t) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t) => ((ay * t + by) * t + cy) * t;
  const dxAt = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = xAt(t) - x;
      if (Math.abs(err) < 1e-6) return yAt(t);
      const d = dxAt(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
      if (t < 0 || t > 1) break;
    }
    let lo = 0; let hi = 1; t = x;
    while (hi - lo > 1e-6) {
      if (xAt(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return yAt(t);
  };
  cache.set(key, solve);
  return solve;
}

// The eased progress for a stored ease value (preset id, custom object, or nothing = linear).
export function easeValue(ease, t) {
  const x = Math.min(1, Math.max(0, t));
  if (!ease || ease === 'linear') return x;
  const [x1, y1, x2, y2] = ptsOf(ease);
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return x;
  return bezierSolver(x1, y1, x2, y2)(x);
}
