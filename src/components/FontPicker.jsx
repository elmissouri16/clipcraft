import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus, Search, Star, X } from 'lucide-react';
import { CUSTOM_GROUP, allFonts, fontById, fontsReady, importFonts, onFontsChanged, removeFont } from '../fonts.js';

const FAV_KEY = 'clipcraft.favoriteFonts';
function loadFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
const ARABIC_SAMPLE = 'نص عربي';
const isFontFile = (f) => /\.(ttf|otf|woff2?)$/i.test(f.name);

// Font picker like CapCut's: every name drawn in its own font, search, groups and favorites (kept on this PC).
// "Add font" (or dropping .ttf / .otf files on the list) adds your own fonts, kept for every project.
export default function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('All');
  const [favs, setFavs] = useState(loadFavs);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [dropOver, setDropOver] = useState(false);
  const [, setTick] = useState(0);
  const listRef = useRef(null);
  useEffect(() => {
    fontsReady().then(() => setTick((n) => n + 1));
    return onFontsChanged(() => setTick((n) => n + 1));
  }, []);
  // Scroll the chosen font into view when the list opens.
  useEffect(() => {
    if (open) listRef.current?.querySelector('.font-row.on')?.scrollIntoView({ block: 'center' });
  }, [open]);

  const fonts = allFonts();
  const cur = fontById(value);
  const groups = ['All', 'Favorites', ...new Set(fonts.map((f) => f.group))];
  const words = q.trim().toLowerCase();
  const shown = fonts.filter((f) => (words ? f.name.toLowerCase().includes(words)
    : group === 'All' || (group === 'Favorites' ? favs.has(f.id) : f.group === group)));

  const toggleFav = (id) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    } catch {
      // favorites stay for this session
    }
  };
  const add = async (files) => {
    setBusy(true);
    setNote('');
    const res = await importFonts(files);
    setBusy(false);
    if (res.error) return setNote(res.error);
    if (res.skipped?.length) setNote(`Not a font file: ${res.skipped.join(', ')}`);
    if (res.added?.length) {
      setQ('');
      setGroup(CUSTOM_GROUP);
      onChange(res.added[0]);
    }
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove "${f.name}" from your fonts?\nText that uses it switches to Arial.`)) return;
    const res = await removeFont(f.id);
    if (res.error) setNote(res.error);
  };
  const onDrop = (e) => {
    const files = [...e.dataTransfer.files].filter(isFontFile);
    setDropOver(false);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    add(files);
  };
  const fontStyle = (f) => ({ fontFamily: `"${f.family}", Arial, sans-serif`, fontWeight: f.regular });

  return (
    <div className="font-picker">
      <button type="button" className={`font-current ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span style={fontStyle(cur)}>{cur.name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`font-panel ${dropOver ? 'drop' : ''}`}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
          onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); e.stopPropagation(); setDropOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false); }}
          onDrop={onDrop}>
          <div className="font-tools">
            <form className="lib-search" onSubmit={(e) => { e.preventDefault(); if (shown[0]) { onChange(shown[0].id); setOpen(false); } }}>
              <Search size={14} aria-hidden="true" />
              <input type="search" autoFocus value={q} placeholder="Search fonts" aria-label="Search fonts" onChange={(e) => setQ(e.target.value)} />
              {q && <button type="button" className="lib-search-clear" aria-label="Clear search" onClick={() => setQ('')}><X size={13} /></button>}
            </form>
            <button type="button" className="btn btn-sm" onClick={() => add()} disabled={busy} title="Add .ttf, .otf or .woff font files (or drop them on this list). They stay for every project.">
              {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add font
            </button>
          </div>
          {!words && (
            <div className="chips scroll-x">
              {groups.map((g) => <button key={g} type="button" className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g}</button>)}
            </div>
          )}
          {note && <p className="error-text">{note}</p>}
          <div className="font-list" ref={listRef} role="listbox" aria-label="Fonts">
            {shown.map((f) => (
              <div key={f.id} className={`font-row ${f.id === cur.id ? 'on' : ''}`} role="option" aria-selected={f.id === cur.id}>
                <button type="button" className="font-name" style={fontStyle(f)} onClick={() => { onChange(f.id); setOpen(false); }} title={f.name}>
                  {f.name.replace(/ \(Arabic\)$/, '')}
                  {f.group === 'Arabic' && <span className="font-sample">{ARABIC_SAMPLE}</span>}
                </button>
                {f.group === CUSTOM_GROUP && (
                  <button type="button" className="font-icon" onClick={() => remove(f)} aria-label={`Remove ${f.name}`} title="Remove from your fonts"><X size={13} /></button>
                )}
                <button type="button" className={`font-icon ${favs.has(f.id) ? 'fav' : ''}`} onClick={() => toggleFav(f.id)}
                  aria-label={favs.has(f.id) ? `Remove ${f.name} from favorites` : `Add ${f.name} to favorites`} aria-pressed={favs.has(f.id)}>
                  <Star size={13} fill={favs.has(f.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
            ))}
            {!shown.length && (
              <p className="empty-note">
                {group === 'Favorites' && !words ? 'Click the star next to a font to keep it here.'
                  : group === CUSTOM_GROUP && !words ? 'Add your own .ttf or .otf fonts with “Add font”, or drop them here.'
                    : `No font named “${q}”.`}
              </p>
            )}
          </div>
          {dropOver && <div className="font-drop">Drop fonts to add them</div>}
        </div>
      )}
    </div>
  );
}
