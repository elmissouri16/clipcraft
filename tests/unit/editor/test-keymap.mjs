// Keyboard shortcut keymap: key-press combos, defaults, remapping, conflicts and lookup.
// Usage: node tests/unit/editor/test-keymap.mjs
import assert from 'node:assert/strict';
import { SHORTCUT_ACTIONS, comboFromEvent, validCombo, resolveKeymap, overridesFor, assignCombo, actionFor, setActiveKeymap, comboParts } from '../../../src/app/keymap.js';

const ev = (key, mods = {}, code = '') => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
// Combos from key presses.
assert.equal(comboFromEvent(ev(' ')), 'Space');
assert.equal(comboFromEvent(ev('s')), 'S');
assert.equal(comboFromEvent(ev('S', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+S');
assert.equal(comboFromEvent(ev('ArrowLeft', { shiftKey: true })), 'Shift+ArrowLeft');
assert.equal(comboFromEvent(ev('Control', { ctrlKey: true })), null, 'a bare modifier is not a combo');
assert.equal(comboFromEvent(ev('Dead', {}, 'KeyQ')), 'Q', 'unidentified keys fall back to the physical code');
assert.equal(comboFromEvent(ev('+', { ctrlKey: true })), 'Ctrl++');
assert.ok(validCombo('Ctrl+Alt+S') && validCombo('Ctrl++') && validCombo('F') && !validCombo('Ctrl+') && !validCombo('Shift') && !validCombo('a b'));

// Defaults: every action has keys, no key is shared.
const defaults = resolveKeymap();
const all = Object.values(defaults).flat();
assert.equal(new Set(all).size, all.length, 'default keys are unique');
assert.deepEqual(defaults.split, ['S', 'Ctrl+B']);
assert.deepEqual(overridesFor(defaults), {}, 'defaults store nothing');

// Overrides: unknown actions and invalid combos ignored; a combo keeps its first owner.
const custom = resolveKeymap({ split: ['K'], nope: ['J'], duplicate: ['K', 'Ctrl+'] });
assert.deepEqual(custom.split, ['K']); assert.deepEqual(custom.duplicate, [], 'K already belongs to split; the invalid combo is dropped');
assert.ok(!('nope' in custom));

// Assigning a used key moves it and reports where from.
const moved = assignCombo(defaults, 'split', 'Ctrl+D');
assert.equal(moved.movedFrom, 'duplicate'); assert.deepEqual(moved.map.duplicate, []); assert.deepEqual(moved.map.split, ['S', 'Ctrl+B', 'Ctrl+D']);
assert.deepEqual(overridesFor(moved.map), { split: ['S', 'Ctrl+B', 'Ctrl+D'], duplicate: [] });
assert.equal(assignCombo(defaults, 'split', 'Ctrl+').map, defaults, 'invalid combos change nothing');

// The shared active keymap drives lookups.
setActiveKeymap({});
assert.equal(actionFor(ev('s')), 'split'); assert.equal(actionFor(ev('Z', { ctrlKey: true, shiftKey: true })), 'redo'); assert.equal(actionFor(ev('f')), 'fullscreen');
setActiveKeymap({ split: ['K'], fullscreen: ['G'] });
assert.equal(actionFor(ev('k')), 'split'); assert.equal(actionFor(ev('s')), null, 'the old key no longer splits');
assert.equal(actionFor(ev('g')), 'fullscreen'); assert.equal(actionFor(ev('f')), null);
setActiveKeymap({});

assert.deepEqual(comboParts('Shift+ArrowLeft'), ['Shift', '←']);
assert.ok(SHORTCUT_ACTIONS.every(a => a.label && a.group && a.keys.every(validCombo)));
console.log('keymap ok: combos, defaults, overrides, conflicts, active lookup');
