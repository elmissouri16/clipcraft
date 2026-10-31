import { useCallback, useEffect, useState } from 'react';

// Panel sizes like CapCut: drag the borders between the left panel, the player, the properties panel and the
// timeline. Sizes are remembered on this PC (per-user convenience only) and kept valid when the window shrinks.
const KEY = 'clipcraft.layout';
const GAP = 6;
export const MIN = { left: 240, right: 240, player: 320, top: 220, bottom: 150 };
const TOPBAR = 48;

const defaults = () => ({ left: 460, right: 330, bottom: Math.round(window.innerHeight * 0.38) });

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && [v.left, v.right, v.bottom].every((n) => Number.isFinite(n))) return v;
  } catch {
    // no storage: defaults
  }
  return defaults();
}

// Keeps every panel at least its minimum size for a window of W x H.
export function clampLayout(l, W = window.innerWidth, H = window.innerHeight) {
  const room = W - 2 * GAP - 2 * GAP - MIN.player; // what the two side panels may take together
  let left = Math.max(MIN.left, Math.min(l.left, Math.min(760, room - MIN.right)));
  let right = Math.max(MIN.right, Math.min(l.right, Math.min(620, room - left)));
  if (left + right > room) left = Math.max(MIN.left, room - right);
  const bottom = Math.max(MIN.bottom, Math.min(l.bottom, H - TOPBAR - GAP * 3 - MIN.top));
  return { left: Math.round(left), right: Math.round(right), bottom: Math.round(bottom) };
}

export function useLayout() {
  const [layout, setLayout] = useState(() => clampLayout(load()));
  const [, setSize] = useState(0);

  useEffect(() => {
    const onResize = () => setSize((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      // not saved: fine
    }
  }, [layout]);

  // Starts dragging one border. which: 'left' | 'right' | 'bottom'.
  const startDrag = useCallback((which, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = clampLayout(layout);
    document.body.classList.add(which === 'bottom' ? 'resizing-row' : 'resizing-col');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const next = { ...start };
      // A side panel grows only into the player, never into the other side panel.
      const room = window.innerWidth - 4 * GAP - MIN.player;
      if (which === 'left') next.left = Math.min(start.left + dx, room - start.right);
      if (which === 'right') next.right = Math.min(start.right - dx, room - start.left);
      if (which === 'bottom') next.bottom = start.bottom - dy;
      setLayout(clampLayout(next));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-row', 'resizing-col');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [layout]);

  const reset = useCallback((which) => {
    setLayout((l) => clampLayout({ ...l, [which]: defaults()[which] }));
  }, []);

  // Arrow keys on a focused border move it by 16 px.
  const nudge = useCallback((which, e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: -step, ArrowRight: step, ArrowUp: -step, ArrowDown: step }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setLayout((l) => clampLayout({
      ...l,
      ...(which === 'left' ? { left: l.left + d } : which === 'right' ? { right: l.right - d } : { bottom: l.bottom - d }),
    }));
  }, []);

  return { layout: clampLayout(layout), startDrag, reset, nudge };
}
