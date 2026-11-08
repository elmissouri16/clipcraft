export function timelineViewport(left, width, pixelsPerSecond, header = 192, overscan = 256) {
  return { from: Math.max(0, (left - overscan) / pixelsPerSecond),
    to: Math.max(0, (left + width - header + overscan) / pixelsPerSecond) };
}
export const intersectsViewport = (start, length, viewport) => start + length >= viewport.from && start <= viewport.to;
export function filmstripTiles(width, tileWidth, start, pps, viewport, cap = 400) {
  const first = Math.max(0, Math.floor(((viewport.from - start) * pps) / tileWidth));
  const end = Math.min(Math.ceil(width / tileWidth), Math.ceil(((viewport.to - start) * pps) / tileWidth), first + cap);
  return { first, end: Math.max(first, end) };
}
export function timelineClipBox(lane, start, length, pps, row, rowHeight = 34, titleHeight = 22) {
  const left = lane.left + start * pps, top = lane.top + (row === undefined ? 6 : titleHeight + row * rowHeight);
  return { left, right: left + Math.max(6, length * pps), top,
    bottom: row === undefined ? lane.bottom - 6 : top + rowHeight - 4 };
}
export const boxesIntersect = (a, b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
