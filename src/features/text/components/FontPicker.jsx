import { askConfirm } from '../../../app/dialogs.js';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus, Search, Star, X } from 'lucide-react';
import { CUSTOM_GROUP, allFonts, fontById, fontStatus, fontsReady, importFonts, onFontsChanged, removeFont } from '../fonts.js';
import { t } from '../../../i18n/index.js';

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
// Group names are ids (fonts.js compares them); these are their labels.
const GROUP_LABELS = {
  All: t('library.all_2'), Favorites: t('library.favorites'), Arabic: t('text.arabic'), Basic: t('clip.basic'), Display: t('text.display'),
  Elegant: t('text.elegant'), Popular: t('text.popular'), Script: t('text.script'), [CUSTOM_GROUP]: t('text.your_fonts'), Plugins:t('plugins.title'),
};

// Font picker: every name drawn in its own font, search, groups and favorites (kept on this PC).
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
    let live = true;
    fontsReady([{font:value,text:fontById(value).name,bold:false}]).then(() => live && setTick(n => n + 1));
    const off = onFontsChanged(() => setTick((n) => n + 1));
    return () => { live=false;off(); };
  }, [value]);
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
  const shownKey = shown.map(f => f.id).join(',');
  useEffect(() => {
    if (!open || !listRef.current) return;
    const observer = new IntersectionObserver(entries => {
      const clips = [];
      for (const entry of entries) if (entry.isIntersecting) {
        const font = fonts.find(f => f.id === entry.target.dataset.fontId);
        if (font) clips.push({font:font.id,text:font.name+(font.group==='Arabic'?ARABIC_SAMPLE:''),bold:false});
        observer.unobserve(entry.target);
      }
      if (clips.length) fontsReady(clips);
    }, {root:listRef.current});
    listRef.current.querySelectorAll('[data-font-id]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [open, shownKey]);

  const selectFont = async f => {
    const missing = await fontsReady([{font:f.id,text:f.name,bold:false}]);
    if (missing.length) { setNote(t('fonts.preview_missing',{names:missing.join(', ')}));return; }
    onChange(f.id);setOpen(false);setNote('');
  };

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
    if (res.skipped?.length) setNote(t('text.not_a_font_file', { names: res.skipped.join(', ') }));
    if (res.added?.length) {
      setQ('');
      setGroup(CUSTOM_GROUP);
      onChange(res.added[0]);
    }
  };
  const remove = async (f) => {
    if (!askConfirm(t('text.remove_name_from_your_fonts', { name: f.name }), t('home.remove'))) return;
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
  const fontStyle = (f) => fontStatus(f.id) === true ? { fontFamily: `"${f.family}", Arial, sans-serif`, fontWeight: f.regular } : undefined;

  return (
    <div className="font-picker">
      <button type="button" className={`font-current ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span style={fontStyle(cur)}>{fontStatus(value) === false ? t('fonts.missing_name',{name:fonts.find(f=>f.id===value)?.name||value}) : cur.name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`font-panel ${dropOver ? 'drop' : ''}`}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
          onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); e.stopPropagation(); setDropOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false); }}
          onDrop={onDrop}>
          <div className="font-tools">
            <form className="lib-search" onSubmit={(e) => { e.preventDefault(); const first=shown.find(f=>fontStatus(f.id)!==false);if(first)selectFont(first); }}>
              <Search size={14} aria-hidden="true" />
              <input type="search" autoFocus value={q} placeholder={t('font-picker.search_fonts')} aria-label={t('font-picker.search_fonts')} onChange={(e) => setQ(e.target.value)} />
              {q && <button type="button" className="lib-search-clear" aria-label={t('search.clear_search')} onClick={() => setQ('')}><X size={13} /></button>}
            </form>
            <button type="button" className="btn btn-sm" onClick={() => add()} disabled={busy} title={t('font-picker.add_ttf_otf_or_woff_font_files_or_drop_the')}>
              {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} {t('font-picker.add_font')}
            </button>
          </div>
          {!words && (
            <div className="chips scroll-x">
              {groups.map((g) => <button key={g} type="button" className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{GROUP_LABELS[g] || g}</button>)}
            </div>
          )}
          {note && <p className="error-text">{note}</p>}
          <div className="font-list" ref={listRef} role="listbox" aria-label={t('font-picker.fonts')}>
            {shown.map((f) => (
              <div key={f.id} data-font-id={f.id} className={`font-row ${f.id === cur.id ? 'on' : ''}`} role="option" aria-selected={f.id === cur.id} aria-disabled={fontStatus(f.id)===false}>
                <button type="button" className="font-name" style={fontStyle(f)} disabled={fontStatus(f.id)===false} onClick={() => selectFont(f)} title={f.name}>
                  {f.name.replace(/ \(Arabic\)$/, '')}
                  {f.group === 'Arabic' && <span className="font-sample">{ARABIC_SAMPLE}</span>}
                </button>
                <small className="font-source">{t(fontStatus(f.id)===false?'fonts.unavailable':`fonts.${f.source}`)}</small>
                {f.group === CUSTOM_GROUP && (
                  <button type="button" className="font-icon" onClick={() => remove(f)} aria-label={t('text.remove_name', { name: f.name })} title={t('font-picker.remove_from_your_fonts')}><X size={13} /></button>
                )}
                <button type="button" className={`font-icon ${favs.has(f.id) ? 'fav' : ''}`} onClick={() => toggleFav(f.id)}
                  aria-label={t(favs.has(f.id) ? 'text.remove_name_from_favorites' : 'text.add_name_to_favorites', { name: f.name })} aria-pressed={favs.has(f.id)}>
                  <Star size={13} fill={favs.has(f.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
            ))}
            {!shown.length && (
              <p className="empty-note">
                {group === 'Favorites' && !words ? t('text.click_the_star_next_to_a_font_to_keep')
                  : group === CUSTOM_GROUP && !words ? t('text.add_your_own_ttf_or_otf_fonts_with_add')
                    : t('text.no_font_named', { query: q })}
              </p>
            )}
          </div>
          {dropOver && <div className="font-drop">{t('font-picker.drop_fonts_to_add_them')}</div>}
        </div>
      )}
    </div>
  );
}
