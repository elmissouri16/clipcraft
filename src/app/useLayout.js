import { useCallback, useEffect, useRef, useState } from 'react';

// Panel sizes: drag the borders between the left panel, the player, the properties panel and the
// timeline. Sizes are remembered on this PC (per-user convenience only) and kept valid when the window shrinks.
const KEY = 'clipcraft.layout';
const GAP = 10;
const FRAME_WIDTH = 20;
const FRAME_HEIGHT = 18;
export const MIN = { left: 240, right: 240, player: 320, top: 220, bottom: 150 };
const TOPBAR = 48;

const defaults = () => ({ left: 460, right: 330, bottom: Math.round(window.innerHeight * 0.38) });

function load(mode) {
  try {
    const v = JSON.parse(localStorage.getItem(mode === 'agent' ? KEY + '.agent' : KEY) || 'null');
    if (v && [v.left, v.right, v.bottom].every((n) => Number.isFinite(n))) return v;
  } catch {
    // no storage: defaults
  }
  return mode === 'agent' ? { left: 400, right: 330, bottom: 180, rightCollapsed: true } : defaults();
}

// Keeps every panel at least its minimum size for a window of W x H.
export function clampLayout(l, W = window.innerWidth, H = window.innerHeight) {
  const room = W - FRAME_WIDTH - 2 * GAP - MIN.player; // what the two side panels may take together
  const rightCollapsed = !!l.rightCollapsed;
  let left = Math.max(MIN.left, Math.min(l.left, Math.min(760, room - (rightCollapsed ? 0 : MIN.right))));
  let right = Math.max(MIN.right, Math.min(l.right, Math.min(620, rightCollapsed ? 620 : room - left)));
  if (!rightCollapsed && left + right > room) left = Math.max(MIN.left, room - right);
  const bottom = Math.max(MIN.bottom, Math.min(l.bottom, H - FRAME_HEIGHT - TOPBAR - GAP * 2 - MIN.top));
  return { left: Math.round(left), right: Math.round(right), bottom: Math.round(bottom), rightCollapsed };
}

export function clampAgentLayout(l, W = window.innerWidth, H = window.innerHeight, toolsOpen = false) {
  const right = W < 1200 ? 300 : 330;
  const room = W - (toolsOpen ? right + 40 + MIN.player : 380);
  return { left: Math.round(Math.max(320, Math.min(l.left, 640, room))), right,
    bottom: Math.round(Math.max(150, Math.min(l.bottom, H - 350))), rightCollapsed: true };
}

export function useLayout(mode = 'edit', toolsOpen = false) {
  const [layouts, setLayouts] = useState(() => ({ edit: clampLayout(load('edit')), agent: clampAgentLayout(load('agent')) }));
  const layout = layouts[mode];
  const clamp = mode === 'agent' ? l => clampAgentLayout(l, undefined, undefined, toolsOpen) : clampLayout;
  const setLayout = useCallback(value => setLayouts(all => ({ ...all, [mode]: typeof value === 'function' ? value(all[mode]) : value })), [mode]);
  const [, setSize] = useState(0);
  const previousHeight = useRef(window.innerHeight);

  useEffect(() => {
    const onResize = () => {
      const ratio = window.innerHeight / previousHeight.current;
      previousHeight.current = window.innerHeight;
      if (ratio !== 1) setLayouts(all => ({ ...all, edit: { ...all.edit, bottom: Math.round(all.edit.bottom * ratio) } }));
      setSize(n => n + 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(mode === 'agent' ? KEY + '.agent' : KEY, JSON.stringify(layout));
    } catch {
      // not saved: fine
    }
  }, [layout, mode]);

  // Starts dragging one border. which: 'left' | 'right' | 'bottom'.
  const startDrag = useCallback((which, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = clamp(layout);
    document.body.classList.add(which === 'bottom' ? 'resizing-row' : 'resizing-col');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const next = { ...start };
      // A side panel grows only into the player, never into the other side panel.
      const room = window.innerWidth - FRAME_WIDTH - 2 * GAP - MIN.player;
      if (which === 'left') next.left = Math.min(start.left + dx, mode === 'agent' ? Math.min(640, room) : room - (start.rightCollapsed ? 0 : start.right));
      if (which === 'right') next.right = Math.min(start.right - dx, room - start.left);
      if (which === 'bottom') next.bottom = start.bottom - dy;
      setLayout(clamp(next));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-row', 'resizing-col');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [layout, mode, toolsOpen, setLayout]);

  const reset = useCallback((which) => {
    setLayout((l) => clamp({ ...l, [which]: mode === 'agent' ? ({ left: 400, right: 330, bottom: 180 })[which] : defaults()[which] }));
  }, [mode, toolsOpen, setLayout]);

  // Arrow keys on a focused border move it by 16 px.
  const nudge = useCallback((which, e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: -step, ArrowRight: step, ArrowUp: -step, ArrowDown: step }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setLayout((l) => clamp({
      ...l,
      ...(which === 'left' ? { left: l.left + d } : which === 'right' ? { right: l.right - d } : { bottom: l.bottom - d }),
    }));
  }, [mode, toolsOpen, setLayout]);

  const setRightCollapsed = useCallback((collapsed) => {
    setLayout(l => clamp({ ...l, rightCollapsed: collapsed }));
  }, [mode, toolsOpen, setLayout]);

  const setBottom = useCallback(bottom => setLayout(l => clamp({ ...l, bottom })), [mode, toolsOpen, setLayout]);

  return { layout: clamp(layout), setBottom, setRightCollapsed, startDrag, reset, nudge };
}
