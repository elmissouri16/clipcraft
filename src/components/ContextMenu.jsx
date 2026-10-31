import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Floating menu at (x, y). items: [{ label, icon, shortcut, onClick, disabled, hint } | 'sep'].
// Closes on a click outside, Escape, scroll or resize; stays inside the window.
export default function ContextMenu({ x, y, items, onClose, label = 'Clip menu' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    ref.current.querySelector('button:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...ref.current.querySelectorAll('button:not(:disabled)')];
        const i = btns.indexOf(document.activeElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  return (
    <div className="ctx-menu" role="menu" aria-label={label} ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="ctx-sep" role="separator" />;
        const Icon = it.icon;
        return (
          <button key={i} role="menuitem" disabled={it.disabled} title={it.disabled ? it.hint : undefined}
            onClick={() => { onClose(); it.onClick(); }}>
            <span className="ctx-icon">{Icon && <Icon size={15} />}</span>
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
