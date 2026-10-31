// Catalog-135 mapping: every uploaded catalog entry resolves to a real engine transition.
// Usage: node scripts/test-catalog135.mjs
import assert from 'assert/strict';
import { CATALOG135, CATALOG_FAMILIES, ENGINE_TRANSITION_IDS } from '../src/fx/catalog135.js';
import { TRANSITIONS } from '../src/effects.js';

assert.equal(CATALOG135.length, 135, 'exactly 135 catalog entries');
assert.equal(new Set(CATALOG135.map((e) => e.slug)).size, 135, 'slugs are unique');
assert.equal(CATALOG_FAMILIES.length, 8, '8 families');
const engine = new Set(ENGINE_TRANSITION_IDS);
assert.equal(engine.size, TRANSITIONS.length, 'engine id list matches TRANSITIONS');
for (const e of CATALOG135) {
  assert.ok(engine.has(e.engineId), `${e.slug} maps to existing engine id (${e.engineId})`);
  assert.ok(e.status === 'implemented' || e.status === 'adapted', `${e.slug} has a status`);
  assert.ok(e.name && e.family && e.behavior, `${e.slug} keeps the reference fields`);
  assert.ok(e.duration > 0, `${e.slug} has a usable default duration`);
}
const impl = CATALOG135.filter((e) => e.status === 'implemented').length;
console.log(`catalog135 OK: 135 entries, ${impl} implemented, ${CATALOG135.length - impl} adapted, engine ids: ${engine.size}`);

// --- Stage 1: Hamza's 10 collections + §A name coverage + direction groups + favourites ---
import { COLLECTIONS, COLLECTION_ITEMS, collectionItems, directionGroupFor, DIRECTION_GROUPS, toggleFavorite, loadFavorites, saveFavorites } from '../src/fx/collections.js';
assert.equal(COLLECTIONS.length, 10, 'exactly 10 collections');
assert.ok(COLLECTION_ITEMS.length >= 135, 'collection layer covers the catalog plus §A extras');
for (const c of COLLECTIONS) assert.ok(collectionItems(c.id).length > 0, `collection ${c.id} is not empty`);
for (const e of COLLECTION_ITEMS) {
  assert.ok(engine.has(e.engineId), `collection item ${e.slug} maps to a real engine id`);
  assert.ok(COLLECTIONS.some((c) => c.id === e.collection), `${e.slug} has a valid collection`);
}
// Every transition named in the §A brief is present, in its collection, implemented or adapted.
const SECTION_A = {
  basic: ['Cross Dissolve', 'Fade', 'Dip to Black', 'Dip to White', 'Film Dissolve'],
  zoom: ['Zoom In', 'Zoom Out', 'Zoom Blur', 'Whip Zoom', 'Radial Zoom', 'Punch Zoom'],
  slide: ['Slide Left', 'Slide Right', 'Slide Up', 'Slide Down', 'Push', 'Split Slide', 'Diagonal Slide'],
  '3d': ['Cube', 'Flip', 'Page Turn', 'Spin', 'Perspective Rotate'],
  glitch: ['RGB Split', 'Digital Glitch', 'VHS Glitch', 'Pixel Glitch', 'Signal Distortion'],
  blur: ['Motion Blur', 'Directional Blur', 'Radial Blur', 'Defocus'],
  light: ['Flash', 'Light Leak', 'Film Burn', 'Lens Flare', 'Light Sweep'],
  wipe: ['Linear Wipe', 'Radial Wipe', 'Circular Wipe', 'Iris', 'Diamond', 'Star', 'Gradient Wipe'],
  creative: ['Shake', 'Beat Flash', 'Beat Zoom', 'Spin', 'Warp', 'Liquid', 'Mirror'],
  vintage: ['Super 8', 'Film Reel', 'Analog Flash', 'Projector Flicker'],
};
const byName = (n) => COLLECTION_ITEMS.filter((e) => e.name.toLowerCase() === n.toLowerCase());
for (const [coll, names] of Object.entries(SECTION_A)) {
  for (const n of names) {
    const hits = byName(n);
    assert.ok(hits.length >= 1, `§A transition "${n}" is present`);
    assert.ok(hits.some((e) => e.collection === coll || (n === 'Spin' && (e.collection === '3d' || e.collection === 'creative'))), `§A transition "${n}" sits in ${coll} (got ${hits.map((h) => h.collection).join(',')})`);
    assert.ok(hits.every((e) => e.status === 'implemented' || e.status === 'adapted'), `"${n}" is implemented or adapted`);
  }
}
// Direction groups reference real engine ids and resolve both ways.
for (const g of DIRECTION_GROUPS) for (const id of Object.values(g.ids)) assert.ok(engine.has(id), `direction variant ${id} exists`);
assert.equal(directionGroupFor('wipeleft').dir, 'left');
assert.equal(directionGroupFor('fx_slidedown').group.name, 'Slide');
assert.equal(directionGroupFor('dissolve'), null, 'non-directional transitions have no direction control');
// Favourites toggle/save/load round-trip on a fake storage.
const store = { v: null, getItem() { return this.v; }, setItem(k, val) { this.v = val; } };
let fav = toggleFavorite(new Set(), 'cross-dissolve');
assert.ok(fav.has('cross-dissolve'));
fav = toggleFavorite(fav, 'cross-dissolve');
assert.ok(!fav.has('cross-dissolve'));
saveFavorites(store, new Set(['fade', 'xa-zoom-in']));
assert.deepEqual([...loadFavorites(store)].sort(), ['fade', 'xa-zoom-in']);
console.log('collections OK: 10 collections, all §A names covered, direction groups valid, favourites round-trip');
