import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import React from 'react';

// Favorites shared by every panel (one list for the whole app, kept by the main process across projects).
let entries = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(entries));

function ensureLoaded() {
  if (entries) return;
  entries = [];
  window.api.favoritesList().then((list) => {
    entries = list;
    emit();
  });
}

export function useFavorites() {
  const [list, setList] = useState(entries || []);
  useEffect(() => {
    ensureLoaded();
    listeners.add(setList);
    setList(entries);
    return () => listeners.delete(setList);
  }, []);
  const has = (key) => list.some((e) => e.key === key);
  const toggle = async (entry) => {
    const res = await window.api.favoritesToggle(entry);
    if (Array.isArray(res)) {
      entries = res;
      emit();
    }
  };
  return { list, has, toggle };
}

// Entries for the things the app shows.
export const favLibrary = (item) => ({ key: `lib:${item.id}`, type: 'audio', source: 'library', item });
export const favStock = (item) => ({ key: `stock:${item.kind}:${item.id}`, type: item.kind === 'video' ? 'video' : 'photo', source: 'stock', item });
export const favFile = (m) => ({
  key: `file:${m.path}`,
  type: m.type === 'image' ? 'photo' : m.type,
  source: 'file',
  item: {
    path: m.path, name: m.name, type: m.type, duration: m.duration, width: m.width, height: m.height,
    thumb: m.thumb, thumbCount: m.thumbCount, wave: m.wave, credit: m.credit,
  },
});

export function FavStar({ entry, className = '' }) {
  const { has, toggle } = useFavorites();
  const on = has(entry.key);
  return (
    <button className={`fav-star ${on ? 'on' : ''} ${className}`} aria-pressed={on}
      aria-label={on ? 'Remove from favorites' : 'Add to favorites'} title={on ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => { e.stopPropagation(); toggle(entry); }} onDoubleClick={(e) => e.stopPropagation()}>
      <Star size={13} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
