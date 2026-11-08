// Editorial engine and tools: fillers, retakes, highlights, footage log, edit
// plans, critique, completion gate inputs and beat grids, against the real
// reducer with a faked transcription/analysis host.
// Usage: node tests/unit/agents/test-editorial.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, exportDuration } from '../../../src/state/store.js';
import { createToolRunner, TOOL_DECLARATIONS } from '../../../src/features/agent/tools.js';
import { TOOL_GROUPS, CORE_TOOLS } from '../../../src/features/agent/toolCatalog.js';
import { transcriptWords, findFillers, findRetakes, sentences, wordCuts, remapWords, hookCandidates, critiqueProject, introducedIssues } from '../../../src/features/agent/editorial.js';
import { describeToolActivity } from '../../../src/features/agent/toolActivity.js';

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
// Words: [text, start, end]; measured timing.
const seg = list => ({ start: list[0][1], end: list.at(-1)[2], text: list.map(w => w[0]).join(' '), word_timing: 'measured', words: list.map(([text, start, end]) => ({ text, start, end, timing: 'measured' })) });

const SEGMENTS = [
  seg([['So', 0.2, 0.4], ['um', 0.5, 0.8], ['today', 0.9, 1.2], ['we', 1.25, 1.4], ['test', 1.45, 1.8], ['this.', 1.85, 2.2]]),
  seg([['The', 3.0, 3.2], ['best', 3.25, 3.5], ['way', 3.55, 3.8], ['is', 3.85, 4.0]]),
  seg([['The', 4.6, 4.8], ['best', 4.85, 5.1], ['way', 5.15, 5.4], ['is', 5.45, 5.6], ['to', 5.65, 5.8], ['cut', 5.85, 6.1], ['retakes.', 6.15, 6.6]]),
  seg([['Why', 7.0, 7.2], ['do', 7.25, 7.4], ['most', 7.45, 7.7], ['edits', 7.75, 8.0], ['fail', 8.05, 8.3], ['in', 8.35, 8.45], ['3', 8.5, 8.7], ['seconds?', 8.75, 9.3]]),
  seg([['uh', 9.6, 9.9], ['I', 10.0, 10.1], ['I', 10.2, 10.3], ['think', 10.35, 10.7], ['so.', 10.75, 11.0]]),
];

await check('fillers are hesitations by default; discourse markers only on request', () => {
  const words = transcriptWords([...SEGMENTS, seg([['you', 12, 12.2], ['know', 12.25, 12.5], ['right.', 12.6, 12.9]])]);
  assert.deepEqual(findFillers(words).map(f => f.text), ['um', 'uh']);
  assert.deepEqual(findFillers(words, { discourse: true }).map(f => f.text), ['um', 'uh', 'you know']);
  // Darija "yes" and Arabic "mother" are words, not fillers.
  const ar = transcriptWords([seg([['آه', 0, 0.3], ['امم', 0.4, 0.8], ['ام', 0.9, 1.1], ['يعني', 1.2, 1.5]])]);
  assert.deepEqual(findFillers(ar, { language: 'ar' }).map(f => f.text), ['امم']);
  assert.deepEqual(findFillers(ar, { language: 'ar', discourse: true }).map(f => f.text), ['امم', 'يعني']);
});

await check('retakes keep the later take; stutters drop the first repeat', () => {
  const words = transcriptWords(SEGMENTS), found = findRetakes(words);
  const restart = found.find(r => r.kind === 'restart');
  assert.equal(restart.removed, 'The best way is'); assert.match(restart.kept, /^The best way is to cut/);
  near(restart.start, 3.0); near(restart.end, 4.6);
  const stutter = found.find(r => r.kind === 'stutter');
  assert.equal(stutter.removed, 'I'); near(stutter.start, 10.0); near(stutter.end, 10.2);
});

await check('word cuts never clip neighbouring words and align to frames', () => {
  const words = transcriptWords(SEGMENTS), { cuts } = wordCuts(findFillers(words), words, { total: 11, fps: 30, handle_sec: 0.04 });
  assert.equal(cuts.length, 2);
  for (const c of cuts) {
    assert.ok(Math.abs(c.start * 30 - Math.round(c.start * 30)) < 1e-6 && Math.abs(c.end * 30 - Math.round(c.end * 30)) < 1e-6);
    assert.ok(!words.some(w => !['um', 'uh'].includes(w.text) && w.start < c.end && w.end > c.start), 'a kept word overlaps a cut');
  }
  const estimated = wordCuts([{ start: 1, end: 2, estimated: true }], words, { total: 11 });
  assert.equal(estimated.cuts.length, 0); assert.equal(estimated.skipped[0].reason, 'estimated word timing');
});

await check('remapped words follow ripple cuts', () => {
  const words = [{ text: 'a', start: 0, end: 1 }, { text: 'b', start: 2, end: 3 }, { text: 'c', start: 4, end: 5 }];
  const out = remapWords(words, [{ start: 1.5, end: 3.5 }]);
  assert.deepEqual(out.map(w => w.text), ['a', 'c']); near(out[1].start, 2); near(out[1].end, 3);
});

await check('hook candidates prefer questions, numbers and strong words', () => {
  const ranked = hookCandidates(sentences(transcriptWords(SEGMENTS)));
  assert.match(ranked[0].text, /^Why do most edits fail/); assert.ok(ranked[0].reasons.includes('question'));
});

// ---------- Tools against the real reducer ----------
const base = () => ({ past: [], future: [], present: { ...normalizeProject({}), fps: 30, ratio: '16:9', width: 1920, height: 1080,
  media: [{ id: 'm', name: 'talk.mp4', type: 'video', duration: 20, width: 1920, height: 1080, hasAudio: true, path: '/tmp/talk.mp4' },
    { id: 'song', name: 'song.mp3', type: 'audio', duration: 20, path: '/tmp/song.mp3' }],
  videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 12, speed: 1, volume: 1 }],
  textClips: [{ id: 'c1', caption: true, text: 'Why do most edits fail', start: 7, duration: 2.3, y: 0.8 }] } });
let state = base(), transcriptions = 0, loudnessCalls = 0;
const captionOptions = [];
const ctx = { getProject: () => state.present, dispatch: a => { state = historyReducer(state, a); }, settle: async () => {},
  api: {
    runCaptions: async (_p, options) => { transcriptions++; captionOptions.push(options); return { ok: true, segments: structuredClone(SEGMENTS) }; },
    agentLoudness: async () => { loudnessCalls++; return { ok: true, integrated_lufs: -9.5, true_peak_db: -0.2 }; },
    agentBeats: async (_p, opts) => ({ ok: true, bpm: 120, tempo_confidence: 0.8, beats: [0.5, 1, 1.5, 2], downbeats: [0.5, 2.5], accents: [0.5], downbeat_method: 'estimated', analyzed_sec: opts.end_sec ? opts.end_sec - (opts.start_sec || 0) : 20 }),
  } };
const runner = createToolRunner(ctx);

await check('editorial tools are declared, grouped and the plan/guide are core', () => {
  for (const name of ['log_footage', 'remove_fillers', 'remove_retakes', 'find_highlights', 'propose_edit_plan', 'edit_guide', 'critique_edit', 'get_beats'])
    assert.ok(TOOL_DECLARATIONS.some(t => t.name === name), name);
  assert.ok(TOOL_GROUPS.editorial.includes('log_footage') && TOOL_GROUPS.audio.includes('get_beats'));
  // Editorial tools live in their group: the always-loaded core stays small for free-tier providers.
  assert.ok(!CORE_TOOLS.includes('edit_guide') && TOOL_GROUPS.editorial.includes('edit_guide') && TOOL_GROUPS.editorial.includes('propose_edit_plan'));
});

await check('edit_guide returns the workflow and genre recipes', async () => {
  const flow = await runner.run('edit_guide', { topic: 'workflow' });
  assert.match(flow.guide, /log_footage/); assert.match((await runner.run('edit_guide', { topic: 'tiktok' })).guide, /9:16/);
  assert.ok((await runner.run('edit_guide', { topic: 'nope' })).error);
});

await check('log_footage lists sentences with shot-free flags from one transcription', async () => {
  const log = await runner.run('log_footage', { include_scenes: false });
  assert.equal(log.error, undefined); assert.equal(log.changed, undefined);
  assert.equal(log.fillers.count, 2); assert.equal(log.retakes.length, 1); assert.equal(log.stutters, 1);
  assert.ok(log.sentences.find(s => s.text.startsWith('The best way is')).flags.some(f => /false start/.test(f)));
  assert.ok(log.hook_candidates.length > 0);
  assert.equal(transcriptions, 1);
});

await check('remove_fillers dry run edits nothing; apply ripples captions and reuses the transcript', async () => {
  const before = state.present;
  const dry = await runner.run('remove_fillers', { dry_run: true });
  assert.equal(dry.cuts, 2); assert.equal(state.present, before);
  const applied = await runner.run('remove_fillers', {});
  assert.equal(applied.status, 'applied'); assert.equal(applied.removed_count, 2);
  // Each cut takes the filler plus up to 0.25 s of the pause around it.
  assert.ok(applied.removed_sec > 0.6 && applied.removed_sec < 1.1, String(applied.removed_sec));
  near(exportDuration(state.present), 12 - applied.removed_sec, 0.006); // removed_sec is rounded to 0.01
  // Only the first filler (0.5–0.8 s) precedes the caption at 7 s.
  assert.ok(state.present.textClips[0].start > 6.55 && state.present.textClips[0].start < 6.7, String(state.present.textClips[0].start));
  assert.equal(transcriptions, 1, 'remapped words, no second transcription');
  assert.equal((await runner.run('remove_fillers', {})).removed_count, 0);
});

await check('remove_retakes previews, rejects stale ids and removes the chosen take', async () => {
  const dry = await runner.run('remove_retakes', { dry_run: true });
  const restart = dry.candidates.find(c => c.kind === 'restart');
  assert.ok(restart && dry.selected.includes(restart.id));
  assert.match((await runner.run('remove_retakes', { retake_ids: ['r99'] })).error, /unknown/);
  const length = exportDuration(state.present);
  const applied = await runner.run('remove_retakes', { retake_ids: [restart.id] });
  assert.equal(applied.status, 'applied'); assert.ok(exportDuration(state.present) < length - 1.2);
  const again = await runner.run('remove_retakes', { dry_run: true });
  assert.ok(!again.candidates.some(c => c.kind === 'restart'));
  assert.equal(transcriptions, 1);
});

await check('find_highlights returns windows ending on sentence boundaries', async () => {
  const res = await runner.run('find_highlights', { clip_length_sec: 5 });
  assert.match(res.candidates[0].text, /^Why/);
  const w = res.windows[0]; assert.ok(w.end_sec > w.start_sec && w.end_sec <= exportDuration(state.present));
});

await check('propose_edit_plan is non-mutating and yields a sanitized plan card', async () => {
  const before = state.present;
  const args = { goal: 'A 30 s TikTok', platform: 'tiktok', target_duration_sec: 30, hook: 'Open on the question', story: [{ start_sec: 7, end_sec: 9, note: 'Hook\u0000 question' }, { note: '' }], cuts: ['Fillers', 3] };
  const res = await runner.run('propose_edit_plan', args);
  assert.equal(res.status, 'awaiting_approval'); assert.equal(state.present, before);
  const activity = describeToolActivity('propose_edit_plan', args, before, res, before);
  assert.equal(activity.plan.story.length, 1); assert.equal(activity.plan.story[0].note, 'Hook  question'); assert.deepEqual(activity.plan.cuts, ['Fillers']);
  assert.ok((await runner.run('propose_edit_plan', { goal: 'x' })).error);
});

await check('critique_edit reports loudness, music level, caption speed and pacing', async () => {
  dispatch({ type: 'addToTimeline', mediaId: 'song', clipId: 'music', at: 0 });
  dispatch({ type: 'update', track: 'text', id: 'c1', patch: { text: 'Why do most video edits fail within the first three seconds of play', duration: 1 } });
  const res = await runner.run('critique_edit', { target_duration_sec: 30 });
  const codes = res.issues.map(i => i.code);
  for (const code of ['loudness', 'clipping', 'music_level', 'caption_speed', 'duration']) assert.ok(codes.includes(code), code);
  // Adding music changed the audible mix, so the cached transcript no longer applies.
  assert.equal(res.checked.speech, false); assert.match(res.speech_note, /no transcript/); assert.equal(res.checked.loudness, true); assert.equal(loudnessCalls, 1);
  assert.equal(transcriptions, 1, 'critique never transcribes unless asked');
  assert.ok(res.score < 80);
  const order = { high: 0, medium: 1, low: 2 };
  assert.ok(res.issues.every((issue, i) => !i || order[res.issues[i - 1].severity] <= order[issue.severity]));
});
function dispatch(a) { state = historyReducer(state, a); }

await check('critique flags gaps, a static opening and captions outside the safe area', () => {
  const p = { ...normalizeProject({}), fps: 30, width: 1080, height: 1920, ratio: '9:16', media: [{ id: 'm', type: 'video', duration: 40, width: 1080, height: 1920 }],
    videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 20, speed: 1 }, { id: 'g', gap: true, in: 0, out: 1, speed: 1 }, { id: 'b', mediaId: 'm', in: 20, out: 30, speed: 1 }],
    textClips: [{ id: 'c', caption: true, text: 'Hi', start: 4, duration: 2, y: 0.9 }] };
  const codes = critiqueProject(p).issues.map(i => i.code);
  for (const code of ['gap', 'hook', 'static', 'caption_safe_area']) assert.ok(codes.includes(code), code);
});

await check('completion gate reports only structural issues the request introduced', () => {
  const p = { ...normalizeProject({}), fps: 30, width: 1920, height: 1080, media: [{ id: 'm', type: 'video', duration: 40, width: 1920, height: 1080 }],
    videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1 }, { id: 'b', mediaId: 'm', in: 6, out: 9, speed: 1 }], textClips: [{ id: 't', text: 'Hook', start: 0, duration: 2 }] };
  assert.deepEqual(introducedIssues(p, p), []);
  const worse = { ...p, textClips: [...p.textClips, { id: 'c', caption: true, text: 'A caption far too long to read in so little time on screen', start: 3, duration: 0.8, y: 0.8 }] };
  assert.deepEqual(introducedIssues(p, worse).map(i => i.code), ['caption_speed']);
});

await check('one call normalizes every piece of a cut talking head; critique names that call', async () => {
  const ids = state.present.videoClips.filter(c => !c.gap).map(c => c.id);
  assert.ok(ids.length >= 3, 'filler and retake cuts split the main clip');
  const loud = await runner.run('critique_edit', {});
  const fix = loud.issues.find(i => i.code === 'loudness').fix;
  assert.match(fix, /clip_ids/); assert.ok(ids.every(id => fix.includes(id)));
  const before = state.present;
  assert.match((await runner.run('set_audio_effects', { clip_ids: [...ids, 'nope'], loudnorm: true })).error, /nope/);
  assert.equal(state.present, before, 'an invalid id writes nothing');
  const res = await runner.run('set_audio_effects', { clip_ids: ids, loudnorm: true, limit: true });
  assert.equal(res.status, 'applied'); assert.equal(res.clips, ids.length);
  assert.ok(state.present.videoClips.filter(c => !c.gap).every(c => c.audioFx.loudnorm && c.audioFx.limit));
  assert.match((await runner.run('critique_edit', {})).issues.find(i => i.code === 'loudness').fix, /already on every speech clip/);
});

await check('get_beats passes the selection and bounds long grids', async () => {
  const res = await runner.run('get_beats', { clip_ids: ['music'], end_sec: 8 });
  assert.equal(res.bpm, 120); assert.equal(res.beat_sec, 0.5); assert.deepEqual(res.downbeats.values, [0.5, 2.5]); assert.equal(res.analyzed_sec, 8);
  const missing = createToolRunner({ ...ctx, api: {} });
  assert.match((await missing.run('get_beats', {})).error, /updated ClipCraft/);
});

await check('editorial speech is verbatim and cached apart from caption transcripts', async () => {
  assert.equal(captionOptions[0].verbatim, true);
  const plain = createToolRunner({ ...ctx, api: { ...ctx.api, runCaptions: async (_p, options) => { captionOptions.push(options); return { ok: true, segments: structuredClone(SEGMENTS) }; } } });
  await plain.run('transcribe', {});
  assert.equal(captionOptions.at(-1).verbatim, undefined);
  const { createRequire } = await import('node:module');
  const { TranscriptCache } = createRequire(import.meta.url)('../../../electron/audio/transcriptCache.cjs');
  const cache = new TranscriptCache('/tmp/clipcraft-unused-cache');
  const p = { media: [{ id: 'm', type: 'video', path: new URL(import.meta.url).pathname, hasAudio: true, duration: 5 }], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 5, speed: 1 }], audioClips: [], overlayClips: [] };
  assert.notEqual(cache.key(p, { verbatim: true }), cache.key(p, {}));
  assert.equal(cache.key(p, { verbatim: false }), cache.key(p, {}), 'existing caption cache keys are unchanged');
});

await check('eval scoring combines critique and expectations; runs compare by case', async () => {
  const { scoreEvalCase, toolProfile, compareRuns } = await import('../../../src/features/agent/evalScore.js');
  const p = { ...normalizeProject({}), fps: 30, ratio: '9:16', width: 1080, height: 1920, media: [{ id: 'm', type: 'video', duration: 30, width: 1080, height: 1920 }],
    videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 4, speed: 1 }, { id: 'b', mediaId: 'm', in: 6, out: 10, speed: 1 }],
    textClips: [{ id: 't', text: 'Stop doing this', start: 0, duration: 2.5, y: 0.3 }, { id: 'c', caption: true, text: 'Stop doing this', start: 0, duration: 1.5, y: 0.72 }] };
  const words = transcriptWords([seg([['Stop', 0.1, 0.4], ['doing', 0.45, 0.8], ['this.', 0.85, 1.2]])]);
  const steps = [{ name: 'propose_edit_plan', status: 'done' }, { name: 'remove_fillers', status: 'done' }, { name: 'remove_fillers', status: 'error' }];
  const res = scoreEvalCase(p, { words, expect: { ratio: '9:16', max_duration_sec: 30, captions: true, hook_title: true, max_fillers: 0, plan_proposed: true, music: true }, steps });
  assert.equal(res.expectations_total, 7); assert.deepEqual(res.checks.filter(c => !c.pass).map(c => c.name), ['music bed present']);
  assert.equal(res.score, Math.round(res.critique_score * 0.6 + (6 / 7) * 40));
  assert.deepEqual(toolProfile(steps).remove_fillers, { calls: 2, failed: 1 });
  assert.deepEqual(compareRuns({ cases: [{ id: 'x', score: 70 }] }, { cases: [{ id: 'x', score: 64 }] })[0], { id: 'x', score: 70, previous: 64, delta: 6 });
});

console.log(`${checks.length} editorial checks passed`);
