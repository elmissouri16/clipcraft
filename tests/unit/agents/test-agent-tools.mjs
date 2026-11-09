// RocketPilot's editing tools beyond cuts and motion (sounds, voice-over, stock, text, effects, clips,
// colors, compositing, project, undo, export) against the real reducer, with the main process faked.
// Usage: node tests/unit/agents/test-agent-tools.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, videoLayout } from "../../../src/state/store.js";
import { createToolRunner, summarizeProject, TOOL_DECLARATIONS } from "../../../src/features/agent/tools.js";
import { createToolCatalog, TOOL_GROUPS } from "../../../src/features/agent/toolCatalog.js";
import geminiTts from "../../../electron/audio/geminiTts.cjs";
import { clearsFailure, editTarget, failureTargets, pruneFailures, unresolvedReport } from "../../../src/features/agent/runAgent.js";

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
let geminiConfigured = false; let piperInstalled = true;
const api = {
  librarySearch: async (o) => { calls.push(['librarySearch', o]); return { results: [{ id: 'freesound-1', title: 'Whoosh fast', duration: 1.2, creator: 'X', license: 'cc0', url: 'https://x' }, { id: 'jam-2', title: 'Happy', duration: 95, creator: 'Y', license: 'by' }] }; },
  libraryAdd: async (item) => probed(`${item.title}.mp3`, 'audio', item.duration),
  ttsStatus: async () => ({ supported: true, installed: piperInstalled, voices: [{ id: 'ar_JO-kareem-medium', name: 'Kareem', lang: 'Arabic', gender: 'male', downloaded: true }, { id: 'en_US-joe-medium', name: 'Joe', lang: 'English (US)', gender: 'male', downloaded: false }], elevenKey: false, geminiKey: geminiConfigured, gemini: geminiTts.catalog() }),
  ttsSpeak: async (req) => { calls.push(['ttsSpeak', req]); return req.voiceId === 'bad' ? { error: 'Unknown voice.' }
    : req.text === 'Out of quota' ? { error: 'Gemini TTS daily request limit reached.', limit: { provider: 'gemini', kind: 'daily', model: 'gemini-3.8-flash-tts', resets: 'midnight Pacific time', other_model: 'gemini-3.8-flash-lite-tts' } }
    : req.text === 'Waited' ? { ...probed('Voice - waited.wav', 'audio', 1), waited_sec: 31 } : probed('Voice - hello.wav', 'audio', 2.5); },
  ttsSpeakLines: async (req) => { calls.push(['ttsSpeakLines', req]); return req.lines[0] === 'Over the limit' ? { error: 'Gemini TTS is still over its per-minute request limit.', limit: { provider: 'gemini', kind: 'per_minute', model: 'gemini-3.8-flash-tts' } }
    : { items: req.lines.map((t, i) => probed(`Voice ${i + 1} - ${t}.wav`, 'audio', 1.5 + i)), mode: 'one_request', requests: 1 }; },
  stockSearch: async (o) => ({ results: [{ id: '77', kind: o.kind, tags: 'city, night', duration: 12, width: 1920, height: 1080, url: 'https://cdn.pixabay.com/x' }] }),
  stockAdd: async (item) => probed(`city ${item.id}.mp4`, 'video', 12),
  agentGenerateImage: async (req) => { calls.push(['agentGenerateImage', req]); return { ...probed('Generated character.png', 'image'), origin: 'codex-image' }; },
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
  startExport: async () => { exported++;return { ok: true, file: '/test-export.mp4', size: 100, metadata: { width: 1280, height: 720, duration_sec: 8, video_codec: 'h264', has_audio: true } }; },
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
ok(await run('set_volume', { clip_id: 'a', fade_in_sec: 1 }), 'fade on a main-track video');

// Voice-over.
// Piper voices are optional downloads (Settings > Voice): without the engine none is offered or used.
piperInstalled = false;
r = await run('list_voices');
assert.equal(r.default_engine, null); assert.match(r.piper, /Settings > Voice/);
err(await run('add_voiceover', { text: 'Hello' }), /No speech engine is set up.*Settings > Voice/, 'no engine, no silent download');
err(await run('add_voiceover', { engine: 'piper', text: 'Hello' }), /No Piper voice is downloaded/, 'piper asked for while missing');
piperInstalled = true;
r = await run('list_voices');
assert.equal(r.default_engine, 'piper');
assert.deepEqual(r.piper.map((v) => v.voice_id), ['ar_JO-kareem-medium'], 'only downloaded voices are listed');
err(await run('add_voiceover', { text: 'x', voice_id: 'en_US-joe-medium' }), /not downloaded.*Settings > Voice/, 'a voice that is not downloaded');
r = await run('add_voiceover', { text: 'مرحبا', voice_id: 'ar_JO-kareem-medium', start_sec: 4 });
ok(r, 'add_voiceover');
assert.equal(p().audioClips.find((c) => c.id === r.clip_id).start, 4);
err(await run('add_voiceover', { text: 'x', voice_id: 'bad' }), /not downloaded/, 'unknown Piper voices are refused before speaking');
geminiConfigured = true;
r = await run('list_voices');
assert.equal(r.default_engine, 'gemini');
assert.ok(r.gemini.models.some(m => m.id === 'gemini-3.8-flash-tts'));
assert.ok(r.gemini.voices.some(v => v.voice_id === 'Kore'));
r = await run('add_voiceover', { text: 'مرحبا بكم', start_sec: 6, model: 'gemini-3.8-flash-lite-tts', style: 'Warm Moroccan Arabic narration', volume: 0.8 });
ok(r, 'Gemini narration');
assert.deepEqual(calls.at(-1)[1], { engine: 'gemini', voiceId: 'Kore', voiceName: 'Kore', text: 'مرحبا بكم', speed: 1,
  model: 'gemini-3.8-flash-lite-tts', style: 'Warm Moroccan Arabic narration' });
assert.equal(p().audioClips.find(c => c.id === r.clip_id).start, 6);
assert.equal(p().audioClips.find(c => c.id === r.clip_id).volume, 0.8);
const audioCount = p().audioClips.length;
err(await run('add_voiceover', { engine: 'unknown', text: 'Hello' }), /engine/, 'unknown engines never fall back to Piper');
err(await run('add_voiceover', { engine: 'gemini', voice_id: 'bad', text: 'Hello' }), /Unknown voice/, 'generation failure does not insert audio');
assert.equal(p().audioClips.length, audioCount);
// A provider limit comes back as a quota CraftAI acts on, not a generic failure.
r = await run('add_voiceover', { engine: 'gemini', text: 'Out of quota' });
err(r, /daily request limit/, 'daily limit error');
assert.equal(r.provider_limit.kind, 'daily'); assert.match(r.next, /gemini-3\.8-flash-lite-tts/); assert.match(r.next, /Do not call Gemini TTS/);
assert.equal(p().audioClips.length, audioCount, 'nothing placed on a limit');
r = await run('add_voiceover', { engine: 'gemini', text: 'Waited' });
ok(r, 'narration after a per-minute wait'); assert.equal(r.rate_limit_wait_sec, 31); assert.match(r.note_limit, /add_narration/);
// Several lines in one request, each its own clip.
const narrated = p().audioClips.length;
r = await run('add_narration', { lines: [{ text: 'First line', start_sec: 2 }, { text: 'Second line' }, { text: 'Third line', start_sec: 12 }], voice_id: 'Puck', style: 'Calm', gap_sec: 0.5, volume: 0.7 });
ok(r, 'add_narration');
assert.deepEqual(calls.at(-1)[1].lines, ['First line', 'Second line', 'Third line']);
assert.equal(calls.at(-1)[1].voiceId, 'Puck'); assert.equal(calls.at(-1)[1].style, 'Calm');
assert.equal(r.clips.length, 3); assert.equal(r.requests, 1);
assert.deepEqual(r.clips.map((c) => c.start_sec), [2, 4, 12], 'a line without start_sec follows the previous one after gap_sec');
assert.ok(r.clips.every((c) => p().audioClips.find((a) => a.id === c.clip_id)?.volume === 0.7));
assert.equal(p().audioClips.length, narrated + 3);
err(await run('add_narration', { lines: [{ text: 'Only one' }] }), /two lines/, 'one line belongs to add_voiceover');
err(await run('add_narration', { lines: [{ text: 'A' }, { text: ' ' }] }), /needs text/, 'empty line');
r = await run('add_narration', { lines: ['Over the limit', 'Second'] });
assert.equal(r.provider_limit.kind, 'per_minute'); assert.match(r.next, /one add_narration call/);
geminiConfigured = false;
err(await run('add_narration', { lines: ['A', 'B'] }), /Gemini TTS/, 'add_narration needs Gemini');

// Generated images enter the same media/clip store and accept scene timing.
r = await run('generate_image', { prompt: 'A new scene with the same logo character', reference_media_ids: ['pic'], start_sec: 12, duration_sec: 4.5, transparent_background: true });
ok(r, 'generated character scene');
let generated = p().overlayClips.find(c => c.id === r.clip_id);
assert.deepEqual([generated.start, generated.in, generated.out], [12, 0, 4.5]);
assert.equal(p().media.find(m => m.id === r.media_id).origin, 'codex-image');
assert.equal(calls.at(-1)[0], 'agentGenerateImage');
assert.deepEqual(calls.at(-1)[1].referencePaths, ['C:/logo.png']);
assert.equal(calls.at(-1)[1].transparentBackground, true);
const overlayCount = p().overlayClips.length, generatedCalls = calls.length;
err(await run('generate_image', { prompt: 'x', reference_media_ids: ['missing'] }), /Reference IDs/, 'reject invented character reference');
err(await run('generate_image', { prompt: 'x', duration_sec: 0 }), /duration_sec/, 'reject invalid scene duration before generation');
err(await run('generate_image', { prompt: 'x', as: 'main', start_sec: 12 }), /main_index/, 'do not silently append a scene requested at a time');
assert.equal(calls.length, generatedCalls);
r = await run('generate_image', { prompt: 'Character library', as: 'library' });
ok(r, 'generate for reuse without a timeline clip');
assert.equal(p().overlayClips.length, overlayCount);

const imageState = state;
dispatch({ type: 'load', project: normalizeProject({ media: p().media }) });
r = await run('generate_image', { prompt: 'First scene', start_sec: 2, duration_sec: 4 });
ok(r, 'generated image starts an exportable project');
assert.ok(p().videoClips[0].gap);
assert.equal(videoLayout(p().videoClips).at(-1).end, 6);
dispatch({ type: 'extendVideoTo', end: 8, gapId: 'extended-gap' });
assert.equal(p().videoClips.length, 1, 'later generated scenes reuse the existing background');
assert.equal(videoLayout(p().videoClips).at(-1).end, 8);
dispatch({ type: 'setLayerState', track: 'video', layer: 0, patch: { locked: true } });
const beforeLockedGeneration = calls.length;
err(await run('generate_image', { prompt: 'Beyond the locked track', start_sec: 7, duration_sec: 3 }), /Unlock the main track/, 'avoid generation when its required background cannot extend');
assert.equal(calls.length, beforeLockedGeneration);
dispatch({ type: 'extendVideoTo', end: 10, gapId: 'locked-gap' });
assert.equal(videoLayout(p().videoClips).at(-1).end, 8, 'background padding respects a locked main track');
state = imageState;

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

// Effect over a range. (R1, 2026-11-01: the add_sticker tool was removed with the Stickers feature.)
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

// Removed whole-edit presets are no longer offered to either agent transport.
assert.ok(!TOOL_DECLARATIONS.some(tool => tool.name === 'edit_style'));
assert.equal(TOOL_GROUPS.style, undefined);
// Text bubbles remain available independently of the removed whole-edit presets.
r = await run('add_text', { text: 'New message', y: 0.12 });
ok(await run('edit_text', { clip_id: r.clip_id, bubble: 'rounded', bubble_color: '#ffffff' }), 'bubble');
t = p().textClips.find((c) => c.id === r.clip_id);
assert.deepEqual([t.bubble, t.bubbleColor], ['rounded', '#ffffff']);
err(await run('edit_text', { clip_id: r.clip_id, bubble: 'cloud9' }), /bubble must be/, 'unknown bubble');
// list_options gives the ids the short tool descriptions leave out.
let o = await run('list_options', { what: 'fonts' });
assert.deepEqual(o.fonts, ['montserrat', 'cairo', 'anton']);
o = await run('list_options', { what: 'text_animations' });
assert.ok(o.text_animations.anim_in.includes('pop') && o.text_animations.anim_loop.includes('pulse'));
o = await run('list_options', { what: 'caption_styles' });
assert.ok(o.caption_styles.some((x) => x.startsWith('cap-classic')));
err(await run('list_options', { what: 'colors' }), /what must be one of/, 'unknown list');
// Bound the schemas actually sent: feature growth must not load every group.
assert.ok(JSON.stringify(createToolCatalog(TOOL_DECLARATIONS).tools()).length < 5000);
for (const group of Object.keys(TOOL_GROUPS)) {
  const catalog = createToolCatalog(TOOL_DECLARATIONS); catalog.load([group]);
  assert.ok(JSON.stringify(catalog.tools()).length < 10000, `${group} schema exceeds its request budget`);
}

// Export opens the save window (the app's own flow).
ok(await run('export_video'), 'export_video');
assert.equal(exported, 1);
assert.ok(!runner.mutates('search_sounds') && !runner.mutates('export_video') && runner.mutates('add_sound'));

// Errors point to the right tool, and the spellings agents use for the same option are accepted.
{
  const title = (await run('add_text', { text: 'Spelling', start_sec: 0, duration_sec: 2, font: 'Montserrat', anim_in: 'fade_in', anim_out: 'zoom_out' }));
  ok(title, 'a font in any case and the clip animation spelling work for titles');
  const t = p().textClips.find((c) => c.id === title.clip_id);
  assert.equal(t.font, 'montserrat'); assert.equal(t.animIn.id, 'fade'); assert.equal(t.animOut.id, 'zoomOut');
  ok(await run('edit_text', { clip_id: title.clip_id, font: 'ANTON', anim_in: 'slide-up' }), 'edit_text accepts the same spellings');
  assert.equal(p().textClips.find((c) => c.id === title.clip_id).font, 'anton');
  err(await run('add_text', { text: 'x', font: 'Comic Neue' }), /Unknown font "Comic Neue"/, 'unknown fonts still fail');
  const wrongTool = await run('set_animation', { clip_id: title.clip_id, in: 'fade' });
  err(wrongTool, /is a title.*Titles animate with edit_text \(anim_in, anim_out, anim_loop\)/, 'set_animation on a title names the right tool');
  err(await run('add_keyframes', { clip_id: title.clip_id, property: 'scale', keyframes: [{ time_sec: 0, value: 1 }] }), /Titles are placed and styled with edit_text/, 'other picture tools name edit_text too');
  ok(await run('set_animation', { clip_id: 'a', in: 'fade', out: 'zoomOut' }), 'clip animations accept the title spellings');
  const anim = (p().videoClips.find((c) => c.id === 'a') || {}).anim;
  assert.equal(anim.in.type, 'fade_in'); assert.equal(anim.out.type, 'zoom_out');
  // Keyframe times counted from the clip's start get the conversion.
  const later = p().videoClips.find((c) => c.id === 'b'), startB = videoLayout(p().videoClips).find((l) => l.clip.id === 'b').start;
  const kf = await run('add_keyframes', { clip_id: 'b', property: 'scale', keyframes: [{ time_sec: 0, value: 1 }, { time_sec: 2, value: 1.2 }] });
  assert.ok(startB > 0.01, 'clip b starts after the timeline start');
  err(kf, new RegExp(`time_sec is timeline time; these times fit if counted from the clip's start, so add ${Math.round(startB * 100) / 100}s to each`), 'keyframes from the clip start get the conversion');
  assert.ok(later);
}

// A failed voice-over is replaced by add_narration naming it in retry_of (one id or a list).
const failed = { name: 'add_voiceover', key: editTarget('add_voiceover', { text: 'Line two', engine: 'gemini' }) };
assert.ok(clearsFailure('op-1', failed, 'add_narration', { lines: ['Line one', 'Line two'], retry_of: ['op-1', 'op-2'] }));
assert.ok(clearsFailure('op-1', failed, 'add_voiceover', { text: 'Line two', engine: 'gemini', model: 'gemini-3.8-flash-lite-tts', retry_of: 'op-1' }));
assert.ok(clearsFailure('op-1', failed, 'add_voiceover', { text: 'Line two', engine: 'gemini' }), 'the same call again');
assert.ok(!clearsFailure('op-1', failed, 'add_narration', { lines: ['Line one', 'Line two'] }), 'only when it names the failure');
assert.ok(clearsFailure('op-1', failed, 'edit_text', { clip_id: 't1', anim_in: 'fade', retry_of: 'op-1' }), 'any tool can stand in when it names the failure');
assert.ok(!clearsFailure('op-1', failed, 'add_sound', { sound_id: 's1' }), 'a call that does not name it never resolves it');
assert.ok(!clearsFailure('op-1', failed, 'add_sound', { sound_id: 's1', retry_of: 'op-2' }), 'naming another failure does not resolve this one');
// Failures on clips deleted since stop blocking; clips that never existed are not counted.
{
  const project = { videoClips: [{ id: 'v1' }], textClips: [{ id: 't1' }], overlayClips: [], audioClips: [] };
  assert.deepEqual(failureTargets({ clip_id: 't1', clip_ids: ['v1', 'ghost'] }, project), ['t1', 'v1']);
  const failures = new Map([['a', { name: 'set_animation', targets: ['t1'] }], ['b', { name: 'add_text', targets: [] }], ['c', { name: 'trim_clip', targets: ['t1', 'v1'] }]]);
  assert.deepEqual(pruneFailures(failures, { ...project, textClips: [] }), ['a'], 'only failures whose every target is gone');
  assert.deepEqual([...failures.keys()], ['b', 'c']);
  const report = unresolvedReport(failures);
  assert.deepEqual(report.unresolved_operations.map((o) => o.failed_operation_id), ['b', 'c']);
  assert.match(report.error, /2 failed operations not resolved: b \(add_text\)/); assert.match(report.how_to_resolve, /retry_of/);
}

console.log(`AGENT TOOLS OK (${names.length} tools)`);
