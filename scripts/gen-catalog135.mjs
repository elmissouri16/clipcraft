// Generates src/fx/catalog135.json from the uploaded transition catalog reference
// (135 transitions in 8 families). Usage: node scripts/gen-catalog135.mjs [source.json]
// The output keeps every field of the reference (name, family, behaviour, best-for,
// priority, controls, scope) plus a stable slug used by src/fx/catalog135.js.
import fs from 'fs';

const src = process.argv[2] || new URL('../../user/files/transition_catalog.json', `file://${process.env.HOME}/workspace/clipcraft-v2/scripts/`).pathname;
const raw = JSON.parse(fs.readFileSync(process.env.CATALOG135_SRC || '/home/hatch/workspace/user/files/transition_catalog.json', 'utf8'));
const items = raw.transitions || raw;

export const slugify = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const seen = new Set();
const out = items.map((t) => {
  let slug = slugify(t.transition_name);
  if (seen.has(slug)) slug = `${slug}-${seen.size}`;
  seen.add(slug);
  return {
    slug,
    name: t.transition_name,
    family: t.family,
    behavior: t.visual_behavior,
    bestFor: t.best_for,
    priority: t.recommended_priority,
    controls: t.customizable_controls,
    referenceScope: t.reference_scope,
  };
});
fs.writeFileSync(new URL('../src/fx/catalog135.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`catalog135.json: ${out.length} entries, ${seen.size} unique slugs`);
