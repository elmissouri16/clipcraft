// Favorites file: toggle on/off, newest first, validation, missing files flagged. Usage: node scripts/test-favorites.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fav = require('../electron/favorites.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fav-'));
const real = path.join(dir, 'clip.mp4');
fs.writeFileSync(real, 'x');
// Fixture note: the library item used to be a built-in effect; the built-ins were removed from
// the app, so the fixture is a neutral library sound (the favorites store is provider-agnostic).
const a = { key: 'lib:sfxmint-42', type: 'audio', source: 'library', item: { id: 'sfxmint-42', title: 'Whoosh' } };
const b = { key: `file:${real}`, type: 'video', source: 'file', item: { path: real, name: 'clip.mp4' } };

assert.deepEqual(fav.list(dir), []);
fav.toggle(dir, a);
let l = fav.toggle(dir, b);
assert.deepEqual(l.map((e) => e.key), [b.key, a.key], 'newest first');
assert.equal(l[0].missing, false);
fs.rmSync(real);
assert.equal(fav.list(dir)[0].missing, true, 'moved or deleted files are flagged, not dropped');
l = fav.toggle(dir, a);
assert.deepEqual(l.map((e) => e.key), [b.key], 'a second toggle removes');
assert.throws(() => fav.toggle(dir, { ...a, type: 'exe' }));
assert.throws(() => fav.toggle(dir, { ...b, key: 'file:x', item: { path: 'relative/x.mp4' } }));
assert.throws(() => fav.toggle(dir, { ...a, item: { big: 'x'.repeat(20000) } }));
fs.rmSync(dir, { recursive: true, force: true });
console.log('FAVORITES OK');
