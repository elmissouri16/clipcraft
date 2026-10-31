// Custom filter presets: a named { filter look, intensity, adjust } bundle the user saved
// from a clip, persisted in localStorage. Pure logic — storage is injected for testing.
// LUT-based filters ('lut:<file>') are not saved here: they belong to the LUT library,
// whose files live outside localStorage.

export const PRESET_KEY = 'clipcraft.filterPresets';

export function sanitizePreset(p) {
  if (!p || typeof p !== 'object') return null;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const filter = typeof p.filter === 'string' ? p.filter : '';
  if (!name || !filter || filter.startsWith('lut:')) return null;
  const intensity = Number.isFinite(p.filterIntensity) ? Math.min(100, Math.max(0, p.filterIntensity)) : 100;
  const adjust = p.adjust && typeof p.adjust === 'object' && !Array.isArray(p.adjust) ? { ...p.adjust } : {};
  return { name, filter, filterIntensity: intensity, adjust };
}

export function loadPresets(storage) {
  try {
    const v = JSON.parse((storage || localStorage).getItem(PRESET_KEY) || '[]');
    return (Array.isArray(v) ? v : []).map(sanitizePreset).filter(Boolean);
  } catch { return []; }
}

export function savePresets(storage, list) {
  try { (storage || localStorage).setItem(PRESET_KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}

// Adds (or replaces, by name) a preset built from a clip's current look; returns the new list.
export function upsertPreset(list, clip, name) {
  const preset = sanitizePreset({
    name,
    filter: clip?.filter || 'none',
    filterIntensity: clip?.filterIntensity ?? 100,
    adjust: clip?.adjust || {},
  });
  if (!preset) return list;
  return [...list.filter((p) => p.name.toLowerCase() !== preset.name.toLowerCase()), preset];
}

export function removePreset(list, name) {
  return list.filter((p) => p.name !== name);
}

// The clip patch a preset applies.
export function presetPatch(preset) {
  return { filter: preset.filter, filterIntensity: preset.filterIntensity, adjust: { ...preset.adjust } };
}
