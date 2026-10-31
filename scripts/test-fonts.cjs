// Your fonts: reading a font's own name, adding font files (once), listing and removing them.
// Usage: node scripts/test-fonts.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const fonts = require('../electron/fonts.cjs');

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const sys = ['arial.ttf', 'georgia.ttf', 'segoeui.ttf'].map((f) => path.join(process.env.WINDIR || 'C:\Windows', 'Fonts', f)).filter((f) => fs.existsSync(f));
assert(sys.length >= 2, 'needs two Windows fonts to test with');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fonts-'));
const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fonts-src-'));
// File names that say nothing: the list must show the font's own name.
const a = path.join(src, 'my_font-file.ttf');
const b = path.join(src, 'other.ttf');
fs.copyFileSync(sys[0], a);
fs.copyFileSync(sys[1], b);
const junk = path.join(src, 'notes.txt');
fs.writeFileSync(junk, 'hello');

assert(fonts.fontName(fs.readFileSync(a)) === 'Arial', `name of arial.ttf: ${fonts.fontName(fs.readFileSync(a))}`);
assert(fonts.fontName(Buffer.from('not a font at all')) === null, 'non-font has no name');

let res = fonts.add(dir, [a, b, junk]);
assert(res.added.length === 2 && res.skipped[0] === 'notes.txt', `add: ${JSON.stringify(res)}`);
res = fonts.add(dir, [a]);
let list = fonts.list(dir);
assert(list.length === 2, `the same file added twice is kept once: ${list.length}`);
assert(list.some((f) => f.name === 'Arial') && list.every((f) => /^custom-[a-z0-9.-]+$/.test(f.id)), `list: ${JSON.stringify(list)}`);
assert(fonts.fileOf(dir, list[0].id) && fonts.fileOf(dir, 'custom-nope') === null, 'fileOf');

// A different file with the same name gets its own copy.
const c = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fonts-c-')), 'my_font-file.ttf');
fs.copyFileSync(sys[1], c);
fonts.add(dir, [c]);
assert(fonts.list(dir).length === 3, 'same name, other font: kept apart');

fonts.remove(dir, list[0].id);
assert(fonts.list(dir).length === 2, 'remove');
console.log(`FONTS OK (${fonts.list(dir).map((f) => f.name).join(', ')})`);
