// Generates the `catalog.<kind>.<slug>` keys that src/i18n/catalog.js looks up for the display names of the
// English catalog tables (filters, effects, transitions, LUTs, text templates, animations, blend modes,
// mask shapes, crop aspects, playback quality, transition collections) and writes them, with their English
// text, to shared/i18n/parts/catalog.en.json. The tables themselves stay English (the agent tools and saved
// projects depend on them); merge the part into en.json with scripts/i18n-merge-parts.cjs, then translate.
// Usage: node scripts/i18n-catalog-keys.cjs
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'shared', 'i18n', 'parts', 'catalog.en.json');
const mod = (p) => import(path.join(root, p));

(async () => {
  const [{ catalogKey }, effects, filters, collections, lut, text, anim, visual, cropMath, store] = await Promise.all([
    mod('src/i18n/catalog.js'),
    mod('src/features/effects/effects.js'),
    mod('src/features/effects/filters.js'),
    mod('src/features/effects/collections.js'),
    mod('src/features/effects/lut.js'),
    mod('src/features/text/catalog.js'),
    mod('src/features/timeline/anim.js'),
    mod('src/features/preview/visual.js'),
    mod('src/features/preview/cropMath.js'),
    mod('src/state/store.js'),
  ]);

  const keys = {};
  let clashes = 0;
  const put = (key, english) => {
    if (english === undefined || english === null || english === '') return;
    if (keys[key] !== undefined && keys[key] !== english) {
      clashes++;
      console.error(`clash: ${key} = "${keys[key]}" and "${english}"`);
      return;
    }
    keys[key] = String(english);
  };
  const add = (kind, id, english) => put(catalogKey(kind, id), english);
  const items = (kind, list, idOf = (x) => x.id, nameOf = (x) => x.name) => list.forEach((x) => add(kind, idOf(x), nameOf(x)));
  const texts = (kind, list) => list.forEach((s) => add(kind, s, s));
  const hasLetters = (s) => /[a-z]/i.test(s);

  items('filter', effects.FILTERS);
  texts('filter_cat', filters.FILTER_CATS);
  items('effect', effects.EFFECTS);
  texts('effect_group', effects.EFFECT_GROUPS);
  items('transition', effects.TRANSITIONS);
  texts('direction_group', collections.DIRECTION_GROUPS.map((g) => g.name));
  items('lut', lut.BUNDLED_LUTS, (l) => l.file);
  texts('lut_cat', [...new Set(lut.BUNDLED_LUTS.map((l) => l.cat))]);
  items('text_template', text.TEXT_TEMPLATES);
  texts('text_cat', text.TEMPLATE_CATEGORIES);
  items('bubble', text.BUBBLES);
  items('text_effect', text.TEXT_EFFECTS);
  items('highlight', text.HIGHLIGHTS);
  items('anim_in', text.ANIM_IN);
  items('anim_out', text.ANIM_OUT);
  items('anim_loop', text.ANIM_LOOP);
  for (const kind of Object.keys(anim.ANIMATIONS)) items('animation', anim.ANIMATIONS[kind]);
  texts('animation_cat', [...new Set(Object.values(anim.ANIMATIONS).flat().map((a) => a.cat))]);
  items('blend', visual.BLEND_MODES);
  items('mask_shape', visual.MASK_SHAPES);
  // Ratio labels ('16:9') are the same in every language: only the worded aspects get a key.
  items('crop_aspect', cropMath.CROP_ASPECTS.filter((a) => hasLetters(a.label)), (a) => a.id, (a) => a.label);
  Object.entries(store.QUALITY_LABELS).forEach(([id, label]) => add('quality', id, label));
  items('collection', collections.COLLECTIONS);
  items('pack', collections.PACKS);
  // The transition catalog tiles (135 reference names, the brief's extras and the pack items), by slug.
  items('collection_item', collections.COLLECTION_ITEMS, (e) => e.slug);
  // Composite labels built from a catalog name (src/i18n/catalog.js filterLabel / effectLabel).
  put('catalog.lut_filter', '{name} (LUT)');
  put('catalog.filter_layer', '{name} filter');

  // Sorted, flat JSON like the other parts.
  const sorted = Object.fromEntries(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`);
  const n = Object.keys(sorted).length;
  console.log(`${n} catalog keys -> ${path.relative(root, out)}${clashes ? ` (${clashes} clashes skipped)` : ''}`);
  if (clashes) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
