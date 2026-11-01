import { useEffect, useState } from 'react';

// The Creator Pack, from the renderer's side: one shared client for the first-run prompt
// and the install offers in the Assets / Music empty states, so a download started in one
// place shows its progress everywhere. All transport lives in the main process
// (electron/pack.cjs) — this module only holds the manifest snapshot and the live
// per-category states: idle | downloading | verifying | installing | done | error.
export const PACK_CATEGORIES = [
  { id: 'music', label: 'Music', note: 'Songs and instrumentals for the Music place' },
  { id: 'sfx', label: 'Sound FX', note: 'Sound effects for the Assets tab' },
  { id: 'assets', label: 'Assets', note: 'Transitions and overlays for the Assets tab' },
];

export const fmtMB = (n) => {
  if (!n && n !== 0) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};

let manifest = undefined; // undefined = not asked yet, null = unavailable, object = feed result
let manifestPromise = null;
let install = { running: false, cats: {}, results: null };
const subs = new Set();
const emit = () => subs.forEach((fn) => fn());

export function loadManifest(force = false) {
  if (manifest !== undefined && !force) return Promise.resolve(manifest);
  if (!manifestPromise) {
    manifestPromise = window.api.packManifest()
      .then((m) => { manifest = m && m.categories ? m : null; manifestPromise = null; emit(); return manifest; })
      .catch(() => { manifest = null; manifestPromise = null; emit(); return null; });
  }
  return manifestPromise;
}

export function usePack() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    subs.add(fn);
    if (manifest === undefined) loadManifest();
    return () => subs.delete(fn);
  }, []);
  return { manifest, install };
}

let progressWired = false;
function wireProgress() {
  if (progressWired) return;
  progressWired = true;
  window.api.onPackProgress?.((p) => {
    if (!p?.category) return;
    install = { ...install, cats: { ...install.cats, [p.category]: { phase: p.phase, received: p.received || 0, total: p.total || 0 } } };
    emit();
  });
}

export async function startPackInstall(cats) {
  const chosen = PACK_CATEGORIES.map((c) => c.id).filter((id) => cats.includes(id));
  if (!chosen.length || install.running) return null;
  wireProgress();
  install = {
    running: true,
    results: null,
    cats: Object.fromEntries(chosen.map((id) => [id, { phase: 'downloading', received: 0, total: manifest?.categories?.[id]?.size || 0 }])),
  };
  emit();
  try {
    const r = await window.api.packInstall(chosen);
    install = { running: false, cats: install.cats, results: r?.results || null, error: r?.error || null };
    emit();
    return r;
  } catch {
    install = { running: false, cats: install.cats, results: null, error: 'The download did not answer.' };
    emit();
    return null;
  }
}

export function cancelPackInstall() {
  window.api.packCancel?.().catch(() => {});
}
