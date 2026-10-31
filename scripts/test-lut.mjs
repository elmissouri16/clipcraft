// LUT parser: 3D sizes 17/33/65, 1D conversion, invalid files; imported-library store.
import assert from 'assert/strict';
import { parseCube } from '../src/fx/lut.js';
import { loadLutLibrary, saveLutLibrary, addLutEntry, removeLutEntry } from '../src/fx/lutlib.js';

const cube3d = (size, fn) => {
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(fn(r, g, b));
  return lines.join('\n');
};
for (const size of [17, 33, 65]) {
  const lut = parseCube(cube3d(size, (r, g, b) => `${(r / (size - 1)).toFixed(4)} ${(g / (size - 1)).toFixed(4)} ${(b / (size - 1)).toFixed(4)}`));
  assert.equal(lut.size, size);
  assert.equal(lut.data.length, size * size * size * 4);
}
// Identity 17^3: corner (r=16,g=0,b=0) in texture layout (row g, column b*size + r).
const id17 = parseCube(cube3d(17, (r, g, b) => `${(r / 16).toFixed(4)} ${(g / 16).toFixed(4)} ${(b / 16).toFixed(4)}`));
assert.equal(id17.data[(0 * 17 * 17 + 0 * 17 + 16) * 4], 255, 'identity LUT keeps red at full');
// 1D: invert curve converts to a 17^3 grid whose red channel runs backwards.
const inv1d = ['LUT_1D_SIZE 4', '1 0 0', '0.66 0.33 0.33', '0.33 0.66 0.66', '0 1 1'].join('\n');
const from1d = parseCube(inv1d);
assert.equal(from1d.size, 17); assert.equal(from1d.from1d, true);
assert.equal(from1d.data[0], 255, '1D curve start applies (r=0 -> inverted 255)');
assert.equal(from1d.data[16 * 4], 0, '1D curve end applies (r=16 -> inverted 0)');
// Invalid files fail with clear errors.
assert.throws(() => parseCube('TITLE "x"\n0 0 0\n'), /no LUT_3D_SIZE/);
assert.throws(() => parseCube('LUT_3D_SIZE 17\n0 0 0\n'), /incomplete/);
assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0\n'), /incomplete/);
assert.throws(() => parseCube('LUT_3D_SIZE 1\n0 0 0\n'), /no LUT_3D_SIZE/);
// Library store round-trip.
const store = { v: null, getItem() { return this.v; }, setItem(k, val) { this.v = val; } };
let lib = addLutEntry([], { name: 'Teal', path: '/luts/teal.cube' });
lib = addLutEntry(lib, { path: '/luts/teal.cube' }); // dedupe by path
assert.equal(lib.length, 1);
lib = addLutEntry(lib, { path: 'C:\\luts\\night.cube' });
assert.equal(lib[1].name, 'night', 'name derived from file name');
saveLutLibrary(store, lib);
assert.equal(loadLutLibrary(store).length, 2);
assert.equal(removeLutEntry(lib, '/luts/teal.cube').length, 1);
console.log('lut OK: 17/33/65 parse, 1D converted, invalid rejected, library round-trip');
