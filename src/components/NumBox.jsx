import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// NumBox — the app's one numeric field, a scrub field in the editor tradition:
// - Drag the label or the field horizontally to scrub (pointer capture, ew-resize cursor, live
//   updates). Shift = fine (0.1×step), Alt = coarse (10×step). A plain click focuses for typing.
// - Typing: Enter commits, Esc reverts, blur commits. ArrowUp/Down step (Shift ×10). Mouse wheel
//   steps while hovered or focused. Dark chevron steppers replace the native spinner (which is
//   also hidden app-wide in styles.css). The focus ring hugs the box exactly (:focus-within).
// - onDragStart/onDragEnd let callers wrap a whole scrub in one undo gesture.
// Values and units are the caller's: nothing here rescales or reformats beyond the historical
// display (two-decimal trim), so migrations change chrome, never numbers.
export default function NumBox({ label, value, onChange, step = 1, suffix, min, max, ariaLabel, className = '', layout, onDragStart, onDragEnd }) {
  const [text, setText] = useState(null); // string while editing, null when showing the prop value
  const [scrubbing, setScrubbing] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const drag = useRef(null);
  const repeat = useRef(null);
  const suppressCommit = useRef(false); // Enter/Escape settle the edit themselves; the blur that follows must not re-commit

  const clampV = (v) => (min !== undefined && v < min ? min : max !== undefined && v > max ? max : v);
  const decimals = Math.min(4, (String(step).split('.')[1] || '').length);
  const tidy = (v) => Number(v.toFixed(Math.max(decimals, 2)));
  const shown = text !== null ? text : String(Number(Number(value || 0).toFixed(2)));

  const commit = (raw) => {
    const v = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(v)) return false;
    onChange(tidy(clampV(v)));
    return true;
  };

  // Wheel stepping needs a non-passive listener to keep the panel from scrolling.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const mult = e.shiftKey ? 10 : 1;
      commit((Number(value) || 0) + (e.deltaY < 0 ? step : -step) * mult);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [value, step, min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRepeat = () => { if (repeat.current) { clearTimeout(repeat.current.t); clearInterval(repeat.current.i); repeat.current = null; } };
  useEffect(() => stopRepeat, []);

  const stepBy = (dir, mult = 1) => commit((Number(value) || 0) + dir * step * mult);
  const stepperDown = (e, dir) => {
    e.preventDefault();
    e.stopPropagation();
    onDragStart?.();
    stepBy(dir);
    const t = setTimeout(() => { repeat.current = { t, i: setInterval(() => stepBy(dir), 55) }; }, 380);
    repeat.current = { t, i: null };
    const up = () => { stopRepeat(); onDragEnd?.(); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('.numbox-steps')) return;
    drag.current = { x: e.clientX, value: Number(value) || 0, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 3) {
      d.moved = true;
      setScrubbing(true);
      setText(null);
      document.body.style.cursor = 'ew-resize';
      onDragStart?.();
    }
    if (d.moved) {
      const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      commit(d.value + (dx / 3) * step * mult);
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      setScrubbing(false);
      document.body.style.cursor = '';
      onDragEnd?.();
    } else {
      // Plain click: type, with everything selected.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const settle = (commitIt) => {
    if (commitIt) commit(text ?? shown);
    suppressCommit.current = true;
    setText(null);
    inputRef.current?.blur();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    else if (e.key === 'Escape') { e.preventDefault(); settle(false); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = text !== null && Number.isFinite(parseFloat(text)) ? parseFloat(text) : Number(value) || 0;
      const nv = tidy(clampV(base + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)));
      onChange(nv);
      if (text !== null) setText(String(nv));
    }
  };

  return (
    <label ref={rootRef}
      className={`numbox ${layout === 'field' ? 'numbox-field' : ''} ${scrubbing ? 'scrubbing' : ''} ${className}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {label != null && label !== '' && <span className="numbox-label">{label}</span>}
      <input ref={inputRef} type="text" inputMode="decimal" aria-label={ariaLabel || (label ? `${label} value` : 'value')}
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { setText(String(Number(Number(value || 0).toFixed(2)))); requestAnimationFrame(() => e.target.select()); }}
        onBlur={() => { if (suppressCommit.current) { suppressCommit.current = false; setText(null); return; } if (text !== null) { commit(text); setText(null); } }}
        onKeyDown={onKeyDown} />
      {suffix && <i>{suffix}</i>}
      <span className="numbox-steps" aria-hidden="true">
        <button type="button" tabIndex={-1} aria-label="Step up" onPointerDown={(e) => stepperDown(e, 1)}><ChevronUp size={10} /></button>
        <button type="button" tabIndex={-1} aria-label="Step down" onPointerDown={(e) => stepperDown(e, -1)}><ChevronDown size={10} /></button>
      </span>
    </label>
  );
}
