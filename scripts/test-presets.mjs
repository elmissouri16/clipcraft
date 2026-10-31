// Custom filter presets: pure store logic (save/replace/apply/delete, sanitising).
import assert from 'assert/strict';
import { loadPresets, savePresets, upsertPreset, removePreset, presetPatch, sanitizePreset } from '../src/fx/presets.js';

const store = { v: null, getItem() { return this.v; }, setItem(k, val) { this.v = val; } };
let list = upsertPreset([], { filter: 'cinematic', filterIntensity: 80, adjust: { brightness: 5 } }, 'My Film');
assert.equal(list.length, 1);
assert.deepEqual(presetPatch(list[0]), { filter: 'cinematic', filterIntensity: 80, adjust: { brightness: 5 } });
list = upsertPreset(list, { filter: 'warm', filterIntensity: 50, adjust: {} }, 'my film'); // same name replaces
assert.equal(list.length, 1); assert.equal(list[0].filter, 'warm');
list = upsertPreset(list, { filter: 'lut:file.cube', filterIntensity: 10, adjust: {} }, 'LUT one');
assert.equal(list.length, 1, 'LUT filters are not stored as presets');
assert.equal(upsertPreset(list, { filter: 'vivid' }, '  ').length, 1, 'blank names rejected');
savePresets(store, list);
const back = loadPresets(store);
assert.equal(back.length, 1); assert.equal(back[0].name, 'my film');
assert.equal(sanitizePreset({ name: 'x', filter: 'vivid', filterIntensity: 250 }).filterIntensity, 100, 'intensity clamped');
assert.equal(removePreset(list, 'my film').length, 0);
store.v = '{broken json';
assert.deepEqual(loadPresets(store), [], 'corrupt storage degrades to empty');
console.log('presets OK');
