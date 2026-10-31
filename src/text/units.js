// Animation units for text In / Out animations: a preset's motion can play on the whole text at once
// ('whole', the original behaviour), staggered word by word ('word'), or letter by letter ('char').
// This module is the single definition of the stagger math — pure, so the node test suites can import
// it directly — and src/text/render.js applies it in the one renderer the preview and export share.
//
// Stagger formula: with n units and global progress p in [0,1], each unit owns a window of
// UNIT_WINDOW (0.62) of the progress span; unit i's window starts at i * step, where
// step = (1 - UNIT_WINDOW) / (n - 1). So unit 0 starts exactly at p = 0, the last unit's window ends
// exactly at p = 1 (it never overruns the animation's duration), start times are strictly increasing,
// and neighbouring units overlap by ~38% of a window — the cascade feel of the reference preset packs.
// Exits mirror entrances: unit 0 still leads (its local progress peels away first), so a word-by-word
// Slide Out empties the line in reading order instead of vanishing all at once.

export const ANIM_UNITS = ['whole', 'word', 'char'];
export const UNIT_WINDOW = 0.62;

export const isAnimUnit = (u) => ANIM_UNITS.includes(u);

// Renderer ids that already animate per unit on their own (typewriter reveals per character, the word
// presets stagger per word, the wave rides per character). A unit choice makes no sense for them — the
// renderer ignores it and the browser disables the unit control while one is active.
export const INHERENT_UNIT_ANIMS = new Set(['typewriter', 'wordPop', 'wordRise', 'waveIn', 'charSlideUp', 'charSlideDown', 'charFade', 'decode']);

// Local progress of unit i (of n) at the slot's global progress p. `out` mirrors the offsets so the
// first unit in reading order also leaves first while p runs 1 -> 0.
export function unitProgress(p, i, n, out = false) {
  const c = Math.max(0, Math.min(1, p));
  if (n <= 1) return c;
  const step = (1 - UNIT_WINDOW) / (n - 1);
  const off = (out ? n - 1 - i : i) * step;
  return Math.max(0, Math.min(1, (c - off) / UNIT_WINDOW));
}

// The unit a slot actually animates with. Letters are only ever split inside a word and Arabic (and
// other RTL) text is never split into characters — joined script would break — so 'char' on RTL text
// degrades to 'word', where every unit is still a whole, correctly shaped word.
export function effectiveUnit(unit, rtl) {
  if (!isAnimUnit(unit) || unit === 'whole') return 'whole';
  if (unit === 'char' && rtl) return 'word';
  return unit;
}
