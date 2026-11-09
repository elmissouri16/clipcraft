// CraftAI motion graphics tools (src/features/agent/graphicsTools.js) against the real reducer, with
// the sandbox render stubbed: a graphic becomes transparent media (export file + transparent preview
// copy at every playback quality, so no opaque copy replaces it) placed as an overlay; an empty
// timeline is padded; frames come back as one contact sheet; edit_graphic merges inputs, re-points
// the clip and drops the old render; errors from the component reach the agent unchanged.
// Usage: node tests/unit/agents/test-agent-graphics.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer, exportDuration, previewPathFor } from '../../../src/state/store.js';
import { createToolRunner, TOOL_DECLARATIONS } from '../../../src/features/agent/tools.js';
import { TOOL_GROUPS } from '../../../src/features/agent/toolCatalog.js';
import { graphicsGuide, GRAPHICS_EXAMPLES } from '../../../src/features/agent/graphicsGuide.js';
import { resolveGraphicFonts, bundledGraphicFamilies } from '../../../src/features/graphics/graphicFonts.js';
import { designWarnings } from '../../../src/features/agent/graphicsTools.js';
import { swapGraphicActions, redrawGraphicAction, graphicOutdated } from '../../../src/features/graphics/graphicMedia.js';
import { mediaTreeCounts, mediaTreeFilter } from '../../../src/features/library/assetsLib.js';
import { graphicInputDefaults, graphicInputField, graphicInputError } from '../../../src/features/graphics/graphicInputs.js';

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const renders = [];
let state = { past: [], future: [], present: { ...emptyProject(), width: 1080, height: 1920, fps: 30 } };
const api = {
  agentRenderGraphic: async (req) => {
    renders.push(req);
    if (/BROKEN/.test(req.code)) return { ok: false, error: 'Frame 0: inputs.data is undefined (component line 4, column 18)' };
    const n = renders.length;
    return { ok: true, key: `k${n}`, file: `/cache/k${n}/graphic.mov`, preview: `/cache/k${n}/preview.webm`, width: req.width, height: req.height, fps: req.fps,
      frames: Math.round(req.duration_sec * req.fps), duration_sec: req.duration_sec, cached: false, stats: { total_ms: 900 },
      media: { type: 'video', duration: req.duration_sec, width: req.width, height: req.height, vcodec: 'qtrle', pixFmt: 'argb', hdr: false, hasAudio: false },
      frames: [{ id: `f${n}a` }, { id: `f${n}b` }, { id: `f${n}c` }] };
  },
  agentFrameSheet: async ({ frame_ids }) => ({ id: `sheet-${frame_ids.join('-')}`, cells: frame_ids.map((id, i) => ({ id, cell: i + 1 })) }),
};
const ctx = { getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, api, settle: async () => {}, requestId: 'graphics-test' };
const run = (name, args) => createToolRunner(ctx).run(name, args);

await check('graphics tools are declared in their own group, and the guide answers', () => {
  for (const t of ['graphics_guide', 'add_graphic', 'edit_graphic']) assert.ok(TOOL_DECLARATIONS.some((d) => d.name === t) && TOOL_GROUPS.graphics.includes(t), t);
  assert.match(graphicsGuide('toolkit').text, /export default function render/);
  assert.match(graphicsGuide('chart').code, /kit\.spring/); assert.ok(graphicsGuide('nope').error);
  for (const [name, code] of Object.entries(GRAPHICS_EXAMPLES)) assert.match(code, /export default function render/, name);
});

let clipId, firstMedia;
await check('add_graphic renders, registers transparent media and places it over an empty timeline', async () => {
  const r = await run('add_graphic', { code: GRAPHICS_EXAMPLES.chart, inputs: { title: 'US states' }, duration_sec: 6, start_sec: 0, name: 'Population chart' });
  assert.ok(r.ok, JSON.stringify(r));
  const p = state.present, clip = p.overlayClips.find((c) => c.id === r.clip_id), m = p.media.find((x) => x.id === r.media_id);
  clipId = clip.id; firstMedia = m.id;
  assert.equal(m.path, '/cache/k1/graphic.mov'); assert.equal(m.graphic.inputs.title, 'US states'); assert.equal(m.graphic.key, 'k1');
  for (const q of ['full', 'high', 'medium', 'low']) assert.equal(previewPathFor(m, q), '/cache/k1/preview.webm', `preview plays the transparent copy at ${q}`);
  assert.equal(clip.start, 0); assert.equal(clip.out - clip.in, 6);
  assert.ok(Math.abs(exportDuration(p) - 6) < 1e-6, 'the empty main track is padded to cover the graphic');
  assert.equal(r.sheet_id, 'sheet-f1a-f1b-f1c'); assert.equal(r.frames.length, 3);
  assert.equal(renders[0].width, 1080); assert.equal(renders[0].fps, 30); assert.equal(renders[0].duration_sec, 6);
});

await check('edit_graphic merges inputs, keeps the clip and drops the unused render', async () => {
  await run('add_keyframes', { clip_id: clipId, property: 'opacity', keyframes: [{ time_sec: 5, value: 1 }, { time_sec: 6, value: 0, easing: 'out' }] });
  const r = await run('edit_graphic', { clip_id: clipId, inputs: { accent: '#4fc3f7' } });
  assert.ok(r.ok, JSON.stringify(r));
  const p = state.present, clip = p.overlayClips.find((c) => c.id === clipId), m = p.media.find((x) => x.id === clip.mediaId);
  assert.deepEqual(m.graphic.inputs, { title: 'US states', accent: '#4fc3f7' }, 'inputs are merged');
  assert.equal(renders.at(-1).code, GRAPHICS_EXAMPLES.chart, 'the code is kept');
  assert.ok(!p.media.some((x) => x.id === firstMedia), 'the old render left the library');
  assert.equal(clip.keyframes.opacity.length, 2, 'keyframes stay');
  const longer = await run('edit_graphic', { clip_id: clipId, duration_sec: 8 });
  assert.ok(longer.ok); assert.equal(state.present.overlayClips.find((c) => c.id === clipId).out, 8);
  assert.ok(exportDuration(state.present) >= 8 - 1e-6);
});

await check('component errors reach the agent; bad arguments are refused before rendering', async () => {
  const before = renders.length;
  assert.match((await run('add_graphic', { code: 'export default function render(){ BROKEN }', duration_sec: 2 })).error, /component line 4/);
  assert.match((await run('add_graphic', { code: GRAPHICS_EXAMPLES.chart, duration_sec: 90 })).error, /duration_sec/);
  assert.match((await run('add_graphic', { code: '', duration_sec: 2 })).error, /code/);
  assert.match((await run('edit_graphic', { clip_id: 'nope' })).error, /not a graphic/);
  assert.equal(renders.length, before + 1, 'only the valid-looking request rendered');
});

await check('arbitrary input declarations preserve legacy values and validate editable controls', () => {
  const schema = { old: 2, object: { x: .2, y: .7 }, rate: { type: 'number', default: 1, min: .25, max: 4, step: .25, unit: 'turns/s' },
    direction: { type: 'choice', default: 1, options: [{ value: 1, label: 'Forward' }, { value: -1, label: 'Reverse' }] },
    flag: { type: 'choice', default: false, options: [false, true] }, anchor: { type: 'point', default: { x: .5, y: .5 } } };
  const values = graphicInputDefaults(schema);
  assert.deepEqual(values, { old: 2, object: { x: .2, y: .7 }, rate: 1, direction: 1, flag: false, anchor: { x: .5, y: .5 } });
  const rate = graphicInputField('rate', schema.rate, 1), direction = graphicInputField('direction', schema.direction, 1);
  assert.equal(graphicInputError(rate, 2), '');
  for (const value of ['', '2', NaN, Infinity, 0, 5]) assert.ok(graphicInputError(rate, value), String(value));
  assert.equal(graphicInputError(direction, -1), ''); assert.ok(graphicInputError(direction, '-1'), 'choices keep their declared types');
  assert.equal(graphicInputError(graphicInputField('flag', schema.flag, false), false), '', 'false is a valid choice');
  const point = graphicInputField('anchor', schema.anchor, values.anchor);
  assert.equal(graphicInputError(point, { x: .4, y: .8 }), ''); assert.ok(graphicInputError(point, { x: .4 })); assert.ok(graphicInputError(point, { x: 2, y: .8 }));
  const malformed = graphicInputField('n', { type: 'number', default: 2, min: 0, max: -1, step: -5 }, 2);
  assert.equal(malformed.slider, false); assert.equal(malformed.max, undefined); assert.equal(malformed.step, 'any');
  assert.equal(graphicInputField('old', 2, values.old).type, 'number');
});

await check('fonts come from the bundled @font-face rules, with missing ones named', async () => {
  const rule = (family, weight, url, range) => ({ type: 5, style: { getPropertyValue: (k) => ({ 'font-family': `"${family}"`, 'font-weight': weight, 'font-style': 'normal', src: `url(${url}) format("woff2")`, 'unicode-range': range })[k] || '' }, parentStyleSheet: { href: 'http://app/assets/index.css' } });
  const doc = { baseURI: 'http://app/', styleSheets: [{ cssRules: [rule('Montserrat', '800', './montserrat-latin-800.woff2', 'U+0000-00FF'), rule('Inter', '100 900', '/inter-var.woff2')] }] };
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return { ok: true, arrayBuffer: async () => new Uint8Array([119, 79, 70, 50]).buffer }; };
  const out = await resolveGraphicFonts(['Montserrat 800', 'Inter 600', 'Comic Neue'], { doc, fetchImpl });
  assert.deepEqual(out.fonts.map((f) => [f.family, f.weight, f.data]), [['Montserrat', 800, 'd09GMg=='], ['Inter', 600, 'd09GMg==']]);
  assert.equal(out.fonts[0].unicodeRange, 'U+0000-00FF'); assert.deepEqual(out.missing, ['Comic Neue']);
  assert.ok(fetched.includes('http://app/assets/montserrat-latin-800.woff2'));
});

await check('variable fonts answer to their family; the bundled list is offered', async () => {
  const rule = (family, weight) => ({ type: 5, style: { getPropertyValue: (k) => ({ 'font-family': `'${family}'`, 'font-weight': weight, 'font-style': 'normal', src: 'url(/inter.woff2) format("woff2-variations")' })[k] || '' }, parentStyleSheet: { href: 'http://app/a.css' } });
  const doc = { baseURI: 'http://app/', styleSheets: [{ cssRules: [rule('Inter Variable', '100 900'), rule('Montserrat', '900')] }] };
  const out = await resolveGraphicFonts(['Inter 600'], { doc, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) });
  assert.deepEqual([out.missing, out.fonts[0].family], [[], 'Inter'], 'drawn as "Inter", the name the component uses');
  assert.deepEqual(bundledGraphicFamilies(doc), ['Inter 100-900', 'Montserrat 900']);
  const near = await resolveGraphicFonts(['Montserrat 800'], { doc, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) });
  assert.deepEqual([near.missing, near.fonts.map((f) => f.weight)], [[], [800]], 'a missing weight uses the nearest bundled face');
});

await check('design warnings: small text, long still holds, very long graphics', () => {
  // The graphic CraftAI first made for the US states request: 28 px notes, 7.5 s still pages, 50 s.
  const first = designWarnings({ width: 1080, fps: 30, duration_sec: 50, stats: { min_font_px: 28, longest_still_frames: 225, longest_still_from: 75 } });
  assert.equal(first.length, 3, JSON.stringify(first));
  assert.match(first[0], /28 px/); assert.match(first[1], /7\.5 s/); assert.match(first[2], /50 s/);
  assert.deepEqual(designWarnings({ width: 1080, fps: 30, duration_sec: 6, stats: { min_font_px: 40, longest_still_frames: 30 } }), []);
});

await check('in the editor a graphic is a graphic: own library group, always a full-frame overlay, one-step swaps', () => {
  const g = { id: 'g', type: 'video', name: 'Chart', path: '/g.mov', duration: 4, width: 1080, height: 1920, fps: 30, graphic: { code: 'x', inputs: {} } };
  const v = { id: 'v', type: 'video', name: 'Shot', path: '/v.mp4', duration: 10, width: 1080, height: 1920 };
  assert.deepEqual([mediaTreeCounts([g, v]).graphic, mediaTreeCounts([g, v]).video], [1, 1], 'graphics are not counted as videos');
  assert.deepEqual(mediaTreeFilter([g, v], 'graphic').map((m) => m.id), ['g']);
  let st = { past: [], future: [], present: { ...emptyProject(), width: 1080, height: 1920, fps: 30, media: [g, v], videoClips: [{ id: 'm', mediaId: 'v', in: 0, out: 10, speed: 1 }] } };
  const go = (a) => { st = historyReducer(st, a); };
  go({ type: 'addToTimeline', mediaId: 'g', clipId: 'c', at: 2 });
  assert.equal(st.present.videoClips.length, 1, 'never onto the main track');
  const c = st.present.overlayClips.find((x) => x.id === 'c');
  assert.deepEqual([c.start, c.transform.scale], [2, 1], 'over the whole frame at the playhead');
  const next = { ...g, id: 'g2', duration: 6, graphic: { code: 'x', inputs: { title: 'New' } } };
  const past = st.past.length;
  go(swapGraphicActions(st.present, 'overlay', c, next));
  assert.equal(st.past.length, past + 1, 'one Undo step');
  assert.deepEqual([st.present.overlayClips[0].mediaId, st.present.overlayClips[0].out, st.present.media.some((m) => m.id === 'g')], ['g2', 6, false]);
  go({ type: 'undo' }); assert.equal(st.present.overlayClips[0].mediaId, 'g', 'Undo brings the previous render back');
  assert.ok(graphicOutdated(g, { width: 720, height: 1280, fps: 30 }) && !graphicOutdated(g, { width: 1080, height: 1920, fps: 30 }));
  go({ ...redrawGraphicAction(st.present, g, { ...g, id: 'g3', width: 720, height: 1280 }), transient: true });
  assert.equal(st.present.overlayClips[0].mediaId, 'g3'); assert.equal(st.past.length, past, 'a re-draw is not its own Undo step');
});

console.log(`${checks.length} graphics tool checks passed`);
