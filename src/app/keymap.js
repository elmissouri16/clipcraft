// Editor keyboard shortcuts: the actions, their default keys, and the user's
// remapping (stored in settings.json through the main process). The editor's
// key handlers ask `actionFor(event)` instead of hard-coding keys.
//
// A combo is a string like "Ctrl+Shift+S": modifiers in the order Ctrl, Alt,
// Shift, then one key ("A"–"Z", "0"–"9", "Space", "ArrowLeft", "Delete"…).
// On macOS, Cmd counts as Ctrl so the usual Mac keys work too.
import { t } from '../i18n/index.js';

// The group names are also the headings of the Shortcuts settings, so they are translated once here.
const GROUP = { playback: t('keymap.playback'), editing: t('keymap.editing'), tools: t('keymap.tools'), file: t('keymap.file') };
export const SHORTCUT_GROUPS = [GROUP.playback, GROUP.editing, GROUP.tools, GROUP.file];

export const SHORTCUT_ACTIONS = [
  { id: 'togglePlay', label: t('keymap.play_pause'), group: GROUP.playback, keys: ['Space'] },
  { id: 'stepBack', label: t('keymap.previous_frame'), group: GROUP.playback, keys: ['ArrowLeft'] },
  { id: 'stepForward', label: t('keymap.next_frame'), group: GROUP.playback, keys: ['ArrowRight'] },
  { id: 'jumpBack', label: t('keymap.back_1_second'), group: GROUP.playback, keys: ['Shift+ArrowLeft'] },
  { id: 'jumpForward', label: t('keymap.forward_1_second'), group: GROUP.playback, keys: ['Shift+ArrowRight'] },
  { id: 'goStart', label: t('keymap.go_to_start'), group: GROUP.playback, keys: ['Home'] },
  { id: 'fullscreen', label: t('keymap.full_screen_player'), group: GROUP.playback, keys: ['F'] },
  { id: 'split', label: t('keymap.split_at_playhead'), group: GROUP.editing, keys: ['S', 'Ctrl+B'] },
  { id: 'duplicate', label: t('keymap.duplicate'), group: GROUP.editing, keys: ['Ctrl+D'] },
  { id: 'delete', label: t('keymap.delete'), group: GROUP.editing, keys: ['Delete', 'Backspace'] },
  { id: 'trimLeft', label: t('keymap.delete_left_of_playhead'), group: GROUP.editing, keys: ['Q'] },
  { id: 'trimRight', label: t('keymap.delete_right_of_playhead'), group: GROUP.editing, keys: ['W'] },
  { id: 'marker', label: t('keymap.marker_at_playhead'), group: GROUP.editing, keys: ['M'] },
  { id: 'copy', label: t('keymap.copy'), group: GROUP.editing, keys: ['Ctrl+C'] },
  { id: 'cut', label: t('keymap.cut'), group: GROUP.editing, keys: ['Ctrl+X'] },
  { id: 'paste', label: t('keymap.paste'), group: GROUP.editing, keys: ['Ctrl+V'] },
  { id: 'extractAudio', label: t('keymap.extract_audio'), group: GROUP.editing, keys: ['Ctrl+Shift+S'] },
  { id: 'undo', label: t('keymap.undo'), group: GROUP.editing, keys: ['Ctrl+Z'] },
  { id: 'redo', label: t('keymap.redo'), group: GROUP.editing, keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'razorTool', label: t('keymap.razor_tool'), group: GROUP.tools, keys: ['B'] },
  { id: 'selectTool', label: t('keymap.select_tool'), group: GROUP.tools, keys: ['V', 'Escape'] },
  { id: 'save', label: t('close.save'), group: GROUP.file, keys: ['Ctrl+S'] },
  { id: 'saveAs', label: t('keymap.save_as'), group: GROUP.file, keys: ['Ctrl+Alt+S'] },
];
// Shortcuts that also work while typing in a field.
export const WORKS_IN_FIELDS = new Set(['save', 'saveAs']);
// Mouse gestures shown for reference; they are not remappable.
export const FIXED_GESTURES = [{ label: t('keymap.zoom_the_timeline'), keys: t('keymap.ctrl_mouse_wheel') }];

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS']);
const NAMED = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Del: 'Delete', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };

// The combo a key press represents, or null for a bare modifier.
export function comboFromEvent(e) {
  if (!e || MODIFIER_KEYS.has(e.key)) return null;
  let key = NAMED[e.key] || e.key;
  if (!key || key === 'Unidentified' || key === 'Dead') {
    const code = e.code || '';
    key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : code;
  }
  if (!key) return null;
  if (key.length === 1) key = key.toUpperCase();
  const ctrl = e.ctrlKey || (isMac() && e.metaKey);
  return [ctrl && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

const VALID = /^(Ctrl\+)?(Alt\+)?(Shift\+)?[^+\s]+$|^(Ctrl\+)?(Alt\+)?(Shift\+)?\+$/;
export const validCombo = combo => typeof combo === 'string' && combo.length <= 40 && VALID.test(combo) && !MODIFIER_KEYS.has(combo.split('+').at(-1));

// Defaults merged with the user's overrides ({ actionId: [combos] }); unknown
// actions and invalid combos are ignored, and a combo belongs to one action.
export function resolveKeymap(overrides = {}) {
  const map = {};
  for (const a of SHORTCUT_ACTIONS) map[a.id] = Array.isArray(overrides?.[a.id]) ? overrides[a.id].filter(validCombo).slice(0, 4) : [...a.keys];
  const owner = new Map();
  for (const a of SHORTCUT_ACTIONS) map[a.id] = map[a.id].filter(c => !owner.has(c) && owner.set(c, a.id));
  return map;
}

// Only the actions that differ from their defaults are stored.
export function overridesFor(map) {
  const out = {};
  for (const a of SHORTCUT_ACTIONS) if (JSON.stringify(map[a.id] || []) !== JSON.stringify(a.keys)) out[a.id] = [...(map[a.id] || [])];
  return out;
}

// Assign a combo to an action, taking it from whichever action had it.
// Returns { map, movedFrom } (movedFrom: the action id that lost the combo).
export function assignCombo(map, actionId, combo) {
  if (!validCombo(combo)) return { map, movedFrom: null };
  let movedFrom = null;
  const next = {};
  for (const [id, combos] of Object.entries(map)) {
    if (id !== actionId && combos.includes(combo)) movedFrom = id;
    next[id] = id === actionId ? combos : combos.filter(c => c !== combo);
  }
  if (!next[actionId].includes(combo)) next[actionId] = [...next[actionId], combo].slice(-4);
  return { map: next, movedFrom };
}

// Shared active keymap so every key handler sees the same mapping.
let active = resolveKeymap();
let lookup = null;
export function setActiveKeymap(overrides) { active = resolveKeymap(overrides); lookup = null; return active; }
export const activeKeymap = () => active;
export function actionFor(e, map = active) {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  if (map === active) {
    lookup ||= new Map(Object.entries(active).flatMap(([id, combos]) => combos.map(c => [c, id])));
    return lookup.get(combo) || null;
  }
  for (const [id, combos] of Object.entries(map)) if (combos.includes(combo)) return id;
  return null;
}

// Display form: "Ctrl+Shift+S" → ["Ctrl", "Shift", "S"], with arrow glyphs.
const GLYPH = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
export const comboParts = combo => (combo === '+' ? ['+'] : combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+'))
  .map(part => part === 'Ctrl' && isMac() ? '⌘' : GLYPH[part] || part);

// Tooltip text with the current keys: label("Split at playhead", "split") →
// "Split at playhead (S / Ctrl+B)". Unbound actions show the plain label.
const FRIENDLY = { Delete: 'Del', Escape: 'Esc' };
export function shortcutHint(id, map = active) {
  const combos = (map[id] || []).slice(0, 2);
  return combos.map(c => comboParts(c).map(p => FRIENDLY[p] || p).join('+').replace('⌘+', '⌘')).join(' / ');
}
export const withShortcut = (text, id, map = active) => { const hint = shortcutHint(id, map); return hint ? t('keymap.label_with_keys', { label: text, keys: hint }) : text; };
