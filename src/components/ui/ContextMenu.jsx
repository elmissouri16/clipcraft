import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { t } from '../../i18n/index.js';

// Floating menu at (x, y). items: [{ label, icon, shortcut, onClick, disabled, hint } |
// { label, icon, submenu: [items], disabled, hint } | 'sep'].
// Closes on a click outside, Escape, scroll or resize; stays inside the window.
export default function ContextMenu({ x, y, items, onClose, label = t('menu.clip_menu'),className='' }) {
  const ref = useRef(null);
  const subRef = useRef(null);
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

  // The placement above only knows the parent item's top; a submenu that starts
  // low on the screen would spill past the bottom edge with its last items
  // unreachable. Measure the rendered submenu and shift it up to fit.
  useLayoutEffect(() => {
    if (openSub < 0 || !subPos) return;
    const el = subRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top=Math.max(4,Math.min(subPos.top,window.innerHeight-r.height-4));
    let left=subPos.left;
    if(r.right>window.innerWidth-4){const anchor=ref.current?.querySelector('[data-sub-open="true"]')?.getBoundingClientRect();left=Math.max(4,(anchor?.left||window.innerWidth)-r.width-3);}
    if(Math.abs(top-subPos.top)>1||Math.abs(left-subPos.left)>1)setSubPos({left,top});
  }, [openSub, subPos]);

  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose('outside'); };
    const key = (e) => {
      const parent=ref.current?.querySelector('[data-sub-open="true"] > button');
      if(e.key==='ArrowRight'&&document.activeElement?.getAttribute('aria-haspopup')==='menu'&&ref.current?.contains(document.activeElement)){
        e.preventDefault();if(document.activeElement.getAttribute('aria-expanded')!=='true')document.activeElement.click();requestAnimationFrame(()=>subRef.current?.querySelector('button:not(:disabled)')?.focus());
      }
      if((e.key==='ArrowLeft'||e.key==='Escape')&&subRef.current?.contains(document.activeElement)){
        e.preventDefault();e.stopPropagation();setOpenSub(-1);parent?.focus();return;
      }
      if (e.key === 'Escape') { e.preventDefault();e.stopPropagation(); onClose('escape'); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const within=subRef.current?.contains(document.activeElement),scope=within?subRef.current:ref.current;
        const btns = [...scope.querySelectorAll('button:not(:disabled)')].filter(button=>within||!subRef.current?.contains(button));
        const i = btns.indexOf(document.activeElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    const wheel=event=>{if(!ref.current?.contains(event.target))onClose('scroll');};
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', wheel);
    };
  }, [onClose,openSub]);

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
            <div className="ctx-menu ctx-sub" data-detailed-menu={it.submenu.some(item=>item.detail)||undefined} role="menu" aria-label={it.label} style={subPos} ref={subRef}>
              {renderItems(it.submenu, true)}
            </div>
          )}
        </div>
      );
    }
    return (
      <button key={i} role="menuitem" disabled={it.disabled}
        onMouseEnter={() => { if (!sub) setOpenSub(-1); }}
        id={it.id} data-menu-detail={it.detail?true:undefined} title={it.disabled?it.hint:it.detail?it.label+' · '+it.detail:undefined}
        onClick={() => { onClose('choose'); it.onClick(); }}>
        <span className="ctx-icon">{Icon && <Icon size={15} />}</span>
        <span className="ctx-label">{it.label}{it.detail&&<small className="ctx-detail">{it.detail}</small>}</span>
        {it.shortcut && <kbd>{it.shortcut}</kbd>}
      </button>
    );
  });

  return (
    <div className={`ctx-menu ${className}`} role="menu" aria-label={label} ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {renderItems(items)}
    </div>
  );
}
