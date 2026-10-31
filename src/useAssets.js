import { useEffect, useState } from 'react';

// The folder-backed pack manifest (window.api.assetsList), fetched once and shared by the
// Audio tab's Music place and the Assets tab: a module-level cache + subscribers, so both
// panels read the same snapshot and a refresh reaches both. Returns null while loading,
// then { root, hasLibrary, items, counts, total, error? }.
let cache = null;
let pending = null;
const subs = new Set();

function load() {
  if (!pending) {
    pending = window.api.assetsList()
      .then((lib) => { cache = lib; pending = null; subs.forEach((fn) => fn(lib)); return lib; })
      .catch((e) => { pending = null; const lib = { root: '', hasLibrary: false, items: [], counts: {}, total: 0, error: e.message }; cache = lib; subs.forEach((fn) => fn(lib)); return lib; });
  }
  return pending;
}

export function useAssets() {
  const [lib, setLib] = useState(cache);
  useEffect(() => {
    if (cache) { setLib(cache); return undefined; }
    subs.add(setLib);
    load();
    return () => subs.delete(setLib);
  }, []);
  return lib;
}

export function refreshAssets() {
  cache = null;
  pending = null;
  return load();
}
