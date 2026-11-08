import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { audioAutomationFilters } from '../../../electron/audio/fades.cjs';
import { audioGain, volumeAt } from '../../../src/features/audio/fades.js';
import { emptyProject, historyReducer, videoLayout } from '../../../src/state/store.js';
import { audioRevision } from '../../../src/features/agent/context.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-audio-finishing-'));
const runFF = args => execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', ...args], { maxBuffer: 32 * 1024 * 1024 });
const tone = path.join(dir, 'tone.wav'), speech = path.join(dir, 'speech.wav');
runFF(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', tone]);
runFF(['-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,3)+between(t,5,6),0.2*sin(2*PI*880*t),0)':s=48000:d=8", speech]);
let state = { past: [], future: [], present: { ...emptyProject(), id: 'audio-finishing', media: [
  { id: 'tone', type: 'audio', path: tone, hasAudio: true, duration: 8, channels: 1 },
  { id: 'speech', type: 'audio', path: speech, hasAudio: true, duration: 8, channels: 1 },
], videoClips: [{ id: 'gap', gap: true, in: 0, out: 8 }], audioClips: [
  { id: 'bed', mediaId: 'tone', in: 0, out: 8, start: 0, volume: .5 },
  { id: 'voice', mediaId: 'speech', in: 0, out: 8, start: 0, layer: 1 },
] } };
let active = true;
const runner = createToolRunner({ getProject: () => state.present, dispatch: a => { state = historyReducer(state, a); }, settle: async () => {}, editActive: () => active, requestId: 'audio-finish',
  api: { agentSilences: async (p, options) => {
    assert.deepEqual(options.clip_ids, ['voice']);assert.equal(options.requestId, 'audio-finish');
    return { silences: await ff.detectSilences(p, options) };
  } },
});
const ok = async (name, args) => { const r = await runner.run(name, args);assert.ok(!r.error, r.error);return r; };
const bad = async (name, args, pattern) => { const before = JSON.stringify(state.present);const r = await runner.run(name, args);assert.match(r.error || '', pattern);assert.equal(JSON.stringify(state.present), before); };
const near = (a, b, eps = .04) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
await ok('set_audio_effects', { clip_id: 'voice', preset: 'clear-voice', limit: true, eq: { high: 1 } });
assert.equal(state.present.audioClips[1].audioFx.denoise, true);assert.equal(state.present.audioClips[1].audioFx.limit, true);assert.equal(state.present.audioClips[1].audioFx.eq.high, 1);
await bad('set_audio_effects', { clip_id: 'voice', eq: { mid: 16 } }, /eq.mid/);
await bad('set_audio_effects', { clip_id: 'voice', preset: 'invented' }, /preset/);
await ok('set_audio_effects', { clip_id: 'voice', preset: 'none' });
const rev = audioRevision(state.present), key = ff.audioAnalysisKey(state.present);
await ok('set_volume_envelope', { clip_id: 'bed', points: [{ time_sec: 0, value: 1 }, { time_sec: 2, value: .2 }, { time_sec: 4, value: 1 }] });
assert.notEqual(audioRevision(state.present), rev);assert.notEqual(ff.audioAnalysisKey(state.present), key);
near(audioGain(state.present.audioClips[0], 1, 8), .3);
await bad('set_volume_envelope', { clip_id: 'bed', points: [{ time_sec: 1, value: .2 }, { time_sec: 0, value: 1 }] }, /ordered/);
await bad('set_volume_envelope', { clip_id: 'bed', points: [{ time_sec: 9, value: .2 }] }, /inside/);
await ok('set_volume_envelope', { clip_id: 'bed', points: [] });
const result = await ok('duck_audio', { target_clip_ids: ['bed'], speech_clip_ids: ['voice'], duck_volume: .2, attack_sec: .15, release_sec: .4 });
assert.equal(result.speech_intervals, 2);
const bed = structuredClone(state.present.audioClips[0]);
near(volumeAt(bed.volumeKeys, 1), 1);near(volumeAt(bed.volumeKeys, 2.5), .2);near(volumeAt(bed.volumeKeys, 4), 1);near(volumeAt(bed.volumeKeys, 5.5), .2);
await bad('duck_audio', { target_clip_ids: ['bed'], speech_clip_ids: ['bed'] }, /overlap/);
const isolated = { ...state.present, audioClips: [bed] };
const wav = path.join(dir, 'ducked.wav');await ff.renderTimelineAudio(isolated, wav);
const pcm = runFF(['-i', wav, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-']);
const rms = (start, end) => { let sum = 0, count = 0;for (let i = Math.round(start * 16000); i < Math.round(end * 16000); i++) { sum += pcm.readFloatLE(i * 4) ** 2;count++; }return Math.sqrt(sum / count); };
near(rms(2.3, 2.7) / rms(.5, .9), .2, .015);near(rms(4, 4.5) / rms(.5, .9), 1, .015);
const encodeArgs = ff.buildAudioExportArgs(isolated, path.join(dir, 'export.wav'), 'wav');runFF(encodeArgs);
const exported = runFF(['-i', path.join(dir, 'export.wav'), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-']);
let delta = 0;for (let i = 0; i < Math.min(exported.length, pcm.length); i += 4) delta += (exported.readFloatLE(i) - pcm.readFloatLE(i)) ** 2;
assert.ok(Math.sqrt(delta / (pcm.length / 4)) < .001, 'analysis and real audio export preserve the same automation');
await ok('split_at', { clip_id: 'bed', time_sec: 4 });
const right = state.present.audioClips.find(c => c.mediaId === 'tone' && c.start === 4);
assert.deepEqual(right.volumeKeys, bed.volumeKeys);near(audioGain(right, 1.5, 4), .1);
await ok('set_speed', { clip_id: right.id, speed: 2 });
near(audioGain(state.present.audioClips.find(c => c.id === right.id), .75, 2), .1);
state = historyReducer(state, { type: 'setLayerState', track: 'audio', layer: 0, patch: { locked: true } });
await bad('set_volume_envelope', { clip_id: right.id, points: [] }, /locked/);
active = false;await bad('set_audio_effects', { clip_id: 'voice', preset: 'podcast' }, /outside this request|no longer owns/);
// Stress the actual parser at the declared limit; avoid unbounded nesting.
const keys = Array.from({ length: 512 }, (_, i) => ({ t: i / 64, v: i % 2 ? .2 : 1 }));
runFF(['-i', tone, '-af', audioAutomationFilters({ volumeKeys: keys }).join(','), '-t', '0.2', '-f', 'null', '-']);
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, speech_intervals: result.speech_intervals, rendered_duck_ratio: rms(2.3, 2.7) / rms(.5, .9), evidence: dir }, null, 2));
console.log(`Audio finishing passed; actual activity detection, export/analysis gain, split/speed and locks: ${dir}`);
