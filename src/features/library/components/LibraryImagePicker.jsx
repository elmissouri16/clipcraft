import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Image, ImageOff, Search, X } from 'lucide-react';
import { toFileUrl } from '../../../state/store.js';
import { isLibraryPicture } from '../../graphics/graphicImages.js';
import { t } from '../../../i18n/index.js';

function Thumbnail({ media }) {
  const [failed, setFailed] = useState(0);
  const thumb = media?.thumb && !(media.thumbCount > 1) ? media.thumb : null;
  useEffect(() => setFailed(0), [media?.path, thumb]);
  const source = failed === 0 && thumb ? thumb : failed < (thumb ? 2 : 1) ? media?.path : null;
  return <span className="library-image-thumb" aria-hidden="true">
    {source ? <img src={toFileUrl(source)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(n => n + 1)} /> : media ? <ImageOff size={18} /> : <Image size={18} />}
  </span>;
}

// The value is a library media id. Opening, searching and dismissing never edit the project.
export default function LibraryImagePicker({ media, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(null);
  const trigger = useRef(null), panel = useRef(null), search = useRef(null), list = useRef(null);
  const pictures = media.filter(isLibraryPicture);
  const chosen = pictures.find(item => item.id === value);
  const words = query.trim().toLocaleLowerCase();
  const shown = pictures.filter(item => (item.name || item.id).toLocaleLowerCase().includes(words));
  const name = chosen?.name || chosen?.id || (value ? t('graphic.missing_picture_removed_from_the_library') : t('grade.none'));
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const choose = id => { close(true); if (id !== value) onChange(id); };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { setOpen(false); return; }
      const width = Math.min(420, window.innerWidth - 16);
      const below = window.innerHeight - anchor.bottom - 12, above = anchor.top - 12;
      const up = below < 420 && above > below;
      const height = Math.min(420, Math.max(0, up ? above : below));
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
        top: up ? anchor.top - height - 4 : anchor.bottom + 4, width, height });
    };
    place();
    const scroll = event => { if (!panel.current?.contains(event.target)) place(); };
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = event => {
      if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const selected = list.current.querySelector('[aria-selected="true"]');
    list.current.scrollTop = 0;
    if (selected) {
      const bounds = list.current.getBoundingClientRect(), row = selected.getBoundingClientRect();
      list.current.scrollTop += Math.max(0, row.top - bounds.top - (bounds.height - row.height) / 2);
    }
  }, [open, position?.height, query]);

  const navigate = event => {
    const options = [...list.current.querySelectorAll('[role="option"]')];
    const index = options.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const columns = options.filter(option => option.offsetTop === options[0].offsetTop).length || 1;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + offset));
    options[next]?.focus();
  };

  return <div className="library-image-picker">
    <button ref={trigger} type="button" className="library-image-current" aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      title={name} onClick={() => { setQuery(''); setOpen(!open); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setQuery(''); setOpen(true); }
      }}>
      <Thumbnail media={chosen}/><span>{name}</span><ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={panel} className="library-image-popover" style={position || { visibility: 'hidden' }} role="dialog" aria-label={label}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
      }}>
      <div className="library-image-heading"><strong>{label}</strong><button type="button" className="icon-btn sm" aria-label={t('app.close')} onClick={() => close(true)}><X size={14}/></button></div>
      <div className="library-image-search"><Search size={14} aria-hidden="true"/>
        <input ref={search} type="search" value={query} placeholder={t('image-picker.search_images')} aria-label={t('image-picker.search_images')}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); list.current?.querySelector('[role="option"]')?.focus(); }
          }}/>
      </div>
      <button type="button" className="library-image-none" aria-pressed={!value} onClick={() => choose('')}><ImageOff size={14}/><span>{t('grade.none')}</span>{!value && <Check size={14}/>}</button>
      <div ref={list} className="library-image-grid" role="listbox" aria-label={t('image-picker.library_images')} onKeyDown={navigate}>
        {shown.map(item => <button key={item.id} type="button" className="library-image-option" role="option" aria-selected={item.id === value}
          aria-label={item.name || item.id} title={item.name || item.id} onClick={() => choose(item.id)}>
          <Thumbnail media={item}/><span className="library-image-name">{item.name || item.id}</span>{item.id === value && <Check className="library-image-check" size={14} aria-hidden="true"/>}
        </button>)}
        {!shown.length && <p className="library-image-empty" role="status">{t(pictures.length ? 'image-picker.no_matches' : 'image-picker.no_images')}</p>}
      </div>
    </div>, document.body)}
  </div>;
}
