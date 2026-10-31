// Frame differences for the export's text layer: what changed between two frames, and its pixels.

// Rectangle around the pixels that differ between two frames (Uint32Array views, W x H), or null when equal.
export function changedRect(a, b, W, H) {
  const rowSame = (y) => {
    for (let i = y * W, end = i + W; i < end; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  let top = 0;
  while (top < H && rowSame(top)) top++;
  if (top === H) return null;
  let bottom = H - 1;
  while (rowSame(bottom)) bottom--;
  let left = W;
  let right = -1;
  for (let y = top; y <= bottom; y++) {
    const o = y * W;
    for (let x = 0; x < left; x++) if (a[o + x] !== b[o + x]) { left = x; break; }
    for (let x = W - 1; x > right; x--) if (a[o + x] !== b[o + x]) { right = x; break; }
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

// The rectangle's RGBA rows from a W-wide RGBA frame, packed.
export function cutRect(px, W, r) {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(px.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
  return out;
}
