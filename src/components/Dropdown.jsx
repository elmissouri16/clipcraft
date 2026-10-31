import React, { useEffect, useRef, useState } from 'react';
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
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); }
    else if (e.key === 'End') { e.preventDefault(); setHi(options.length - 1); }
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
        <div className="dropdown-list" role="listbox" aria-label={ariaLabel}
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
