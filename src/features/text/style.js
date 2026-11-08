// Pure text style resolution, shared by drawing and frame-change detection.
import { isAnimUnit } from './units.js';

export const TEXT_DEFAULTS = {
  text: '',
  font: 'montserrat',
  size: 64,
  bold: true,
  italic: false,
  underline: false,
  uppercase: false,
  color: '#ffffff',
  color2: '#ff4fd8',
  glowColor: '#ff2bd6',
  letterSpacing: 0,
  lineHeight: 1.15,
  align: 'center',
  maxWidth: 0.86,
  x: 0.5,
  y: 0.85,
  rotation: 0, // degrees
  opacity: 1,
  stroke: { width: 6, color: '#000000' },
  shadow: { on: true, color: '#000000', blur: 10, x: 0, y: 4, opacity: 0.7 },
  bg: { on: false, color: '#000000', opacity: 0.6, radius: 14, padding: 0.3, mode: 'block' },
  effect: 'none',
  bubble: 'none',
  bubbleColor: '#ffffff',
  highlight: { mode: 'none', color: '#ffd400', bg: '#7c3aed' },
  animIn: { id: 'fade', dur: 0.3, unit: 'whole' },
  animOut: { id: 'fade', dur: 0.25, unit: 'whole' },
  animLoop: { id: 'none', speed: 1 },
};

const NESTED = ['stroke', 'shadow', 'bg', 'highlight', 'animIn', 'animOut', 'animLoop'];
const LEGACY_ANIM = { fade: 'fade', pop: 'pop', slideup: 'slideUp', none: 'none' };
// Merges a clip with the defaults and upgrades text clips saved by older versions.
export function resolveStyle(clip) {
  const s = { ...TEXT_DEFAULTS, ...clip };
  if (clip.stroke === undefined && clip.outline !== undefined) {
    s.stroke = { width: clip.outline ? Math.max(2, Math.round((clip.size || 48) / 20)) : 0, color: '#000000' };
  }
  if (clip.bg === undefined && clip.box) {
    s.bg = { on: true, color: clip.boxColor || '#000000', opacity: 0.7, radius: 6, padding: 0.25, mode: 'block' };
  }
  if (clip.animIn === undefined && clip.anim !== undefined) {
    const id = LEGACY_ANIM[clip.anim] || 'none';
    s.animIn = { id, dur: 0.4 };
    s.animOut = { id: id === 'none' ? 'none' : 'fade', dur: 0.4 };
  }
  if (clip.font === 'arialbd') {
    s.font = 'arial';
    s.bold = true;
  }
  NESTED.forEach((k) => {
    s[k] = { ...TEXT_DEFAULTS[k], ...(s[k] || {}) };
  });
  // Unknown or missing animation units fall back to animating the whole text at once.
  if (!isAnimUnit(s.animIn.unit)) s.animIn.unit = 'whole';
  if (!isAnimUnit(s.animOut.unit)) s.animOut.unit = 'whole';
  return s;
}

