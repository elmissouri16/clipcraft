import { useEffect, useState } from 'react';

// The folder-backed pack manifest (window.api.assetsList), fetched once and shared by the
// Audio tab's Music place and the Assets tab: a module-level cache + subscribers, so both
// panels share the in-flight request and receive its result. Returns null while loading,
// then { root, hasLibrary, items, counts, total, error? }.
let cache = null;
let pending = null;
const subs = new Set();

function load(refresh=false) {
  if(refresh&&pending)return pending.then(()=>load());
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
    subs.add(setLib);
    if(cache)setLib(cache);
    load();
    const off=window.api.onPluginsChanged?.(()=>{cache=null;load(true);});
    return () => {subs.delete(setLib);off?.();};
  }, []);
  return lib;
}
