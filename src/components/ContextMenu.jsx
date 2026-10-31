import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

// Floating menu at (x, y). items: [{ label, icon, shortcut, onClick, disabled, hint } |
// { label, icon, submenu: [items], disabled, hint } | 'sep'].
// Closes on a click outside, Escape, scroll or resize; stays inside the window.
export default function ContextMenu({ x, y, items, onClose, label = 'Clip menu' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState(-1); // index of the item whose submenu is open
  const [subPos, setSubPos] = useState(null); // fixed position of the open submenu

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    ref.current.querySelector('button:not(:disabled)')?.focus();
  }, [x, y]);

  // The submenu is position:fixed (measured from its parent item) so the menu's own
  // scroll overflow cannot clip it; near the right edge it opens to the left instead.
  useLayoutEffect(() => {
    if (openSub < 0) { setSubPos(null); return; }
    const wrap = ref.current?.querySelector('[data-sub-open="true"]');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const W = 224;
    const left = r.right + W + 6 > window.innerWidth ? Math.max(4, r.left - W - 3) : r.right + 3;
    setSubPos({ left, top: Math.max(4, r.top - 5) });
  }, [openSub ]);

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

  const renderItems = (list, sub = false) => list.map((it, i) => {
    if (it === 'sep') return <div key={i} className="ctx-sep" role="separator" />;
    const Icon = it.icon;
    if (!sub && it.submenu) {
      return (
        <div key={i} className="ctx-subwrap" data-sub-open={openSub === i || undefined} onMouseEnter={() => !it.disabled && setOpenSub(i)}>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={openSub === i} disabled={it.disabled}
            title={it.disabled ? it.hint : undefined} onClick={() => !it.disabled && setOpenSub(openSub === i ? -1 : i)}>
            <span className="ctx-icon">{Icon && <Icon size={15} />}</span>
            <span className="ctx-label">{it.label}</span>
            <ChevronRight size={13} className="ctx-chev" />
          </button>
          {openSub === i && subPos && (
            <div className="ctx-menu ctx-sub" role="menu" aria-label={it.label} style={subPos}>
              {renderItems(it.submenu, true)}
            </div>
          )}
        </div>
      );
    }
    return (
      <button key={i} role="menuitem" disabled={it.disabled} title={it.disabled ? it.hint : undefined}
        onMouseEnter={() => { if (!sub) setOpenSub(-1); }}
        onClick={() => { onClose(); it.onClick(); }}>
        <span className="ctx-icon">{Icon && <Icon size={15} />}</span>
        <span className="ctx-label">{it.label}</span>
        {it.shortcut && <kbd>{it.shortcut}</kbd>}
      </button>
    );
  });

  return (
    <div className="ctx-menu" role="menu" aria-label={label} ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {renderItems(items)}
    </div>
  );
}
