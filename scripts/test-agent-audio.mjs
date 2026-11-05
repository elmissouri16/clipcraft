// Source-aware analysis against real FFmpeg, with injected speech inference only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../electron/ffmpeg.cjs';
import analysis from '../electron/audioAnalysis.cjs';
import { emptyProject, historyReducer, exportDuration, cutRanges } from '../src/store.js';
import { createToolRunner } from '../src/agent/tools.js';
import { regroupSegments } from '../src/subtitles.js';
import cloud from '../electron/cloudCaptions.cjs';
import whisper from '../electron/whisper.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-agent-audio-'));
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const runFF = args => execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 });
const near = (actual, expected, epsilon = .08) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not near ${expected}`);
const piece = (id, mediaId, extra = {}) => ({ id, mediaId, in: 0, out: 4, speed: 1, volume: 1, ...extra });
try {
  const source = path.join(dir, 'talk.wav'), music = path.join(dir, 'music.wav'), enhanced = path.join(dir, 'enhanced.wav');
  runFF(['-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,2),0,0.2*sin(2*PI*440*t))':s=16000:d=4", source]);
  runFF(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=16000:duration=4', music]);
  runFF(['-f', 'lavfi', '-i', "aevalsrc='if(lt(t,2),0,0.2*sin(2*PI*440*t))':s=16000:d=4", enhanced]);
  const p = { ...emptyProject(), id: 'audio-test', media: [
    { id: 'voice', type: 'video', path: source, name: 'Talk', duration: 4, hasAudio: true, channels: 1 },
    { id: 'music', type: 'audio', path: music, name: 'Music', duration: 4, hasAudio: true, channels: 1 },
  ], videoClips: [piece('v', 'voice', { muted: true })], audioClips: [piece('detached', 'voice', { start: 0 })] };
  const silence = await ff.detectSilences(p);
  check('default full mix detects real detached-audio pause', () => { assert.equal(silence.length, 1); near(silence[0].start, 1); near(silence[0].end, 2); });
  await assert.rejects(ff.detectSilences(p, { source: 'video' }), /No audible/); checks.push('muted main-only selection rejects synthetic silence');
  const overlay = { ...p, audioClips: [], overlayClips: [piece('ov', 'voice', { start: 0 })] };
  const overlaySilence = await ff.detectSilences(overlay, { source: 'overlay' });
  check('overlay speech is analysed', () => near(overlaySilence[0].start, 1));
  for (const state of [{ hidden: true }, { muted: true }]) assert.throws(() => ff.analysisAudioPlan({ ...overlay, layerState: { 'overlay:0': state } }), /No audible/);
  assert.throws(() => ff.analysisAudioPlan({ ...overlay, overlayClips: [{ ...overlay.overlayClips[0], disabled: true }] }), /No audible/);
  checks.push('disabled, hidden and muted audio are excluded');
  const mixed = { ...p, audioClips: [...p.audioClips, piece('bed', 'music', { start: 0 })] };
  assert.equal((await ff.detectSilences(mixed)).length, 0);
  const selected = await ff.detectSilences(mixed, { source: 'audio', clip_ids: ['detached'] });
  check('clip selection excludes music without shifting time', () => near(selected[0].start, 1));
  const solo = { ...mixed, audioClips: [mixed.audioClips[0], { ...mixed.audioClips[1], layer: 1 }], layerState: { 'audio:0': { solo: true } } };
  check('solo matches the audible mix', () => assert.equal(ff.analysisAudioPlan(solo).sounding.length, 1));
  assert.throws(() => ff.analysisAudioPlan(p, { clip_ids: ['missing'] }), /no longer exists/);
  assert.throws(() => ff.analysisAudioPlan(p, { source: 'guess' }), /Audio source/);
  checks.push('invalid selectors fail before rendering');
  const withEnhance = { ...p, videoClips: [piece('v', 'voice', { enhance: { on: true, path: enhanced, from: 0, to: 4 } })], audioClips: [] };
  const enhanceSilence = await ff.detectSilences(withEnhance);
  check('enhanced audio replaces original source', () => { near(enhanceSilence[0].start, 0); near(enhanceSilence[0].end, 2); });
  const shifted = { ...overlay, overlayClips: [piece('ov', 'music', { start: 2, speed: 2 })] };
  const shiftedWav = path.join(dir, 'shifted.wav'); await ff.renderTimelineAudio(shifted, shiftedWav, 'overlay');
  check('overlay position and speed preserve timeline seconds', () => { const args = ff.buildTimelineAudioArgs(shifted, shiftedWav, 'overlay').join(' '); assert.match(args, /atempo=2/); assert.match(args, /adelay=2000/); });
  const faded = { ...p, audioClips: [piece('fade', 'music', { start: 0, fadeIn: 2, fadeOut: 1 })] };
  const fadeWav = path.join(dir, 'fade.wav'); await ff.renderTimelineAudio(faded, fadeWav);
  const pcm = runFF(['-i', fadeWav, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-']);
  const rms = (start, end) => { let sum = 0, count = 0; for (let i = Math.round(start * 16000); i < Math.round(end * 16000); i++) { sum += pcm.readFloatLE(i * 4) ** 2; count++; } return Math.sqrt(sum / count); };
  check('analysis renders audible fades', () => { assert.ok(rms(.1, .2) < rms(2.1, 2.2) / 5); assert.ok(rms(3.8, 3.9) < rms(2.1, 2.2) / 3); });
  await assert.rejects(ff.renderTimelineAudio(p, path.join(dir, 'canceled.wav'), { signal: AbortSignal.abort() }), error => error.name === 'AbortError'); checks.push('audio decoding honors cancellation');
  let state = { past: [], future: [], present: structuredClone(p) };
  const ctx = { getProject: () => state.present, dispatch: action => { state = historyReducer(state, action); }, settle: async () => {}, requestId: 'audio-request',
    api: { agentSilences: async (project, options) => { assert.equal(options.requestId, 'audio-request'); return { ok: true, silences: await ff.detectSilences(project, options) }; } } };
  const runner = createToolRunner(ctx);
  const removed = await runner.run('remove_silences', { keep_padding_sec: 0 });
  check('agent removes only actual detached-audio silence and ripples sound', () => { assert.equal(removed.ok, true); near(exportDuration(state.present), 3); assert.equal(state.present.audioClips.length, 2); });
  let inference = 0, renders = 0;
  const segments = Array.from({ length: 450 }, (_, i) => ({ start: i * .008, end: i * .008 + .007, text: `word${i}`,
    words: [{ text: `word${i}`, start: i * .008, end: i * .008 + .007, timing: 'measured' }], word_timing: 'measured' }));
  const service = analysis.createTranscriptService({ cacheDir: path.join(dir, 'cache'), whisperDir: path.join(dir, 'whisper'),
    whisper: { MODELS: { base: {} }, install: async () => {}, transcribe: async () => { inference++; return structuredClone(segments); } },
    renderAudio: async (...args) => { renders++; return ff.renderTimelineAudio(...args); } });
  let speechState = { past: [], future: [], present: structuredClone(p) };
  const speechCtx = { getProject: () => speechState.present, dispatch: action => { speechState = historyReducer(speechState, action); }, settle: async () => {}, requestId: 'speech-request',
    api: { runCaptions: (project, options) => service.run(project, options) } };
  const speechRunner = createToolRunner(speechCtx);
  const first = await speechRunner.run('transcribe', { limit: 100 });
  const tail = await speechRunner.run('transcribe', { offset: 400, limit: 100 });
  check('transcript paging retains every segment and measured word', () => { assert.equal(first.next_offset, 100); assert.equal(tail.segments.length, 50); assert.equal(tail.segments[49].text, 'word449'); assert.equal(tail.segments[0].words[0].timing, 'measured'); });
  const search = await speechRunner.run('transcribe', { query: 'word44', start_sec: 3.5, end_sec: 3.6 });
  check('query and timeline bounds filter before paging', () => { assert.equal(search.matched_segments, 10); assert.equal(search.segments[0].text, 'word440'); });
  speechCtx.dispatch({ type: 'setProject', patch: { name: 'Visual rename', background: '#ffffff' } });
  const caps = await speechRunner.run('add_captions', { words_per_caption: 3 });
  check('captions and visual edits reuse inference across calls', () => { assert.equal(caps.ok, true); assert.equal(inference, 1); assert.equal(renders, 1); assert.equal(caps.cached_transcript, true); });
  const reloadedService = analysis.createTranscriptService({ cacheDir: path.join(dir, 'cache'), whisperDir: '', whisper: { MODELS: { base: {} }, install: async () => assert.fail('cache should survive service recreation') } });
  assert.equal((await reloadedService.run(p, { maxLen: 0 })).cached, true); checks.push('transcript cache survives requests and service recreation');
  speechCtx.dispatch({ type: 'update', track: 'audio', id: 'detached', patch: { speed: 2 } });
  await speechRunner.run('transcribe', {});
  check('audio timing changes invalidate inference', () => assert.equal(inference, 2));
  const stat = fs.statSync(source); fs.utimesSync(source, stat.atime, new Date(stat.mtimeMs + 5000));
  await speechRunner.run('transcribe', {});
  check('source file replacements invalidate durable cache', () => assert.equal(inference, 3));
  await assert.rejects(service.run(p, {}, { signal: AbortSignal.abort() }), error => error.name === 'AbortError'); checks.push('transcription cancellation never returns cached success');
  let staleState = structuredClone(p);
  const stale = createToolRunner({ getProject: () => staleState, dispatch: () => assert.fail('stale result cannot edit'), settle: async () => {},
    api: { runCaptions: async () => { staleState = { ...staleState, audioClips: [{ ...staleState.audioClips[0], speed: 2 }] }; return { ok: true, segments }; } } });
  assert.match((await stale.run('add_captions', {})).error, /audible timeline changed/); checks.push('stale asynchronous transcription is rejected');
  const grouped = regroupSegments([{ start: 0, end: 10, text: 'one two three', words: [
    { text: 'one', start: .1, end: .3 }, { text: 'two', start: 4, end: 4.5 }, { text: 'three', start: 9, end: 9.5 } ] }], 2);
  check('caption regrouping uses actual uneven word boundaries', () => { assert.equal(grouped[0].end, 4.5); assert.equal(grouped[1].start, 9); assert.equal(grouped[1].words.length, 1); });
  const tokens = whisper.readSegments({ transcription: [{ offsets: { from: 0, to: 1000 }, text: 'one two', tokens: [
    { text: ' one', offsets: { from: 100, to: 200 } }, { text: ' two', offsets: { from: 800, to: 900 } } ] }] });
  check('local measured timing is distinguished from estimates', () => { assert.equal(tokens[0].word_timing, 'measured'); assert.equal(whisper.readPiece({ transcription: [{ text: 'hello' }] }, { from: 0, to: 1 })[0].word_timing, 'estimated'); });
  const cloudWords = cloud.parseWhisperJson({ segments: [{ start: 0, end: 2, text: 'Hello world' }], words: [{ word: 'Hello', start: .1, end: .3 }, { word: 'world', start: 1, end: 1.7 }] });
  const merged = cloud.mergeChunks([{ offset: 10, segments: cloudWords }]);
  check('cloud words survive parsing and chunk offsets', () => { assert.equal(merged[0].words[0].start, 10.1); assert.equal(merged[0].words[1].end, 11.7); });
  const captionProject = { ...p, textClips: [{ id: 'cap', caption: true, text: 'Human corrected caption', start: 2, duration: 2,
    words: [{ text: 'raw', start: 0, end: .5 }] }] };
  const shiftedCaption = cutRanges(captionProject, [{ start: 0, end: 1 }], { ripple: true }).textClips[0];
  check('moving a caption preserves human-corrected text', () => assert.equal(shiftedCaption.text, 'Human corrected caption'));
  const padding = cutRanges({ ...captionProject, textClips: [{ ...captionProject.textClips[0], start: 0, duration: 4 }] }, [{ start: 0, end: 1 }], { ripple: true });
  check('trimmed padding with no remaining caption words is omitted', () => assert.equal(padding.textClips.length, 0));
  check('short measured captions keep their actual duration without overlap', () => {
    let s = {past:[],future:[],present:structuredClone(p)};
    s = historyReducer(s,{type:'setCaptions',segments:[{id:'short1',start:0,end:.07,text:'one',word_timing:'measured'},{id:'short2',start:.1,end:.17,text:'two',word_timing:'measured'}]});
    near(s.present.textClips[0].duration,.07,.000001);assert.ok(s.present.textClips[0].start+s.present.textClips[0].duration<s.present.textClips[1].start);
  });
  check('fallback regroup timing is labelled estimated', () => {
    const guessed=regroupSegments([{start:0,end:4,text:'edited caption text',word_timing:'measured',words:[{text:'old',start:0,end:1}]}],1);
    assert.ok(guessed.every(s=>s.word_timing==='estimated'));
  });
  check('punctuation variations keep measured word alignment', () => {
    const grouped=regroupSegments([{start:0,end:2,text:'Hello, world!',word_timing:'measured',words:[{text:'Hello',start:.1,end:.4},{text:'world',start:1,end:1.4}]}],1);
    assert.equal(grouped[0].words[0].text,'Hello,');assert.equal(grouped[0].start,.1);assert.equal(grouped[1].words[0].text,'world!');assert.equal(grouped[1].word_timing,'measured');
  });
  const evidence = { ok: true, checks, inference, renders, detachedSilence: silence, overlaySilence, removedDuration: removed.removed_sec };
  if (process.env.AGENT_AUDIO_EVIDENCE) fs.writeFileSync(process.env.AGENT_AUDIO_EVIDENCE, JSON.stringify(evidence, null, 2));
  console.log(`agent audio ok (${checks.length} checks; real FFmpeg, source cache, paging, words, captions and cancellation)`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
