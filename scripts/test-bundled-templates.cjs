// Bundled templates: the 40 offline packages list, open, and form valid projects
// (slots present, media on disk, text styles + clip animations resolvable) through the real
// module. Template rebuild: "Concept | Mechanics" titles, taxonomy tags, art-directed scene
// media, staggered choreography, the printed slot contract (duration · ratio · N texts ·
// N media in meta), colour variants of six hero designs, an animated preview.mp4 each.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const bundled = require('../electron/bundledTemplates.cjs');

const TAXONOMY = ['Text Animation', 'Logo Animation', 'UI Animation', 'Engagement', 'Mockup', 'Process', 'Promo', 'Social'];
const VARIANTS = ['vertical-reel-hook-teal', 'vertical-reel-hook-coral', 'quote-card-violet', 'quote-card-teal', 'quote-card-coral',
  'product-promo-teal', 'product-promo-coral', 'product-promo-violet',
  'sale-countdown-teal', 'sale-countdown-violet', 'sale-countdown-amber',
  'motivational-quote-teal', 'motivational-quote-coral', 'motivational-quote-amber',
  'travel-vlog-coral', 'travel-vlog-violet', 'travel-vlog-amber'];
const NEW_MECHANICS = ['search-bar-promo', 'number-counter', 'portfolio-showcase', 'paper-strip-headline', 'five-step-process', 'logo-reveal', 'phone-mockup-promo', 'word-wheel'];

(async () => {
  const { TEXT_TEMPLATES, ANIM_IN } = await import('../src/text/catalog.js');
  const tplIds = new Set(TEXT_TEMPLATES.map((t) => t.id));
  const animIds = new Set(ANIM_IN.map((a) => a.id));
  const root = path.join(__dirname, '..');
  const { templates, categories } = bundled.list(root);
  assert.equal(templates.length, 40, `expected 40 bundled templates, got ${templates.length}`);
  assert.ok(categories.length >= 6, `categories present: ${categories.join(', ')}`);
  const titles = new Set(templates.map((t) => t.title));
  assert.equal(titles.size, 40, 'titles are distinct');
  const slugs = new Set(templates.map((t) => t.slug));
  for (const s of [...VARIANTS, ...NEW_MECHANICS]) assert.ok(slugs.has(s), `package exists: ${s}`);
  for (const t of templates) {
    assert.ok(t.clips >= 1, `${t.slug} has slots`);
    assert.ok(t.title.includes(' | '), `${t.slug} title follows "Concept | Mechanics": ${t.title}`);
    assert.ok(Array.isArray(t.tags) && t.tags.length >= 1, `${t.slug} has tags`);
    for (const g of t.tags) assert.ok(TAXONOMY.includes(g), `${t.slug} tag "${g}" is in the taxonomy`);
    assert.ok(t.thumb && fs.existsSync(t.thumb), `${t.slug} cover exists`);
    assert.ok(t.preview && fs.existsSync(t.preview), `${t.slug} animated preview exists`);
    assert.ok(fs.statSync(t.preview).size > 5000, `${t.slug} preview is a real video (${fs.statSync(t.preview).size} B)`);
    const { json } = bundled.use(root, t.slug);
    const p = JSON.parse(json);
    assert.equal(p.template.title, t.title);
    const slots = [...(p.videoClips || []), ...(p.overlayClips || [])].filter((c) => c.slot && !c.gap);
    assert.ok(slots.length >= 1, `${t.slug} project has replaceable clips`);
    // Slot contract: the counts the UI prints are computed from the project, never typed.
    assert.equal(t.texts, (p.textClips || []).length, `${t.slug} meta texts == project text clips`);
    assert.equal(t.media, slots.length, `${t.slug} meta media == project replaceable clips`);
    assert.ok(t.duration > 0, `${t.slug} meta duration present`);
    for (const m of p.media) {
      assert.ok(path.isAbsolute(m.path) && fs.existsSync(m.path), `${t.slug} media on disk: ${m.path}`);
    }
    for (const tc of p.textClips || []) {
      assert.ok(tplIds.has(tc.template), `${t.slug} text style ${tc.template} exists in the catalog`);
      if (tc.animIn) assert.ok(animIds.has(tc.animIn.id), `${t.slug} text anim ${tc.animIn.id} exists in ANIM_IN`);
    }
    // Choreography: with several texts, the build is staggered — never all at one instant.
    const starts = (p.textClips || []).map((c) => c.start);
    if (starts.length >= 2) assert.ok(Math.max(...starts) > Math.min(...starts), `${t.slug} text builds are staggered`);
    const [rw, rh] = t.ratio.split(':').map(Number);
    assert.equal(p.width / p.height, rw / rh, `${t.slug} canvas matches its ratio`);
  }
  // The new mechanics are really in the projects, not just in the names.
  const use = (s) => JSON.parse(bundled.use(root, s).json);
  const counter = use('number-counter');
  assert.ok(counter.textClips.filter((c) => /^\d/.test(c.text)).length >= 5, 'number counter steps through figures');
  const search = use('search-bar-promo');
  assert.ok(search.textClips.some((c) => c.template === 'title-typewriter'), 'search bar types its query');
  const portfolio = use('portfolio-showcase');
  assert.ok(portfolio.overlayClips.filter((c) => c.slot).length === 3, 'portfolio has three replaceable cards');
  assert.ok(portfolio.overlayClips.every((c) => c.anim?.in?.type), 'portfolio cards animate in');
  const logo = use('logo-reveal');
  assert.ok(logo.overlayClips.some((c) => c.slot && c.anim?.in?.type === 'zoom_in'), 'logo reveal zooms the logo slot in');
  const phone = use('phone-mockup-promo');
  assert.ok(phone.overlayClips.some((c) => !c.slot), 'phone mockup carries a frame overlay');
  const wheel = use('word-wheel');
  const words = wheel.textClips.filter((c) => c.y === 0.55);
  assert.ok(words.length === 4 && words.every((c, i) => i === 0 || c.start > words[i - 1].start), 'word wheel rotates words in sequence');
  assert.throws(() => bundled.use(root, '../etc'), /Unknown template/);
  console.log('bundled-templates OK: 40 packages verified (names, tags, previews, variants, slots, slot contract, choreography, media, styles, ratios)');
})().catch((e) => { console.error(e); process.exit(1); });
