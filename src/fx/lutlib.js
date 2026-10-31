// The user's imported-LUT library: metadata (name + file path) persisted in localStorage.
// The .cube files themselves stay where the user keeps them; the path is the reference the
// existing readLut IPC resolves. Pure logic — storage injected for testing.

export const LUTLIB_KEY = 'clipcraft.lutLibrary';

export function loadLutLibrary(storage) {
  try {
    const v = JSON.parse((storage || localStorage).getItem(LUTLIB_KEY) || '[]');
    return (Array.isArray(v) ? v : []).filter((e) => e && typeof e.name === 'string' && typeof e.path === 'string' && e.path);
  } catch { return []; }
}

export function saveLutLibrary(storage, list) {
  try { (storage || localStorage).setItem(LUTLIB_KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}

export function addLutEntry(list, entry) {
  if (!entry || !entry.path) return list;
  const name = entry.name || String(entry.path).split(/[\\/]/).pop().replace(/\.cube$/i, '');
  return [...list.filter((e) => e.path !== entry.path), { name, path: entry.path }];
}

export function removeLutEntry(list, path) {
  return list.filter((e) => e.path !== path);
}
