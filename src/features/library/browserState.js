import { useState } from 'react';

// The mounted editor owns this map. Browser drafts survive navigation, never enter projects.
export function useBrowserState(memory, key, defaults) {
  const [state, setState] = useState(() => memory?.get(key) || defaults);
  const update = patch => setState(previous => {
    const next = { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) };
    memory?.set(key, next);
    return next;
  });
  return [state, update];
}
