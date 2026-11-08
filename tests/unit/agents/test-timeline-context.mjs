import assert from 'node:assert/strict';
import { emptyProject, videoLayout, normalizeProject, historyReducer } from '../../../src/state/store.js';
import { projectRevision, prepareContext } from '../../../src/features/agent/context.js';
import { createTimelineAttachment as attach, resolveTimelineAttachments as resolve, timelineContextPart, normalizeTimelineAttachments, addTimelineAttachment, contextTime } from '../../../src/features/agent/timelineContext.js';
import { newChatSession, normalizeChatSessions, snapshotChatSessions, hasChatContent } from '../../../src/features/agent/chatSessions.js';

const project = {
  ...emptyProject(), id: 'timeline-context',
  media: [{ id: 'm', name: 'Source', type: 'video', path: '/private/source.mp4', thumb: 'data:image/png;base64,SECRET', width: 1920, height: 1080, hasAudio: true }],
  videoClips: [{ id: 'v1', mediaId: 'm', in: 2, out: 12, speed: 2, transition: { type: 'fade', duration: 1 } }, { id: 'v2', mediaId: 'm', in: 20, out: 25, speed: 1, effects: ['vignette'] }],
  overlayClips: [{ id: 'o', mediaId: 'm', start: 2, in: 4, out: 10, speed: 2, layer: 1, effects: ['grain'] }],
  audioClips: [{ id: 'a', mediaId: 'm', start: 1, in: 10, out: 26, speed: 2, fadeIn: .5, fadeOut: 1, muted: true }],
  textClips: [{ id: 't', start: 2, duration: 2, text: 'Actual caption', caption: true }],
  effectClips: [{ id: 'fx', start: 3, duration: 1, fx: 'grain' }],
  layerState: { 'overlay:1': { locked: true, hidden: true } },
};
const range = attach(project, { kind: 'range', start_sec: 3, end_sec: 4.5 });
const resolved = resolve(project, [range]);
assert.equal(resolved[0].status, 'ready');
const snapshot = resolved[0].snapshot;
assert.equal(snapshot.revision, projectRevision(project));
assert.deepEqual(new Set(snapshot.clip_refs.map(r => r.track)), new Set(['video', 'overlay', 'audio', 'text', 'effect']));
const first = snapshot.clips.find(c => c.clip_id === 'v1');
assert.equal(first.source_overlap_start_sec, 8);
assert.equal(first.source_overlap_end_sec, 11);
const audio = snapshot.clips.find(c => c.clip_id === 'a');
assert.equal(audio.source_overlap_start_sec, 14);
assert.equal(audio.fade_in_sec, .5);assert.equal(audio.muted, true);
assert.equal(snapshot.clips.find(c => c.clip_id === 'o').locked, true);
assert.equal(snapshot.clips.find(c => c.clip_id === 'o').hidden, true);
assert.equal(snapshot.clips.find(c => c.clip_id === 't').text, 'Actual caption');
const main = videoLayout(project.videoClips);
assert.equal(resolve(project, [attach(project, { kind: 'clips', clip_refs: [{ track: 'video', id: 'v2' }] })])[0].start_sec, main[1].start, 'transition overlap uses editor layout');
const effect = resolve(project, [attach(project, { kind: 'clips', clip_refs: [{ track: 'effect', id: 'video|v2|vignette' }] })])[0].snapshot.clips[0];
assert.equal(effect.owner_clip_id, 'v2');assert.equal(effect.effect_id, 'vignette');
const bound = snapshot.clips.find(c => c.clip_id === 'overlay|o|grain');
assert.equal(bound.owner_layer, 1);assert.equal(bound.layer, 0);assert.equal(bound.hidden, true);assert.equal(bound.locked, true);
const part = timelineContextPart(resolved);
assert.ok(!part.includes('SECRET') && !part.includes('/private/source.mp4'));
assert.equal(prepareContext([{ role: 'user', parts: [{ text: 'Change this' }, { text: part }] }]).contents[0].parts[1].text, part, 'latest attachment reaches the model intact');

const clip = attach(project, { kind: 'clips', clip_refs: [{ track: 'overlay', id: 'o' }, { track: 'text', id: 't' }] });
const moved = { ...project, overlayClips: [{ ...project.overlayClips[0], start: 12 }] };
const refreshed = resolve(moved, [clip])[0];
assert.equal(refreshed.end_sec, 15);assert.equal(refreshed.snapshot.changed_since_attachment, true);
assert.equal(refreshed.snapshot.clips.find(c => c.clip_id === 'o').start_sec, 12);
assert.equal(resolve(moved, [range])[0].end_sec, 4.5, 'ranges stay at absolute timeline times');
const deleted = resolve({ ...project, textClips: [] }, [clip]);
assert.equal(deleted[0].status, 'unavailable');assert.throws(() => timelineContextPart(deleted), /deleted/);
assert.throws(() => timelineContextPart(resolve({ ...project, id: 'other' }, [range])), /another project/);
const late = attach(project, { kind: 'range', start_sec: 7, end_sec: 8 });
assert.equal(resolve({ ...emptyProject(), id: project.id }, [late])[0].status, 'unavailable');
assert.deepEqual([attach(project, { kind: 'range', start_sec: 4, end_sec: 2 }).start_sec, attach(project, { kind: 'range', start_sec: 4, end_sec: 2 }).end_sec], [2, 4]);
assert.throws(() => attach(project, { kind: 'range', start_sec: 2, end_sec: 2 }), /non-empty/);
assert.throws(() => attach(project, { kind: 'clips', clip_refs: [{ track: 'video', id: 'missing' }] }), /no longer/);
assert.equal(normalizeTimelineAttachments([null, {}, { ...range, id: 'x'.repeat(129) }]).length, 0);
assert.equal(addTimelineAttachment([clip], { ...clip, id: 'again', clip_refs: [...clip.clip_refs].reverse() }).length, 1);
const four = [0, 1, 2, 3].map(n => attach(project, { kind: 'range', start_sec: n, end_sec: n + .5 }));
assert.throws(() => addTimelineAttachment(four, range), /up to 4/);
assert.equal(contextTime(59.999), '01:00.00');

const dense = { ...project, textClips: Array.from({ length: 200 }, (_, n) => ({ id: `dense-${n}`, start: 1, duration: 5, text: 'x'.repeat(10000) })) };
const denseRef = attach(dense, { kind: 'range', start_sec: 1, end_sec: 5 });
const bounded = resolve(dense, [denseRef])[0].snapshot;
assert.ok(bounded.omitted_clip_details > 0 && bounded.omitted_clip_refs > 0);
assert.ok(timelineContextPart(resolve(dense, [denseRef])).length < 9000);
assert.throws(() => attach(dense, { kind: 'clips', clip_refs: dense.textClips.map(c => ({ track: 'text', id: c.id })) }), /time range/);

const chat = newChatSession();chat.timelineAttachments = [clip];chat.draft = 'Fix this part';
const saved = snapshotChatSessions({ version: 1, activeSessionId: chat.id, sessions: [chat] });
assert.deepEqual(normalizeChatSessions(JSON.parse(JSON.stringify(saved))).sessions[0].timelineAttachments, [clip]);
assert.equal(hasChatContent({ craftAI: { sessions: [{ ...chat, draft: '' }] } }), true);
assert.deepEqual(normalizeProject({ ...project, craftAI: saved }).craftAI.sessions[0].timelineAttachments, [clip]);
let state = { past: [], present: project, future: [] };
state = historyReducer(state, { type: 'craftChat', projectId: project.id, chat: saved });
assert.equal(state.past.length, 0, 'attaching context is not an edit');
const revision = projectRevision(project);
assert.equal(projectRevision({ ...project, craftAI: saved }), revision, 'draft metadata does not stale its own attachment');
console.log('Timeline context timing, bounds, live refresh, persistence and scope checks passed');
