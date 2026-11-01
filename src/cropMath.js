// Crop geometry for the visual crop mode + the Crop section's aspect presets.
// Pure math over the store's crop model ({ l, t, r, b } = source-edge fractions cut away,
// the same field src/visual.js cropOf and electron/layers.cjs consume — no new model).
// Rules (shared by the % fields, the presets and the on-player drag): every edge stays in
// [0, 0.9] and opposite edges together cut at most 90% on their axis.

export const CROP_ASPECTS = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: null }, // resolves from the media's own dimensions
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '21:9', label: '21:9', ratio: 21 / 9 },
];

const clampEdge = (v) => Math.min(0.9, Math.max(0, v));

// Width/height ratio a preset id stands for on this media (null = unconstrained).
export function aspectRatioOf(id, mw, mh) {
  if (!id || id === 'free') return null;
  if (id === 'original') return mw && mh ? mw / mh : null;
  const a = CROP_ASPECTS.find((x) => x.id === id);
  return a ? a.ratio : null;
}

// The aspect (w/h) of the region that survives a crop on an mw x mh source.
export function keptAspect(crop, mw, mh) {
  const kw = 1 - (crop.l || 0) - (crop.r || 0);
  const kh = 1 - (crop.t || 0) - (crop.b || 0);
  if (!(mw > 0) || !(mh > 0) || kw <= 0 || kh <= 0) return null;
  return (kw * mw) / (kh * mh);
}

// Fit a crop into the shared clamps; returns a fresh { l, t, r, b }.
export function clampCrop(c) {
  const out = { l: clampEdge(c.l || 0), t: clampEdge(c.t || 0), r: clampEdge(c.r || 0), b: clampEdge(c.b || 0) };
  if (out.l + out.r > 0.9) { const extra = (out.l + out.r - 0.9) / 2; out.l -= extra; out.r -= extra; }
  if (out.t + out.b > 0.9) { const extra = (out.t + out.b - 0.9) / 2; out.t -= extra; out.b -= extra; }
  return out;
}

// Center-crop symmetrically so the kept region has aspect R (w/h) on an mw x mh source.
// Only the dimension that needs it shrinks, so the result is the minimal centered crop
// reaching R from the current one ("Original" therefore restores the source aspect with
// the least extra cutting).
export function cropForAspect(crop, mw, mh, R) {
  if (!R || !(mw > 0) || !(mh > 0)) return clampCrop(crop || {});
  const c = clampCrop(crop || {});
  let kw = 1 - c.l - c.r;
  let kh = 1 - c.t - c.b;
  const A = (kw * mw) / (kh * mh);
  if (Math.abs(A - R) < 1e-6) return c;
  if (A > R) {
    // Too wide: narrow the kept width, split evenly between the left and right cuts.
    let nw = (R * kh * mh) / mw;
    if (nw < 0.1) { // extremely tall target on a wide short strip: floor the width, trim height too
      nw = 0.1;
      const nh = (nw * mw) / (R * mh);
      c.t += (kh - nh) / 2; c.b += (kh - nh) / 2; kh = nh;
    }
    c.l += (kw - nw) / 2; c.r += (kw - nw) / 2; kw = nw;
  } else {
    // Too tall: shorten the kept height, split evenly between the top and bottom cuts.
    let nh = (kw * mw) / (R * mh);
    if (nh < 0.1) {
      nh = 0.1;
      const nw = (nh * R * mh) / mw;
      c.l += (kw - nw) / 2; c.r += (kw - nw) / 2; kw = nw;
    }
    c.t += (kh - nh) / 2; c.b += (kh - nh) / 2; kh = nh;
  }
  return clampCrop(c);
}

// Move the whole crop frame by (dx, dy) source fractions (the centre drag): the kept
// region's size never changes; the frame stops at the source edges.
export function moveCrop(start, dx, dy) {
  const s = clampCrop(start || {});
  const kw = 1 - s.l - s.r;
  const kh = 1 - s.t - s.b;
  const nl = Math.min(Math.max(s.l + (dx || 0), 0), Math.max(0, 1 - kw));
  const nt = Math.min(Math.max(s.t + (dy || 0), 0), Math.max(0, 1 - kh));
  return { l: nl, t: nt, r: 1 - kw - nl, b: 1 - kh - nt };
}

// One drag step of the on-player crop frame. `start` is the crop when the drag began,
// `handle` one of 'tl','t','tr','r','br','b','bl','l', and `pt` the pointer position in
// source fractions (0..1 across the fitted picture). When `aspect` (w/h) is set the kept
// region stays locked to it: corners grow from the opposite corner, edges resize around
// the kept region's centre on the other axis.
export function dragCrop(start, handle, pt, aspect, mw, mh) {
  const s = clampCrop(start || {});
  let L = s.l, T = s.t;
  let Rr = 1 - s.r, Bb = 1 - s.b; // kept region's right / bottom edge positions (source fractions)
  const moveL = handle === 'l' || handle === 'tl' || handle === 'bl';
  const moveR = handle === 'r' || handle === 'tr' || handle === 'br';
  const moveT = handle === 't' || handle === 'tl' || handle === 'tr';
  const moveB = handle === 'b' || handle === 'bl' || handle === 'br';
  if (!aspect || !(mw > 0) || !(mh > 0)) {
    if (moveL) L = Math.min(Math.max(pt.x, 0), Rr - 0.1);
    if (moveR) Rr = Math.max(Math.min(pt.x, 1), L + 0.1);
    if (moveT) T = Math.min(Math.max(pt.y, 0), Bb - 0.1);
    if (moveB) Bb = Math.max(Math.min(pt.y, 1), T + 0.1);
    return clampCrop({ l: L, t: T, r: 1 - Rr, b: 1 - Bb });
  }
  // Aspect-locked. kw/kh are the kept size in source fractions; the lock ties them:
  // kh = kw * mw / (aspect * mh).
  const kwFromKh = (kh) => (kh * aspect * mh) / mw;
  const khFromKw = (kw) => (kw * mw) / (aspect * mh);
  if ((moveL || moveR) && (moveT || moveB)) {
    // Corner: the opposite corner anchors. Grow from the horizontal movement, derive the
    // vertical; if the derived height runs out of source, take the height and derive back.
    const ax = moveL ? Rr : L; // anchor x (the fixed vertical edge)
    const ay = moveT ? Bb : T; // anchor y (the fixed horizontal edge)
    let kw = Math.abs(pt.x - ax);
    kw = Math.min(Math.max(kw, 0.02), 0.9);
    let kh = khFromKw(kw);
    const maxKh = Math.min(0.9, moveT ? ay : 1 - ay);
    if (kh > maxKh) { kh = Math.max(maxKh, 0.02); kw = Math.min(kwFromKh(kh), 0.9); }
    if (kh < 0.02) { kh = 0.02; kw = kwFromKh(kh); }
    const nx = moveL ? ax - kw : ax;
    const ny = moveT ? ay - kh : ay;
    return clampCrop({ l: nx, t: ny, r: 1 - (nx + kw), b: 1 - (ny + kh) });
  }
  if (moveL || moveR) {
    // Side edge: width follows the pointer; height adjusts around the kept centre.
    const fixed = moveL ? Rr : L;
    let kw = Math.abs(pt.x - fixed);
    kw = Math.min(Math.max(kw, 0.02), 0.9);
    let kh = khFromKw(kw);
    if (kh > 0.9) { kh = 0.9; kw = kwFromKh(kh); }
    const cy = (T + Bb) / 2;
    let ny = cy - kh / 2;
    ny = Math.min(Math.max(ny, 0), 1 - kh);
    const nx = moveL ? fixed - kw : fixed;
    return clampCrop({ l: nx, t: ny, r: 1 - (nx + kw), b: 1 - (ny + kh) });
  }
  // Top/bottom edge: height follows the pointer; width adjusts around the kept centre.
  const fixed = moveT ? Bb : T;
  let kh = Math.abs(pt.y - fixed);
  kh = Math.min(Math.max(kh, 0.02), 0.9);
  let kw = kwFromKh(kh);
  if (kw > 0.9) { kw = 0.9; kh = khFromKw(kw); }
  const cx = (L + Rr) / 2;
  let nx = cx - kw / 2;
  nx = Math.min(Math.max(nx, 0), 1 - kw);
  const ny = moveT ? fixed - kh : fixed;
  return clampCrop({ l: nx, t: ny, r: 1 - (nx + kw), b: 1 - (ny + kh) });
}
