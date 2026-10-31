// Custom removal (Remove BG > Custom removal): the user paints strokes over the clip's frame;
// Erase strokes take the picture away, Restore strokes bring it back. Strokes live on the clip
// (clip.customMask = { strokes }) in SOURCE-normalized coordinates: x/y are fractions of the
// source picture, size is the brush diameter in PERCENT of the source width (2..30, as the
// editor's slider shows). The mask is static: it applies to the whole clip.
//
// This module is DOM-free so the exact same rasterizer runs in the renderer (preview + the
// PNG handed to the export) and in the Node test suites. The raster is a keep-map:
// 255 = the picture stays, 0 = removed; removals combine with chroma / AI matte by
// multiplication, so the union of all removals applies.

export const hasCustomMask = (clip) => !!(clip && clip.customMask && Array.isArray(clip.customMask.strokes) && clip.customMask.strokes.length > 0);

// Rasterizes the strokes into a keep-map of w x h bytes. Later strokes paint over earlier
// ones; each stamp is a disc with a soft rim (full strength inside 70% of the radius).
export function rasterizeCustomMask(strokes, w, h) {
  const out = new Uint8Array(w * h).fill(255);
  if (!strokes || !strokes.length || w < 1 || h < 1) return out;
  const stamp = (cx, cy, r, target) => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    const hard = r * 0.7;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const cov = d <= hard ? 1 : (r - d) / (r - hard);
        const i = y * w + x;
        out[i] = Math.round(out[i] * (1 - cov) + target * cov);
      }
    }
  };
  for (const s of strokes) {
    if (!s || !Array.isArray(s.points) || !s.points.length) continue;
    const target = s.tool === 'restore' ? 255 : 0;
    const r = Math.max(0.75, ((Number(s.size) || 8) / 100 / 2) * w);
    const pts = s.points.map(([x, y]) => [x * w, y * h]);
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1] || pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r * 0.5)));
      for (let j = 0; j <= steps; j++) stamp(x0 + ((x1 - x0) * j) / steps, y0 + ((y1 - y0) * j) / steps, r, target);
    }
  }
  return out;
}
