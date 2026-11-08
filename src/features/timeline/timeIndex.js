// Immutable timeline snapshots build once; playback and arbitrary seeks query
// only overlapping branches. Results retain collection order for compositing.
export function createTimeIndex(items, startOf, endOf) {
  const sorted = items.map((value, order) => ({ value, order, start: startOf(value), end: endOf(value) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.order - b.order);
  const build = (from, to) => {
    if (from >= to) return null;
    const middle = (from + to) >>> 1, item = sorted[middle];
    const left = build(from, middle), right = build(middle + 1, to);
    return { ...item, left, right, minStart: left?.minStart ?? item.start,
      maxEnd: Math.max(item.end, left?.maxEnd ?? -Infinity, right?.maxEnd ?? -Infinity) };
  };
  const root = build(0, sorted.length);
  const range = (from, to) => {
    const hits = [];
    const visit = node => {
      if (!node || node.maxEnd <= from || node.minStart > to) return;
      visit(node.left);
      if (node.start <= to && node.end > from) hits.push(node);
      visit(node.right);
    };
    visit(root);
    return hits.sort((a, b) => a.order - b.order).map(hit => hit.value);
  };
  return { range, at: time => range(time, time) };
}
