// Text templates: the bundled catalog stays valid (unique ids, every referenced
// effect/bubble/animation/highlight exists), including the 12 Material-inspired additions.
import assert from 'node:assert/strict';
import {
  TEXT_TEMPLATES, TEXT_EFFECTS, BUBBLES, ANIM_IN, ANIM_OUT, ANIM_LOOP, HIGHLIGHTS, TEMPLATE_CATEGORIES,
} from '../src/text/catalog.js';

const ids = TEXT_TEMPLATES.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length, 'template ids are unique');
const mat = TEXT_TEMPLATES.filter((t) => t.id.startsWith('mat-'));
assert.equal(mat.length, 12, `expected 12 Material templates, got ${mat.length}`);
assert.ok(TEMPLATE_CATEGORIES.includes('Material'), 'Material is a browse category');
for (const t of mat) assert.ok(t.tags.includes('Material'), `${t.id} is tagged Material`);

const inIds = new Set(ANIM_IN.map((a) => a.id));
const outIds = new Set(ANIM_OUT.map((a) => a.id));
const loopIds = new Set(ANIM_LOOP.map((a) => a.id));
const fxIds = new Set(TEXT_EFFECTS.map((e) => e.id));
const bubbleIds = new Set(BUBBLES.map((b) => b.id));
const hlIds = new Set(HIGHLIGHTS.map((h) => h.id));
for (const t of TEXT_TEMPLATES) {
  const p = t.patch;
  assert.ok(p && typeof p.font === 'string' && p.font, `${t.id} sets a font`);
  assert.ok(fxIds.has(p.effect ?? 'none'), `${t.id} effect exists`);
  assert.ok(bubbleIds.has(p.bubble ?? 'none'), `${t.id} bubble exists`);
  if (p.animIn) assert.ok(inIds.has(p.animIn.id), `${t.id} animIn ${p.animIn.id} exists`);
  if (p.animOut) assert.ok(outIds.has(p.animOut.id), `${t.id} animOut ${p.animOut.id} exists`);
  if (p.animLoop) assert.ok(loopIds.has(p.animLoop.id), `${t.id} animLoop exists`);
  if (p.highlight) assert.ok(hlIds.has(p.highlight.mode), `${t.id} highlight mode exists`);
}
console.log(`text-templates ok (${TEXT_TEMPLATES.length} templates, ${mat.length} Material, all references valid)`);
