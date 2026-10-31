// Text Animations library (src/fx/textAnim.js): catalogue integrity, the named slides Hamza asked for,
// and proof that every preset names a motion the shared text renderer (src/text/render.js) implements —
// the renderer is the single source of motion for the player AND the export, so a preset that resolves
// here cannot be a dead tile. Behavioural export proof lives in scripts/test-textanim-export.cjs.
// Usage: node scripts/test-textanim.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { TEXT_ANIMS_IN, TEXT_ANIMS_OUT, TEXT_ANIM_CATEGORIES, textAnimPresets, textAnimCategories } from '../src/fx/textAnim.js';
import { ANIM_IN, ANIM_OUT } from '../src/text/catalog.js';
import { ANIMATIONS, previewState } from '../src/anim.js';
import { ANIM_UNITS, INHERENT_UNIT_ANIMS, UNIT_WINDOW, effectiveUnit, isAnimUnit, unitProgress } from '../src/text/units.js';

const renderSrc = fs.readFileSync(new URL('../src/text/render.js', import.meta.url), 'utf8');
const animStateSrc = renderSrc.slice(renderSrc.indexOf('function animState'), renderSrc.indexOf('function loopState'));
assert.ok(animStateSrc.includes('switch'), 'animState located in render.js');

for (const [kind, presets, catalogue] of [['in', TEXT_ANIMS_IN, ANIM_IN], ['out', TEXT_ANIMS_OUT, ANIM_OUT]]) {
  const names = presets.map((p) => p.name);
  const anims = presets.map((p) => p.anim);
  assert.equal(new Set(names).size, names.length, `${kind}: preset names are unique`);
  assert.equal(new Set(anims).size, anims.length, `${kind}: renderer ids are unique per section`);
  assert.ok(presets.length >= 24, `${kind}: at least 24 presets (got ${presets.length})`);
  const validIds = new Set(catalogue.map((a) => a.id));
  for (const p of presets) {
    assert.ok(TEXT_ANIM_CATEGORIES.includes(p.cat), `${kind}: ${p.name} has a known category (${p.cat})`);
    assert.ok(validIds.has(p.anim), `${kind}: ${p.name} -> ${p.anim} is registered in the text catalogue`);
    assert.ok(p.anim !== 'none', `${kind}: ${p.name} is a real motion`);
    assert.ok(p.dur >= 0.2 && p.dur <= 2, `${kind}: ${p.name} duration ${p.dur}s is sane`);
    assert.ok(animStateSrc.includes(`case '${p.anim}'`), `${kind}: ${p.name} -> renderer implements '${p.anim}'`);
  }
  // Every declared category is used, and the categories the browser shows match the data.
  assert.deepEqual(textAnimCategories(kind), TEXT_ANIM_CATEGORIES, `${kind}: all categories populated`);
  assert.equal(textAnimPresets(kind), presets, `${kind}: accessor returns the section`);
}

// The five slides Hamza named, first-class in both sections. The smooth family now leads the whole
// browser in its own 'Smooth' category (added at his Mister Horse-gallery request), so the named
// slides live across Slide + Smooth; 'Slide Up Smooth' is the very first preset of each section.
assert.equal(TEXT_ANIM_CATEGORIES[0], 'Smooth', 'Smooth leads the category list');
for (const [kind, presets] of [['in', TEXT_ANIMS_IN], ['out', TEXT_ANIMS_OUT]]) {
  const slides = presets.filter((p) => p.cat === 'Slide' || p.cat === 'Smooth').map((p) => p.name);
  for (const name of ['Slide Up Smooth', 'Slide Up', 'Slide Down', 'Slide Left', 'Slide Right']) {
    assert.ok(slides.includes(name), `${kind}: Slide+Smooth categories have "${name}"`);
  }
  const smooth = presets.filter((p) => p.cat === 'Smooth').map((p) => p.name);
  assert.ok(smooth.length >= 10, `${kind}: Smooth category is deep (${smooth.length})`);
  for (const name of ['Fade Up', 'Fade Down', 'Fade Left', 'Fade Right', 'Glide Up', 'Chars Slide Up']) {
    assert.ok(smooth.includes(name), `${kind}: Smooth has "${name}"`);
  }
  assert.equal(presets[0].name, 'Slide Up Smooth', `${kind}: Slide Up Smooth is the first preset`);
  assert.ok(presets.some((p) => p.anim === 'decode' && p.name === 'Decode & Fade'), `${kind}: Decode & Fade present`);
  assert.ok(presets.some((p) => p.anim === 'charFade'), `${kind}: per-char fade present`);
  assert.ok(presets.some((p) => p.anim === 'scaleTrack'), `${kind}: scale+tracking present`);
  assert.ok(presets.some((p) => p.anim === 'settleUp'), `${kind}: overshoot settle present`);
}
// Decode is a genuine glyph scramble, not a fade in disguise: the renderer substitutes glyphs from a
// charset, cycling with the quantized progress (deterministic => identical in preview and export).
assert.ok(renderSrc.includes('DECODE_GLYPHS') && renderSrc.includes('stepN'), 'decode cycles substitute glyphs per frame');
for (const id of ['charSlideUp', 'charSlideDown', 'charFade', 'decode']) {
  assert.ok(INHERENT_UNIT_ANIMS.has(id), `${id} is an inherent per-unit animation`);
}

// New engine pieces the library leans on: smooth easing, elastic easing and the letter-tracking channel.
assert.ok(renderSrc.includes('easeInOut') && renderSrc.includes('easeOutElastic'), 'renderer has smooth + elastic easings');
assert.ok(animStateSrc.includes("case 'trackingIn'") && animStateSrc.includes('s.ls'), 'tracking animates letter spacing');
assert.ok(renderSrc.includes('A.ls') && renderSrc.includes('letterSpacing'), 'tracking reaches the layout');

// Picture clips (video / overlay) share the same In / Out model: the smooth slides exist there too, and
// their preview math starts displaced + transparent and lands exactly at rest.
for (const id of ['slide_up_smooth', 'slide_down_smooth', 'slide_left_smooth', 'slide_right_smooth']) {
  assert.ok(ANIMATIONS.in.some((a) => a.id === id), `picture In has ${id}`);
  assert.ok(ANIMATIONS.out.some((a) => a.id === `${id}_out`), `picture Out has ${id}_out`);
}
const start = previewState('in', 'slide_up_smooth', 0);
assert.ok(start.y > 0.3 && start.o < 0.1, `smooth slide starts below + transparent (y=${start.y}, o=${start.o})`);
const mid = previewState('in', 'slide_up_smooth', 0.5);
assert.ok(mid.y > 0.05 && mid.y < start.y, 'smooth slide is mid-glide at half time');
const rest = previewState('in', 'slide_up_smooth', 1);
assert.ok(Math.abs(rest.y) < 1e-9 && rest.o === 1, 'smooth slide lands at rest');

console.log(`textanim ok (${TEXT_ANIMS_IN.length} in + ${TEXT_ANIMS_OUT.length} out presets, ${TEXT_ANIM_CATEGORIES.length} categories)`);

// ---------- Animation units: Whole text / Word by word / Letters (src/text/units.js) ----------
// The stagger behind Hamza's "select word by word": unit i of n owns a UNIT_WINDOW slice of the
// progress span, starting at i * (1 - UNIT_WINDOW) / (n - 1) — first unit starts at 0, last unit ends
// exactly at p = 1, so staggering never stretches the animation past its duration.
const near = (a, b) => Math.abs(a - b) < 1e-9;
for (const n of [2, 3, 5, 12]) {
  assert.equal(unitProgress(0, 0, n, false), 0, `n=${n}: first unit starts at 0`);
  let prevStart = -1;
  for (let i = 0; i < n; i++) {
    const start = (i * (1 - UNIT_WINDOW)) / (n - 1);
    assert.ok(start > prevStart, `n=${n}: unit ${i} starts after unit ${i - 1}`);
    prevStart = start;
    assert.ok(near(unitProgress(start, i, n, false), 0), `n=${n}: unit ${i} is at 0 at its start`);
    assert.ok(unitProgress(start + 0.01, i, n, false) > 0, `n=${n}: unit ${i} is moving just after its start`);
    assert.ok(unitProgress(1, i, n, false) > 0.999999, `n=${n}: unit ${i} is complete at p=1 (no overrun)`);
  }
  assert.ok(unitProgress(1 - 1e-6, n - 1, n, false) < 1, `n=${n}: last unit still moving just before p=1`);
  let last = -1;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const v = unitProgress(Math.min(1, p), 1, n, false);
    assert.ok(v >= last, `n=${n}: unit progress is monotonic in p`);
    last = v;
  }
  // Exits mirror entrances: every unit is fully shown at p=1, unit 0 has left first mid-exit.
  for (let i = 0; i < n; i++) assert.ok(unitProgress(1, i, n, true) > 0.999999, `n=${n}: unit ${i} shown at exit start`);
  assert.equal(unitProgress(0, n - 1, n, true), 0, `n=${n}: last unit finishes the exit at p=0`);
  assert.ok(unitProgress(0.5, 0, n, true) < unitProgress(0.5, n - 1, n, true), `n=${n}: first word leaves first`);
}
// One unit is just the global progress, in either direction.
assert.ok(near(unitProgress(0.3, 0, 1, false), 0.3) && near(unitProgress(0.3, 0, 1, true), 0.3), 'single unit = global progress');
// Unit vocabulary, and the Arabic rule: letters are never split out of joined script — 'char' on RTL
// text degrades to 'word', where each unit is still a whole, correctly shaped word.
assert.deepEqual(ANIM_UNITS, ['whole', 'word', 'char']);
assert.ok(isAnimUnit('word') && isAnimUnit('char') && !isAnimUnit('words'), 'unit vocabulary is exact');
assert.equal(effectiveUnit('char', true), 'word', 'char degrades to word on RTL text');
assert.equal(effectiveUnit('char', false), 'char', 'char stays char on Latin text');
assert.equal(effectiveUnit('word', true), 'word');
assert.equal(effectiveUnit('whole', true), 'whole');
assert.equal(effectiveUnit('bogus', false), 'whole', 'unknown units fall back to whole');
// Renderer + browser wiring: one shared definition, defaults carry the unit, RTL degradation applied,
// and the browser's control is disabled (not fake) for presets that already animate per unit.
assert.ok(renderSrc.includes("from './units.js'"), 'renderer imports the shared unit definitions');
assert.ok(renderSrc.includes("unit: 'whole'"), 'text defaults carry unit: whole');
assert.ok(renderSrc.includes('effectiveUnit') && renderSrc.includes('unitProgress'), 'renderer staggers via the shared math');
const browserSrc = fs.readFileSync(new URL('../src/components/TextAnimBrowser.jsx', import.meta.url), 'utf8');
assert.ok(browserSrc.includes('Word by word') && browserSrc.includes('Letters'), 'browser offers Word by word and Letters');
assert.ok(browserSrc.includes('INHERENT_UNIT_ANIMS'), 'browser disables the unit control for inherent per-unit presets');
for (const id of INHERENT_UNIT_ANIMS) {
  assert.ok(animStateSrc.includes(`case '${id}'`), `inherent per-unit preset ${id} exists in the renderer`);
}

console.log(`textanim units ok (window ${UNIT_WINDOW}, word/char stagger, RTL char->word fallback)`);
