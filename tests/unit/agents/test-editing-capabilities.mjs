import assert from 'node:assert/strict';
import { emptyProject, normalizeProject, historyReducer, videoLayout } from '../../../src/state/store.js';
import { createToolRunner, TOOL_DECLARATIONS } from '../../../src/features/agent/tools.js';
import { createToolCatalog, CONTEXT_TOOLS } from '../../../src/features/agent/toolCatalog.js';
import { audioGain, volumeAt } from '../../../src/features/audio/fades.js';

const base = () => normalizeProject({ ...emptyProject(), id: 'editing-capabilities',
  media: [{ id: 'm', type: 'video', path: '/video.mp4', name: 'Video', duration: 40, width: 640, height: 360, hasAudio: true }],
  videoClips: [{ id: 'v', mediaId: 'm', in: 10, out: 20 }],
  overlayClips: [{ id: 'o', mediaId: 'm', in: 2, out: 10, start: 1, layer: 0,
    keyframes: { x: [{ t: 2, v: .4 }, { t: 10, v: .6 }] } }],
  audioClips: [{ id: 'a', mediaId: 'm', in: 0, out: 8, start: 1 }],
  textClips: [{ id: 't', text: 'Hello there', caption: true, start: 2, duration: 4, words: [{ text: 'Hello', start: 0, end: 1 }, { text: 'there', start: 2, end: 4 }] }],
});
let state, active = true, canceled = false, mediaCalls = [];
const reset = () => { state = { past: [], future: [], present: base() };active = true;canceled = false;mediaCalls = []; };
reset();
const runner = createToolRunner({ getProject: () => state.present,
  dispatch: action => { state = historyReducer(state, action); }, settle: async () => {},
  editActive: () => active, isCanceled: () => canceled, requestId: 'everyday-test',
  addProbed: item => { const m = { ...item, id: 'derived' };state = historyReducer(state, { type: 'addMedia', items: [m] });return m; },
  api: { agentMediaJob: async req => { mediaCalls.push(req);return req.action === 'frame'
    ? { path: '/frame.png', type: 'image', width: 640, height: 360 }
    : { path: '/reversed.mp4', type: 'video', duration: req.to - req.from, width: 640, height: 360 }; } },
});
const run = async (name, args) => { const result = await runner.run(name, args);assert.ok(!result.error, `${name}: ${result.error}`);return result; };
const blocked = async (name, args, pattern) => { const before = JSON.stringify(state.present);const result = await runner.run(name, args);assert.match(result.error || '', pattern);assert.equal(JSON.stringify(state.present), before, 'invalid requests never mutate'); };
assert.ok(!CONTEXT_TOOLS[0].description.includes('style (reel recipes)'));
assert.ok(createToolCatalog(TOOL_DECLARATIONS).load(['layers']).tools.includes('layer_tools'));

await run('layer_tools', { track: 'overlay', action: 'add', name: 'B-roll' });
assert.equal(state.present.layerNames.overlay[1], 'B-roll');
await run('clip_tools', { clip_id: 'o', action: 'set_layer', layer: 1 });
assert.equal(state.present.overlayClips[0].layer, 1);
await run('layer_tools', { track: 'overlay', action: 'move', layer: 1, to_layer: 0 });
assert.equal(state.present.overlayClips[0].layer, 0);
assert.equal(state.present.layerNames.overlay[0], 'B-roll');
await run('layer_tools', { track: 'overlay', action: 'update', layer: 0, locked: true });
await blocked('clip_tools', { clip_id: 'o', action: 'set_layer', layer: 1 }, /locked/);
await run('layer_tools', { track: 'overlay', action: 'update', layer: 0, locked: false, hidden: true });
assert.equal(state.present.layerState['overlay:0'].hidden, true);
await run('layer_tools', { track: 'overlay', action: 'update', layer: 0, hidden: false });
await blocked('layer_tools', { track: 'text', action: 'update', muted: true }, /Only picture/);
await blocked('layer_tools', { track: 'video', action: 'delete' }, /fixed layer/);

const split = await run('split_at', { clip_id: 'o', time_sec: 5 });
assert.equal(split.clip_ids.length, 2);assert.equal(state.present.overlayClips.length, 2);
assert.deepEqual(state.present.overlayClips.map(c => [c.start, c.in, c.out]), [[1, 2, 6], [5, 6, 10]]);
await run('set_speed', { clip_id: split.clip_ids[1], speed: 2 });
assert.equal(state.present.overlayClips.find(c => c.id === split.clip_ids[1]).start, 5);
assert.equal(state.present.overlayClips.find(c => c.id === split.clip_ids[1]).speed, 2);
await blocked('set_speed', { clip_id: 'a', speed: 0 }, /0.25/);
await run('set_speed', { clip_id: 'a', speed: .5 });assert.equal(state.present.audioClips[0].speed, .5);
const captionSplit = await run('split_at', { clip_id: 't', time_sec: 4 });
assert.equal(state.present.textClips.find(c => c.id === captionSplit.clip_ids[1]).text, 'there');
assert.deepEqual(state.present.textClips.find(c => c.id === captionSplit.clip_ids[1]).words.map(w => [w.start, w.end]), [[0, 2]]);

reset();
await run('clip_tools', { clip_id: 'o', action: 'link', partner_clip_id: 'a' });
assert.equal(state.present.audioClips[0].linkId, state.present.overlayClips[0].linkId);
await run('set_speed', { clip_id: 'a', speed: 2 });
assert.equal(state.present.overlayClips[0].speed, 2);assert.equal(state.present.audioClips[0].speed, 2);
await blocked('clip_tools', { clip_id: 'o', action: 'reverse' }, /Unlink/);
await run('clip_tools', { clip_id: 'a', action: 'unlink' });
assert.equal(state.present.audioClips[0].linkId, undefined);assert.equal(state.present.overlayClips[0].linkId, undefined);
state = historyReducer(state, { type: 'update', track: 'audio', id: 'a', patch: { start: 0 } });
await run('clip_tools', { clip_id: 'v', action: 'link', partner_clip_id: 'a' });
await run('set_speed', { clip_id: 'a', speed: 2 });
assert.equal(videoLayout(state.present.videoClips)[0].end, 5, 'linked main speed uses timeline retiming');

reset();
state.present.overlayClips[0].volumeKeys = [{ t: 0, v: 1 }, { t: 5, v: .2 }, { t: 40, v: 1 }];
const original = structuredClone(state.present.overlayClips[0]);
await run('clip_tools', { clip_id: 'o', action: 'reverse' });
assert.equal(mediaCalls[0].requestId, 'everyday-test');
assert.deepEqual([mediaCalls[0].from, mediaCalls[0].to], [2, 10]);
assert.equal(state.present.overlayClips[0].mediaId, 'derived');
assert.deepEqual(state.present.overlayClips[0].keyframes.x.map(k => k.t), [0, 8]);
for (const time of [0, 1, 4, 7.5]) assert.ok(Math.abs(volumeAt(state.present.overlayClips[0].volumeKeys, time) - volumeAt(original.volumeKeys, original.out - time)) < 1e-8, 'reverse mirrors the audible source-time envelope without negative keys');
await run('clip_tools', { clip_id: 'o', action: 'reverse' });
assert.deepEqual([state.present.overlayClips[0].mediaId, state.present.overlayClips[0].in, state.present.overlayClips[0].out], [original.mediaId, original.in, original.out]);
assert.deepEqual(state.present.overlayClips[0].keyframes, original.keyframes);
assert.deepEqual(state.present.overlayClips[0].volumeKeys, original.volumeKeys);

reset();
state.present.videoClips[0].volumeKeys = [{ t: 0, v: 1 }, { t: 14, v: .2 }, { t: 40, v: 1 }];
const preHold = structuredClone(state.present.videoClips[0]);
const duration = videoLayout(state.present.videoClips).at(-1).end;
const words = structuredClone(state.present.textClips);
const hold = await run('clip_tools', { clip_id: 'v', action: 'freeze', time_sec: 2, duration_sec: 3 });
assert.equal(mediaCalls[0].at, 12, 'frame request uses source time through the clip trim');
assert.equal(state.present.videoClips.length, 3);
assert.equal(videoLayout(state.present.videoClips).at(-1).end, duration, 'frame holds preserve the timeline duration');
assert.deepEqual(state.present.textClips, words, 'captions stay aligned with continuing speech');
const held = state.present.videoClips.find(c => c.id === hold.clip_id);
assert.equal(held.mediaId, 'derived');assert.equal(held.out, 3);assert.equal(held.muted, true);
const preserved = state.present.audioClips.find(c => c.id === hold.preserved_audio_clip_id);
assert.equal(audioGain(preserved, 1, 3), audioGain(preHold, 3, 10), 'freeze preserves the original audio automation at the held picture time');
assert.deepEqual([preserved.start, preserved.in, preserved.out], [2, 12, 15], 'picture freeze keeps the original source audio');
assert.deepEqual(state.present.videoClips.filter(c => c.id !== hold.clip_id).map(c => [c.in, c.out]), [[10, 12], [15, 20]]);

reset();state.present.videoClips.push({ id: 'next', mediaId: 'm', in: 20, out: 30, transition: { type: 'fade', duration: .8 } });
const oldEnd = videoLayout(state.present.videoClips).at(-1).end;
await run('clip_tools', { clip_id: 'v', action: 'freeze', time_sec: 2, duration_sec: 7.1 });
assert.ok(Math.abs(videoLayout(state.present.videoClips).at(-1).end - oldEnd) < 1e-6, 'a short tail keeps the exact outgoing transition overlap');

reset();await run('layer_tools', { track: 'video', action: 'update', locked: true });
await blocked('clip_tools', { clip_id: 'v', action: 'freeze', time_sec: 2, duration_sec: 3 }, /locked/);
reset();await blocked('clip_tools', { clip_id: 'v', action: 'freeze', time_sec: 9, duration_sec: 3 }, /inside/);

reset();active = false;
await blocked('clip_tools', { clip_id: 'o', action: 'set_layer', layer: 0 }, /no longer|outside/);
reset();canceled = true;
await blocked('clip_tools', { clip_id: 'o', action: 'reverse' }, /stopped/);
console.log('Everyday clip/layer tools, links, timing, reverse round-trip and ownership checks passed');
