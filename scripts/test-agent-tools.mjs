// RocketPilot's editing tools beyond cuts and motion (sounds, voice-over, stock, text, stickers, effects, clips,
// colors, compositing, project, undo, export) against the real reducer, with the main process faked.
// Usage: node scripts/test-agent-tools.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, videoLayout } from '../src/store.js';
import { createToolRunner, summarizeProject, TOOL_DECLARATIONS } from '../src/agent/tools.js';

let state = {
  past: [], future: [],
  present: {
    ...normalizeProject({}), fps: 30, ratio: '16:9', resolution: 1080, width: 1920, height: 1080,
    media: [
      { id: 'm', name: 'talk.mp4', type: 'video', duration: 30, width: 1920, height: 1080, hasAudio: true, path: 'C:/talk.mp4' },
      { id: 'pic', name: 'logo.png', type: 'image', width: 500, height: 500, path: 'C:/logo.png' },
    ],
    videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 10, speed: 1, volume: 1 }, { id: 'b', mediaId: 'm', in: 10, out: 20, speed: 1, volume: 1 }],
  },
};
const dispatch = (a) => { state = historyReducer(state, a); };
const p = () => state.present;

// The main process, faked: library / stock / voice files come back "probed" like media:probe does.
const probed = (name, type, duration) => ({ name, type, duration, path: `C:/fake/${name}`, ...(type === 'audio' ? {} : { width: 1280, height: 720 }) });
const calls = [];
const api = {
  librarySearch: async (o) => { calls.push(['librarySearch', o]); return { results: [{ id: 'freesound-1', title: 'Whoosh fast', duration: 1.2, creator: 'X', license: 'cc0', url: 'https://x' }, { id: 'jam-2', title: 'Happy', duration: 95, creator: 'Y', license: 'by' }] }; },
  libraryAdd: async (item) => probed(`${item.title}.mp3`, 'audio', item.duration),
  ttsStatus: async () => ({ voices: [{ id: 'ar_JO-kareem-medium', name: 'Kareem', lang: 'Arabic', gender: 'male' }], elevenKey: false }),
  ttsSpeak: async (req) => (req.voiceId === 'bad' ? { error: 'Unknown voice.' } : probed('Voice - hello.wav', 'audio', 2.5)),
  stockSearch: async (o) => ({ results: [{ id: '77', kind: o.kind, tags: 'city, night', duration: 12, width: 1920, height: 1080, url: 'https://cdn.pixabay.com/x' }] }),
  stockAdd: async (item) => probed(`city ${item.id}.mp4`, 'video', 12),
};
let exported = 0;
const ctx = {
  getProject: p, dispatch, api, settle: async () => {},
  addProbed: (res) => {
    const m = p().media.find((x) => x.path === res.path);
    if (m) return m;
    const item = { ...res, id: `media${p().media.length}` };
    dispatch({ type: 'addMedia', items: [item] });
    return item;
  },
  fontIds: () => ['montserrat', 'cairo', 'anton'],
  startExport: () => { exported++; },
};
const startLen = state.past.length + 1; // the user's own edit below comes first
dispatch({ type: 'update', track: 'video', id: 'a', patch: { filter: 'vivid' } }); // the user's edit
ctx.undoOwn = () => { if (state.past.length <= startLen) return false; dispatch({ type: 'undo' }); return true; };
const runner = createToolRunner(ctx);
const run = async (name, args) => {
  const r = await runner.run(name, args);
  return r;
};
const ok = (r, what) => assert.ok(r && !r.error, `${what}: ${JSON.stringify(r)}`);
const err = (r, re, what) => assert.ok(r && r.error && re.test(r.error), `${what}: ${JSON.stringify(r)}`);

// Every tool has a declaration and an implementation, and names are unique.
const names = TOOL_DECLARATIONS.map((d) => d.name);
assert.equal(new Set(names).size, names.length, 'tool names are unique');
// (On a throwaway runner that changes nothing: empty arguments must give an answer, never "Unknown tool".)
const probe = createToolRunner({ getProject: p, dispatch: () => {}, api: new Proxy({}, { get: () => async () => ({ error: 'offline' }) }), settle: async () => {} });
for (const n of names) assert.ok(!/Unknown tool/.test((await probe.run(n, {}))?.error || ''), `${n} is implemented`);

// Sounds: search, then add with volume, fades and a length.
let r = await run('search_sounds', { kind: 'sfx', query: 'whoosh' });
ok(r, 'search_sounds');
assert.equal(calls.at(-1)[1].kind, 'sfxall');
assert.equal(r.sounds[0].sound_id, 's1');
assert.ok(r.sounds[1].needs_credit, 'CC BY sounds are flagged');
err(await run('search_sounds', { kind: 'podcast', query: 'x' }), /kind/, 'unknown kind');
await run('search_sounds', { kind: 'meme', query: 'bruh' });
assert.equal(calls.at(-1)[1].kind, 'trolls', 'meme -> Trolls (MyInstants)');
r = await run('add_sound', { sound_id: 's2', start_sec: 1, volume: 0.2, fade_in_sec: 1, fade_out_sec: 2, duration_sec: 19 });
ok(r, 'add_sound');
let music = p().audioClips.find((c) => c.id === r.clip_id);
assert.deepEqual([music.start, music.volume, music.fadeIn, music.fadeOut, music.out - music.in], [1, 0.2, 1, 2, 19]);
err(await run('add_sound', { sound_id: 'v1' }), /sound_id/, 'a stock id is not a sound');
ok(await run('set_volume', { clip_id: music.id, fade_out_sec: 3 }), 'fade on an existing audio clip');
assert.equal(p().audioClips.find((c) => c.id === music.id).fadeOut, 3);
err(await run('set_volume', { clip_id: 'a', fade_in_sec: 1 }), /audio-track/, 'no fades on the main track');

// Voice-over.
r = await run('list_voices');
assert.equal(r.piper[0].voice_id, 'ar_JO-kareem-medium');
r = await run('add_voiceover', { text: 'مرحبا', voice_id: 'ar_JO-kareem-medium', start_sec: 4 });
ok(r, 'add_voiceover');
assert.equal(p().audioClips.find((c) => c.id === r.clip_id).start, 4);
err(await run('add_voiceover', { text: 'x', voice_id: 'bad' }), /Unknown voice/, 'voice errors come back');

// Stock b-roll: full-frame overlay for 3 s; and on the main track.
r = await run('search_stock', { kind: 'video', query: 'city' });
const vid = r.items[0].stock_id;
assert.ok(/^v\d+$/.test(vid), `stock ids start with v: ${vid}`);
r = await run('add_stock', { stock_id: vid, start_sec: 5, duration_sec: 3 });
ok(r, 'add_stock overlay');
let ov = p().overlayClips.find((c) => c.id === r.clip_id);
assert.deepEqual([ov.start, ov.out - ov.in, ov.transform.scale, ov.transform.x], [5, 3, 1, 0]);
r = await run('add_stock', { stock_id: vid, as: 'main', main_index: 1 });
ok(r, 'add_stock main');
assert.equal(videoLayout(p().videoClips).filter((l) => !l.clip.gap)[1].clip.id, r.clip_id, 'inserted at index 1');
assert.equal(p().media.filter((m) => m.path.includes('city')).length, 1, 'the same file is one media item');

// add_media as an overlay.
ok(await run('add_media', { media_name: 'logo', as: 'overlay', start_sec: 2 }), 'add_media overlay');
assert.ok(p().overlayClips.some((c) => c.mediaId === 'pic' && c.start === 2));

// Text: add with a look, then edit; bad values are refused.
r = await run('add_text', { text: 'Title', start_sec: 0, duration_sec: 2, font: 'anton', size: 120, color: '#ffcc00', y: 0.2, anim_in: 'pop', stroke_width: 8 });
ok(r, 'add_text');
const tid = r.clip_id;
let t = p().textClips.find((c) => c.id === tid);
assert.deepEqual([t.font, t.size, t.color, t.y, t.animIn.id, t.stroke.width], ['anton', 120, '#ffcc00', 0.2, 'pop', 8]);
ok(await run('edit_text', { clip_id: tid, text: 'New title', background_color: '#000000', anim_loop: 'pulse', start_sec: 1 }), 'edit_text');
t = p().textClips.find((c) => c.id === tid);
assert.deepEqual([t.text, t.bg.on, t.bg.color, t.animLoop.id, t.start, t.font], ['New title', true, '#000000', 'pulse', 1, 'anton']);
err(await run('edit_text', { clip_id: tid, font: 'comic-sans-xyz' }), /Unknown font/, 'unknown font');
err(await run('edit_text', { clip_id: tid, color: 'red' }), /#rrggbb/, 'bad color');
err(await run('edit_text', { clip_id: tid, anim_in: 'explode' }), /anim_in must be/, 'bad animation');
err(await run('edit_text', { clip_id: 'a' }), /No text clip/, 'not a text clip');
err(await run('edit_text', { clip_id: 'captions', font: 'cairo' }), /no automatic captions/, 'no captions yet');
dispatch({ type: 'setCaptions', style: {}, segments: [{ id: 'c1', start: 0, end: 2, text: 'سلام' }, { id: 'c2', start: 2, end: 4, text: 'لاباس' }] });
ok(await run('edit_text', { clip_id: 'captions', font: 'cairo', highlight: 'karaoke', highlight_color: '#ffd400', y: 0.8 }), 'restyle all captions');
err(await run('edit_text', { clip_id: 'captions', text: 'x' }), /only the look/, 'captions keep their words');
assert.ok(p().textClips.filter((c) => c.caption).every((c) => c.font === 'cairo' && c.highlight.mode === 'karaoke' && c.y === 0.8));
const sum = summarizeProject(p());
assert.equal(sum.captions.count, 2);
assert.ok(sum.text_track.every((x) => x.id !== 'c1'), 'captions are summarized, not listed');
assert.equal(sum.text_track.find((x) => x.id === tid).font, 'anton');

// Sticker and effect over a range.
r = await run('add_sticker', { emoji: '🔥', start_sec: 3, x: 0.8, size: 150 });
ok(r, 'add_sticker');
assert.ok(p().stickerClips.some((c) => c.emoji === '🔥' && c.x === 0.8 && c.size === 150));
err(await run('add_sticker', { emoji: 'this is not an emoji' }), /one emoji/, 'one emoji only');
r = await run('add_effect', { effect_id: p().effectClips ? 'vignette' : 'vignette', start_sec: 2, duration_sec: 4 });
ok(r, 'add_effect');
const fxId = r.clip_id;
err(await run('add_effect', { effect_id: 'laser', start_sec: 0 }), /Unknown effect/, 'unknown effect');

// Move, trim, clip tools.
ok(await run('move_clip', { clip_id: fxId, start_sec: 6 }), 'move an effect');
assert.equal(p().effectClips.find((c) => c.id === fxId).start, 6);
const mainIds = () => videoLayout(p().videoClips).filter((l) => !l.clip.gap).map((l) => l.clip.id);
const before = mainIds();
ok(await run('move_clip', { clip_id: 'b', to_index: 0 }), 'reorder the main track');
assert.equal(mainIds()[0], 'b');
assert.equal(mainIds().length, before.length);
ok(await run('trim_clip', { clip_id: 'b', start_sec: 2 }), 'trim the start of the first clip');
let b = p().videoClips.find((c) => c.id === 'b');
assert.deepEqual([b.in, b.out], [12, 20]);
err(await run('trim_clip', { clip_id: 'b', end_sec: 100 }), /source runs out/, 'cannot extend past the source');
ok(await run('trim_clip', { clip_id: tid, end_sec: 5 }), 'trim a text');
assert.equal(p().textClips.find((c) => c.id === tid).duration, 4);
r = await run('clip_tools', { clip_id: 'a', action: 'extract_audio' });
ok(r, 'extract_audio');
assert.ok(p().audioClips.some((c) => c.id === r.audio_clip_id) && p().videoClips.find((c) => c.id === 'a').muted);
err(await run('clip_tools', { clip_id: 'a', action: 'extract_audio' }), /Nothing to extract/, 'already muted');
r = await run('clip_tools', { clip_id: 'a', action: 'duplicate' });
ok(r, 'duplicate');
assert.ok(p().videoClips.some((c) => c.id === r.new_clip_id));
ok(await run('clip_tools', { clip_id: 'a', action: 'to_overlay', start_sec: 1 }), 'to_overlay');
assert.ok(p().overlayClips.some((c) => c.id === 'a' && c.start === 1));
ok(await run('clip_tools', { clip_id: 'a', action: 'to_main', main_index: 0 }), 'to_main');
assert.equal(mainIds()[0], 'a');
err(await run('clip_tools', { clip_id: 'a', action: 'explode' }), /action must be/, 'unknown action');

// Colors and compositing.
ok(await run('set_color', { clip_id: 'all', saturation: 1.3, contrast: 1.1 }), 'set_color all');
assert.ok(p().videoClips.filter((c) => !c.gap).every((c) => c.adjust.saturation === 1.3 && c.adjust.brightness === 0));
err(await run('set_color', { clip_id: 'a', saturation: 9 }), /between 0 and 3/, 'out of range');
ok(await run('set_compositing', { clip_id: ov.id, chroma_key: true, key_color: '#00ff00', key_strength: 30, blend: 'screen' }), 'set_compositing');
ov = p().overlayClips.find((c) => c.id === ov.id);
assert.deepEqual([ov.chroma.on, ov.chroma.intensity, ov.blend], [true, 30, 'screen']);
err(await run('set_compositing', { clip_id: ov.id, blend: 'sparkle' }), /blend must be/, 'unknown blend');

// Project settings.
ok(await run('set_project', { background: '#101010', resolution: 720, fps: 60, name: 'Reel' }), 'set_project');
assert.deepEqual([p().background, p().width, p().height, p().fps, p().name], ['#101010', 1280, 720, 60, 'Reel']);
err(await run('set_project', { fps: 33 }), /fps must be/, 'bad fps');

// Undo only takes back RocketPilot's own changes: never the user's filter from before the request.
let steps = 0;
while ((await run('undo')).ok) steps++;
assert.ok(steps > 10, `undid ${steps} steps`);
assert.equal(p().videoClips.find((c) => c.id === 'a').filter, 'vivid', "the user's edit stays");
err(await run('undo'), /Nothing of yours/, 'nothing more to undo');

// Motion design: recipes on demand, eased keyframes, and color / gradient scenes on the main track.
let g = await run('motion_guide', { topic: 'lower third' });
assert.ok(g.topic === 'lower_third' && /slideRight/.test(g.recipe), 'recipe by topic');
err(await run('motion_guide', { topic: 'fireworks' }), /topic must be/, 'unknown topic');
const bAt = videoLayout(p().videoClips).find((l) => l.clip.id === 'b').start;
ok(await run('add_keyframes', { clip_id: 'b', property: 'scale', easing: 'spring', keyframes: [{ time_sec: bAt + 2, value: 1 }, { time_sec: bAt + 3, value: 1.2 }, { time_sec: bAt + 4, value: 1.1, easing: 'out' }] }), 'eased keyframes');
const ks = p().videoClips.find((c) => c.id === 'b').keyframes.scale;
assert.deepEqual(ks.map((k) => k.e), ['spring', 'spring', 'out']);
err(await run('add_keyframes', { clip_id: 'b', property: 'x', easing: 'wobbly', keyframes: [{ time_sec: bAt + 2, value: 0 }] }), /easing must be/, 'bad easing');
api.makeScene = async (o) => ({ ...probed(`Background ${o.color}.png`, 'image'), path: `C:/fake/scene-${o.color}-${o.color2 || ''}-${o.width}x${o.height}.png` });
r = await run('add_scene', { color: '#7c3aed', color2: '#ec4899', direction: 'vertical', duration_sec: 2.5, main_index: 0 });
ok(r, 'add_scene');
assert.equal(mainIds()[0], r.clip_id, 'scene first on the main track');
assert.deepEqual([r.start, r.end], [0, 2.5]);
err(await run('add_scene', { color: 'purple' }), /#rrggbb/, 'bad scene color');
err(await run('add_scene', { color: '#000000', direction: 'radial' }), /direction must be/, 'bad direction');

// Named editing styles: the user's word ("App Story", "Tube TV") gives a whole-edit recipe; an unknown name lists
// the styles so the model can pick the closest. Text bubbles (App Story cards, chat bubbles).
let st = await run('edit_style', { name: 'App Story' });
assert.ok(st.style === 'App Story' && /bubble "rounded"/.test(st.recipe), JSON.stringify(st).slice(0, 200));
assert.equal((await run('edit_style', { name: 'old tv' })).style, 'Tube TV');
assert.equal((await run('edit_style', { name: 'Moon Drift style' })).style, 'Moon Drift');
err(await run('edit_style', { name: 'zz' }), /No style named.*orbit/, 'unknown style lists the others');
r = await run('add_text', { text: 'New message', y: 0.12 });
ok(await run('edit_text', { clip_id: r.clip_id, bubble: 'rounded', bubble_color: '#ffffff' }), 'bubble');
t = p().textClips.find((c) => c.id === r.clip_id);
assert.deepEqual([t.bubble, t.bubbleColor], ['rounded', '#ffffff']);
err(await run('edit_text', { clip_id: r.clip_id, bubble: 'cloud9' }), /bubble must be/, 'unknown bubble');
// Every id a style recipe names exists (filters, effects, transitions, caption styles, combos, templates).
const { EDIT_STYLES } = await import('../src/agent/motionGuide.js');
const known = new Set(Object.values(await (async () => {
  const lists = {};
  for (const w of ['filters', 'effects', 'transitions', 'caption_styles', 'text_templates', 'text_effects', 'bubbles', 'highlights']) {
    const v = (await run('list_options', { what: w }))[w];
    lists[w] = v.map((x) => String(x).split(' ')[0]);
  }
  const a = (await run('list_options', { what: 'text_animations' })).text_animations;
  const c = (await run('list_options', { what: 'clip_animations' })).clip_animations;
  lists.anims = [...a.anim_in, ...a.anim_out, ...a.anim_loop, ...c.in, ...c.out, ...c.combo];
  return lists;
})()).flat());
const named = (recipe) => [...recipe.matchAll(/(?:set_filter|set_effects \[?|add_effect|add_transition|template_id|style|combo|anim_in|anim_out|anim_loop|bubble|highlight|effect)\s+"([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]);
for (const [id, s2] of Object.entries(EDIT_STYLES)) {
  const missing = named(s2.recipe).filter((x) => !known.has(x) && !['cut', 'smooth'].includes(x));
  assert.deepEqual(missing, [], `${id} names unknown ids`);
}

// list_options gives the ids the short tool descriptions leave out.
let o = await run('list_options', { what: 'fonts' });
assert.deepEqual(o.fonts, ['montserrat', 'cairo', 'anton']);
o = await run('list_options', { what: 'text_animations' });
assert.ok(o.text_animations.anim_in.includes('pop') && o.text_animations.anim_loop.includes('pulse'));
o = await run('list_options', { what: 'caption_styles' });
assert.ok(o.caption_styles.some((x) => x.startsWith('cap-classic')));
err(await run('list_options', { what: 'colors' }), /what must be one of/, 'unknown list');
// The declarations stay small: every step sends them (Groq's free plan: 8K tokens a minute).
assert.ok(JSON.stringify(TOOL_DECLARATIONS).length < 15000, `declarations are ${JSON.stringify(TOOL_DECLARATIONS).length} chars`);

// Export opens the save window (the app's own flow).
ok(await run('export_video'), 'export_video');
assert.equal(exported, 1);
assert.ok(!runner.mutates('search_sounds') && !runner.mutates('export_video') && runner.mutates('add_sound'));

console.log(`AGENT TOOLS OK (${names.length} tools)`);
