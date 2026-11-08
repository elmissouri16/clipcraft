import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// Dropdown — the app's in-app select. Native <select> popups are drawn by the OS toolkit
// (on Linux/GTK they render pale-on-white and unreadable against the dark UI), so every
// dropdown that matters gets this instead: same values in and out as the <select> it
// replaces (numbers stay numbers), drawn in ClipCraft's own dark design language.
// Keyboard: Enter/Space/ArrowDown opens; ArrowUp/Down move; Enter/Space choose; Esc closes.
export default function Dropdown({ value, options, onChange, ariaLabel, className = '', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const [popup, setPopup] = useState(null);
  const btnRef = useRef(null);
  const pointerMoved = useRef(false); // hover highlights only after the pointer actually moves
  const selIdx = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selIdx];

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [ open ]);

  // Fit the menu inside the viewport and its scrolling/clipping ancestors.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const root = rootRef.current, list = listRef.current;
      if (!root || !list || getComputedStyle(list).position === 'static') return;
      const r = root.getBoundingClientRect();
      let top = 8, bottom = window.innerHeight - 8;
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      if (r.bottom < top || r.top > bottom) { setOpen(false); return; }
      const below = Math.max(0, bottom - r.bottom - 4), above = Math.max(0, r.top - top - 4);
      const wanted = Math.min(248, list.scrollHeight + 2);
      const up = below < wanted && above > below;
      const height = Math.floor(Math.min(wanted, up ? above : below));
      setPopup(previous => previous?.up === up && previous?.height === height ? previous : { up, height });
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [open, options.length]);

  // Only scroll the menu itself; keyboard navigation must not move its parent panel.
  useLayoutEffect(() => {
    const list = listRef.current, item = list?.children[hi];
    if (!open || !item) return;
    const bounds = list.getBoundingClientRect(), row = item.getBoundingClientRect();
    if (row.top < bounds.top + 4) list.scrollTop -= bounds.top + 4 - row.top;
    else if (row.bottom > bounds.bottom - 4) list.scrollTop += row.bottom - bounds.bottom + 4;
  }, [open, hi, popup]);

  const openList = (startIdx) => {
    pointerMoved.current = false;
    setHi(startIdx !== undefined ? startIdx : selIdx);
    setOpen(true);
  };
  const choose = (o) => {
    if (!o || o.disabled) return;
    setOpen(false);
    btnRef.current?.focus();
    if (o.value !== value) onChange(o.value);
  };
  const move = (dir) => {
    setHi((h) => {
      let n = h;
      for (let i = 0; i < options.length; i++) {
        n = (n + dir + options.length) % options.length;
        if (!options[n].disabled) break;
      }
      return n;
    });
  };
  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'Home') { e.preventDefault(); setHi(Math.max(0, options.findIndex(o => !o.disabled))); }
    else if (e.key === 'End') { e.preventDefault(); setHi(options.reduce((last, o, i) => o.disabled ? last : i, 0)); }
  };

  return (
    <div ref={rootRef} className={`dropdown ${open ? 'open' : ''} ${className}`} onKeyDown={onKeyDown}>
      <button ref={btnRef} type="button" className="dropdown-btn" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}>
        <span className="dropdown-label">{selected ? selected.label : ''}</span>
        <ChevronDown size={14} className="dropdown-chevron" />
      </button>
      {open && (
        <div ref={listRef} className="dropdown-list" role="listbox" aria-label={ariaLabel}
          style={popup ? { maxHeight: popup.height, ...(popup.up ? { top: 'auto', bottom: 'calc(100% + 4px)' } : {}) } : undefined}
          onMouseMove={() => { pointerMoved.current = true; }}>
          {options.map((o, i) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value}
              className={`dropdown-item ${o.value === value ? 'sel' : ''} ${i === hi ? 'hi' : ''} ${o.disabled ? 'dis' : ''}`}
              disabled={o.disabled}
              onMouseEnter={() => { if (pointerMoved.current) setHi(i); }}
              onClick={() => choose(o)}>
              <span className="dropdown-check">{o.value === value ? <Check size={13} /> : null}</span>
              <span className="dropdown-item-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
