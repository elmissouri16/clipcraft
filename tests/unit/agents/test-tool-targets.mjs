// Targets of a tool call (src/features/agent/toolTargets.js): what a call is about to work on (from its
// arguments) and what it changed (reducer actions, a content diff that ignores pure ripple shifts, created
// ids), bounded and safe on malformed input; carried by describeToolActivity and kept by the saved-chat
// whitelist. Usage: node tests/unit/agents/test-tool-targets.mjs
import assert from 'node:assert/strict';
import { toolTargets, argTargets, actionTargets, changedClipRefs } from '../../../src/features/agent/toolTargets.js';
import { describeToolActivity } from '../../../src/features/agent/toolActivity.js';
import { normalizeToolActivity } from '../../../src/features/agent/activityData.js';
import { historyReducer, emptyProject } from '../../../src/state/store.js';

const checks = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const p = { ...emptyProject(), width: 640, height: 360, fps: 30, media: [{ id: 'm', name: 'Shot.mp4', type: 'video', duration: 10 }, { id: 'a', name: 'Voice.wav', type: 'audio', duration: 8 }],
  videoClips: [{ id: 'v1', mediaId: 'm', in: 0, out: 4, speed: 1 }, { id: 'v2', mediaId: 'm', in: 0, out: 4, speed: 1 }, { id: 'v3', mediaId: 'm', in: 0, out: 4, speed: 1 }],
  overlayClips: [{ id: 'o1', mediaId: 'm', in: 0, out: 2, speed: 1, start: 1 }], audioClips: [{ id: 'au1', mediaId: 'a', in: 0, out: 8, speed: 1, start: 0 }],
  textClips: [{ id: 't1', text: 'Title', start: 2, duration: 3 }, { id: 'c1', caption: true, text: 'Hi', start: 0.5, duration: 1 }], effectClips: [{ id: 'e1', fx: 'grain', start: 6, duration: 2 }] };
const refs = (t) => t.clips.map((c) => `${c.track}:${c.id}`).join(',');

// ---- running targets from arguments ----
let t = argTargets('trim_clip', { clip_id: 'v2', start_sec: 5 }, p);
check('trim_clip spotlights the clip and the sliver it removes', refs(t) === 'video:v2' && JSON.stringify(t.ranges) === '[{"start":4,"end":5}]');
t = argTargets('cut_range', { start_sec: 1, end_sec: 2 }, p);
check('cut_range spotlights the requested range', t.clips.length === 0 && JSON.stringify(t.ranges) === '[{"start":1,"end":2}]');
t = argTargets('keep_ranges', { ranges: [{ start_sec: 0, end_sec: 1 }, { start_sec: 3, end_sec: 5 }] }, p);
check('keep_ranges spotlights every kept range', t.ranges.length === 2 && t.ranges[1].end === 5);
t = argTargets('split_at', { clip_id: 'v1', time_sec: 2.5 }, p);
check('split_at spotlights the clip and a tick at the split time', refs(t) === 'video:v1' && t.ranges[0].start === 2.5 && t.ranges[0].end === 2.5);
t = argTargets('delete_clip', { clip_id: 'o1' }, p);
check('delete_clip spotlights the overlay and its span', refs(t) === 'overlay:o1' && t.ranges[0].start === 1 && t.ranges[0].end === 3);
t = argTargets('add_text', { text: 'New', start_sec: 4, duration_sec: 2 }, p);
check('add_text spotlights where the text will land', JSON.stringify(t.ranges) === '[{"start":4,"end":6}]');
check('add_effect defaults to the 3 s length', argTargets('add_effect', { effect_id: 'blur', start_sec: 1 }, p).ranges[0].end === 4);
check('placing on the main track has no time range', argTargets('add_media', { media_id: 'm', as: 'main', start_sec: 0 }, p).ranges.length === 0);
t = argTargets('duck_audio', { clip_id: 'au1', speech_clip_ids: ['v1', 'missing'] }, p);
check('duck_audio spotlights the target and the speech clips, unknown ids dropped', refs(t) === 'audio:au1,video:v1');
check('captions as a target are flagged, not resolved', argTargets('set_color', { clip_id: 'captions' }, p).captions === true && argTargets('set_color', { clip_id: 'captions' }, p).clips.length === 0);
check('get_project clip_ids spotlight the clips it reads', refs(argTargets('get_project', { clip_ids: ['t1', 'e1'] }, p)) === 'text:t1,effect:e1');
check('generate_images spotlights each scene', argTargets('generate_images', { scenes: [{ start_sec: 0, duration_sec: 2 }, { start_sec: 5, duration_sec: 1 }] }, p).ranges.length === 2);

// ---- done targets from reducer actions ----
const after1 = historyReducer({ past: [], future: [], present: p }, { type: 'split', track: 'video', id: 'v1', t: 2, newId: 'v1b' }).present;
let d = actionTargets([{ type: 'split', track: 'video', id: 'v1', t: 2, newId: 'v1b' }], after1);
check('split reports the clip and the new half', refs(d) === 'video:v1' && d.created[0].id === 'v1b');
d = actionTargets([{ type: 'batch', actions: [{ type: 'update', track: 'text', id: 't1', patch: {} }, { type: 'updateMany', updates: [{ track: 'overlay', id: 'o1', patch: {} }] }, { type: 'addText', clipId: 'tn', at: 1, patch: {} }, { type: 'addEffectClip', clipId: 'en', fx: 'blur', at: 0 }] }], p);
check('batch actions flatten into clips and created', refs(d) === 'text:t1,overlay:o1' && d.created.map((c) => c.track + ':' + c.id).join(',') === 'text:tn,effect:en');
const withAudio = { ...p, audioClips: [...p.audioClips, { id: 'placed', mediaId: 'a', in: 0, out: 8, speed: 1, start: 0 }] };
check('addToTimeline resolves the new clip track from the project', actionTargets([{ type: 'addToTimeline', mediaId: 'a', clipId: 'placed', at: 0 }], withAudio).created[0].track === 'audio');
d = actionTargets([{ type: 'moveToOverlay', id: 'v2', at: 1 }, { type: 'extractAudio', track: 'video', id: 'v3', newId: 'x1' }, { type: 'replaceCaptionCues', ids: ['c1'], clips: [{ id: 'c1' }, { id: 'c2' }] }, { type: 'styleCaptions', patch: {} }], p);
check('moves, extraction and caption repair report both sides', refs(d) === 'video:v2,video:v3,text:c1' && d.created.map((c) => c.id).join(',') === 'v2,x1,c2' && d.captions === true);

// ---- content diff ignores ripple ----
const cut = historyReducer({ past: [], future: [], present: p }, { type: 'cutRanges', ranges: [{ start: 1, end: 2 }], ripple: true }).present;
const diff = changedClipRefs(p, cut);
check('a cut marks the trimmed clip but not the clips that only shifted', diff.clips.some((c) => c.id === 'v1') && !diff.clips.some((c) => c.id === 'v3' || c.id === 'v2'));
const done = toolTargets('cut_range', { start_sec: 1, end_sec: 2 }, p, { changed: true }, cut, [{ type: 'cutRanges', ranges: [{ start: 1, end: 2 }], ripple: true }]);
check('the done event carries the changed clips and a seam tick at the cut', done.clips.some((c) => c.id === 'v1') && JSON.stringify(done.ranges) === '[{"start":1,"end":1}]');
const kept = toolTargets('keep_ranges', { ranges: [{ start_sec: 0, end_sec: 1 }, { start_sec: 3, end_sec: 5 }] }, p, { changed: true }, p, []);
check('keep_ranges leaves a seam where the kept parts meet', kept && JSON.stringify(kept.ranges) === '[{"start":1,"end":1}]');
const added = toolTargets('add_text', { text: 'New', start_sec: 4 }, p, { changed: true, clip_id: 'tn' }, { ...p, textClips: [...p.textClips, { id: 'tn', text: 'New', start: 4, duration: 3 }] }, [{ type: 'addText', clipId: 'tn', at: 4, patch: {} }]);
check('a created clip is reported as created, not changed', added.created.length === 1 && added.created[0].id === 'tn' && added.clips.length === 0);
check('an unchanged call has no targets', toolTargets('set_speed', { clip_id: 'v1', speed: 1 }, p, { status: 'unchanged' }, p, []) === undefined);
check('reads have no done targets', toolTargets('get_project', {}, p, { ok: true }, p, []) === undefined);
check('image batches report created clips from results', toolTargets('generate_images', {}, p, { results: [{ clip_id: 'o1' }, { error: 'x' }] }, p, []).created[0].id === 'o1');

// ---- bounds and safety ----
const many = Array.from({ length: 45 }, (_, i) => ({ type: 'update', track: 'text', id: `t${i}`, patch: {} }));
check('clip refs are capped at 40', actionTargets(many, p).clips.length === 40);
for (const [name, args] of [['keep_ranges', { ranges: {} }], ['duck_audio', { clip_ids: 'x', speech_clip_ids: 7 }], ['generate_images', { scenes: 'bad' }], ['cut_range', { start_sec: 'a', end_sec: -1 }]]) {
  assert.doesNotThrow(() => toolTargets(name, args, p));
  assert.doesNotThrow(() => toolTargets(name, args, p, { ok: true }, p, 'not an array'));
}
check('malformed arguments never throw', true);
check('describeToolActivity carries targets on the running event', JSON.stringify(describeToolActivity('cut_range', { start_sec: 1, end_sec: 2 }, p).targets.ranges) === '[{"start":1,"end":2}]');
check('describeToolActivity carries exact targets on the done event', describeToolActivity('split_at', { clip_id: 'v1', time_sec: 2 }, p, { changed: true }, after1, [{ type: 'split', track: 'video', id: 'v1', t: 2, newId: 'v1b' }]).targets.created[0].id === 'v1b');
const saved = normalizeToolActivity({ title: 'x', targets: { clips: [{ track: 'video', id: 'v1' }, { track: 'bogus', id: 'z' }, { track: 'text' }], ranges: [{ start: 1, end: 2 }, { start: 3, end: 1 }], created: [], captions: true } });
check('saved activity keeps valid targets and drops bad tracks and ranges', saved.targets.clips.length === 1 && saved.targets.ranges.length === 1 && saved.targets.captions === true);
check('saved activity drops empty targets', normalizeToolActivity({ title: 'x', targets: { clips: [], ranges: [] } }).targets === undefined);
console.log(`tool targets OK: ${checks.length} checks`);
