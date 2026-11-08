// Only reducer-owned immutable snapshots are cached. Plain caller objects keep
// value-based revision behavior, including fixtures that mutate their inputs.
const snapshots = new WeakMap();
export function markProjectSnapshot(project) {
  if (project && !snapshots.has(project)) snapshots.set(project, {});
}
export function snapshotRevision(project, compute) {
  const record = snapshots.get(project);
  if (!record) return compute();
  return record.revision ??= compute();
}
