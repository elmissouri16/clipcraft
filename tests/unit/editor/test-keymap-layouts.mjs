// Shortcuts on every keyboard layout: a non-Latin character typed on a letter or digit key names
// the physical key (Cyrillic, Arabic, Greek, Hebrew), Latin layouts keep their letters (AZERTY),
// AltGr text stays text, and macOS Cmd+Option+S ("ß") is Save As. Usage: node tests/unit/editor/test-keymap-layouts.mjs
import assert from 'node:assert/strict';
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'Macintosh' }, configurable: true });
const { comboFromEvent, actionFor } = await import('../../../src/app/keymap.js');
const ev = (key, code, mods = {}, altGraph = false) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods, getModifierState: (k) => k === 'AltGraph' && altGraph });

for (const [key, code, action] of [['я', 'KeyZ', 'undo'], ['ы', 'KeyS', 'save'], ['с', 'KeyC', 'copy'], ['ئ', 'KeyZ', 'undo'], ['ر', 'KeyV', 'paste'], ['ζ', 'KeyZ', 'undo'], ['ז', 'KeyZ', 'undo']])
  assert.equal(actionFor(ev(key, code, { ctrlKey: true })), action, `${key} on ${code} with Ctrl`);
assert.equal(actionFor(ev('ы', 'KeyS')), 'split', 'a bare non-Latin letter names its key');
assert.equal(comboFromEvent(ev('a', 'KeyQ')), 'A', 'AZERTY keeps its letters');
assert.equal(comboFromEvent(ev('&', 'Digit1')), '1', 'the AZERTY digit row names its digits');
assert.equal(comboFromEvent(ev('ś', 'KeyS', { ctrlKey: true, altKey: true }, true)), 'Ctrl+Alt+Ś', 'AltGr text is not a shortcut');
assert.equal(actionFor(ev('ß', 'KeyS', { metaKey: true, altKey: true })), 'saveAs', 'Cmd+Option+S is Save As on macOS');
assert.equal(comboFromEvent(ev('ö', 'Semicolon')), 'Ö', 'a key that is not a letter or digit key keeps its character');
assert.equal(actionFor(ev('z', 'KeyZ', { ctrlKey: true })), 'undo', 'US layouts are unchanged');
console.log('Shortcuts resolve on non-Latin layouts by physical key; Latin layouts and AltGr text keep their characters');
