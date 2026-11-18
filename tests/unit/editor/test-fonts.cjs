// Your fonts: reading a font's own name, adding font files (once), listing and removing them.
// Usage: node tests/unit/editor/test-fonts.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const fonts = require("../../../electron/export/fonts.cjs");

const assert = (ok, what) => { if (!ok) throw new Error(what); };
// Known family names are independent expectations, not values read from the
// implementation. Use real local SFNT files without distributing OS font bytes.
const pairs = [
  [[path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'), 'Arial'], [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'georgia.ttf'), 'Georgia']],
  [['/System/Library/Fonts/Supplemental/Arial.ttf', 'Arial'], ['/System/Library/Fonts/Supplemental/Georgia.ttf', 'Georgia']],
  [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'], ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 'DejaVu Serif']],
];
const pair = pairs.find(entries => entries.every(([file]) => fs.existsSync(file)));
assert(pair, 'Needs a local Arial/Georgia or DejaVu Sans/Serif pair; no font-name assertion is skipped.');
const sys = pair.map(([file]) => file), expectedName = pair[0][1];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fonts-'));
const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fonts-src-'));
// File names that say nothing: the list must show the font's own name.
const a = path.join(src, 'my_font-file.ttf');
const b = path.join(src, 'other.ttf');
fs.copyFileSync(sys[0], a);
fs.copyFileSync(sys[1], b);
const junk = path.join(src, 'notes.txt');
fs.writeFileSync(junk, 'hello');

assert(fonts.fontName(fs.readFileSync(a)) === expectedName, `expected ${expectedName}: ${fonts.fontName(fs.readFileSync(a))}`);
assert(fonts.fontName(Buffer.from('not a font at all')) === null, 'non-font has no name');

let res = fonts.add(dir, [a, b, junk]);
assert(res.added.length === 2 && res.skipped[0] === 'notes.txt', `add: ${JSON.stringify(res)}`);
res = fonts.add(dir, [a]);
let list = fonts.list(dir);
assert(list.length === 2, `the same file added twice is kept once: ${list.length}`);
assert(list.some((f) => f.name === expectedName) && list.some((f) => f.name === pair[1][1]) && list.every((f) => /^custom-[a-z0-9.-]+$/.test(f.id)), `list: ${JSON.stringify(list)}`);
assert(fonts.fileOf(dir, list[0].id) && fonts.fileOf(dir, 'custom-nope') === null, 'fileOf');

// A different file with the same name gets its own copy.
const c = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fonts-c-')), 'my_font-file.ttf');
fs.copyFileSync(sys[1], c);
fonts.add(dir, [c]);
assert(fonts.list(dir).length === 3, 'same name, other font: kept apart');

fonts.remove(dir, list[0].id);
assert(fonts.list(dir).length === 2, 'remove');
console.log(`FONTS OK (${fonts.list(dir).map((f) => f.name).join(', ')})`);
