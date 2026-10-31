// RocketPilot's motion tools (zoom, set_transform, add_keyframes, set_animation) against the real reducer.
// Usage: node scripts/test-agent-motion.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject } from '../src/store.js';
import { createToolRunner, summarizeProject, TOOL_DECLARATIONS } from '../src/agent/tools.js';
import { stateAt } from '../src/anim.js';

const near = (a, b, what, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
let state = {
  past: [], future: [],
  present: {
    ...normalizeProject({}), fps: 30,
    media: [{ id: 'm', name: 'talk.mp4', type: 'video', duration: 30, width: 1920, height: 1080 }],
    videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1 }, { id: 'b', mediaId: 'm', in: 10, out: 16, speed: 1 }],
    overlayClips: [{ id: 'o', mediaId: 'm', start: 2, in: 0, out: 4, speed: 1 }],
  },
};
const ctx = { getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, api: {}, settle: async () => {} };
const run = (name, args) => createToolRunner(ctx).run(name, args);
const clip = (id) => [...state.present.videoClips, ...state.present.overlayClips].find((c) => c.id === id);

for (const t of ['zoom', 'set_transform', 'add_keyframes', 'set_animation']) assert.ok(TOOL_DECLARATIONS.some((d) => d.name === t), `${t} declared`);

// Punch-in zoom from 2 s to 4 s on clip a: 1x before, 1.4x inside, 1x after, one frame to jump.
let r = await run('zoom', { start_sec: 2, end_sec: 4, scale: 1.4 });
assert.ok(r.ok, JSON.stringify(r));
let a = clip('a');
near(stateAt(a, 1.9, 6).transform.scale, 1, 'before the zoom');
near(stateAt(a, 3, 6).transform.scale, 1.4, 'inside the zoom');
near(stateAt(a, 4.1, 6).transform.scale, 1, 'after the zoom');
// Focus 0.45 high: the picture moves down so that point stays put: y = (0.45 - 0.5) * (1 - 1.4) = 0.02.
near(stateAt(a, 3, 6).transform.y, 0.02, 'zoom towards the focus point');

// A smooth zoom over the cut between a and b (5 s to 8 s) adds keyframes to both clips.
r = await run('zoom', { start_sec: 5, end_sec: 8, scale: 1.2, style: 'smooth', ramp_sec: 0.5 });
assert.deepEqual(r.zoomed_clips, ['a', 'b']);
const b = clip('b');
near(stateAt(b, 1, 6).transform.scale, 1.2, 'smooth zoom held on clip b');
near(stateAt(b, 2, 6).transform.scale, 1, 'smooth zoom ended on clip b');
near(stateAt(b, 1.75, 6).transform.scale, 1.1, 'halfway through the ramp out');
near(stateAt(clip('a'), 3, 6).transform.scale, 1.4, 'the first zoom is still there');

// Errors the model can read.
assert.ok((await run('zoom', { start_sec: 40, end_sec: 42 })).error);
assert.ok((await run('set_animation', { clip_id: 'a', in: 'nope' })).error.includes('fade_in'));

// set_transform, add_keyframes and set_animation on the overlay clip (timeline times; it starts at 2 s).
assert.ok((await run('set_transform', { clip_id: 'o', scale: 0.5, x: 0.25, opacity: 0.8 })).ok);
assert.equal(clip('o').transform.scale, 0.5);
assert.equal(clip('o').opacity, 0.8);
assert.ok((await run('add_keyframes', { clip_id: 'o', property: 'rotation', keyframes: [{ time_sec: 2, value: 0 }, { time_sec: 6, value: 90 }] })).ok);
near(stateAt(clip('o'), 2, 4).transform.rot, 45, 'rotation keyframes');
assert.ok((await run('add_keyframes', { clip_id: 'o', property: 'scale', keyframes: [{ time_sec: 9, value: 1 }] })).error, 'outside the clip');
assert.ok((await run('set_animation', { clip_id: 'o', in: 'pop_in', out: 'fade_out', out_duration_sec: 1 })).ok);
assert.deepEqual(Object.keys(clip('o').anim).sort(), ['in', 'out']);
near(stateAt(clip('o'), 4, 4).opacity, 0, 'fade out at the end');
assert.ok((await run('set_animation', { clip_id: 'o', combo: 'pulse' })).ok);
assert.deepEqual(Object.keys(clip('o').anim), ['combo']);
// set_transform drops the keyframes of what it sets.
assert.ok((await run('set_transform', { clip_id: 'o', rotation: 10 })).ok);
assert.ok(!clip('o').keyframes.rot);

// get_project tells the model what is zoomed, moved and animated.
const sum = summarizeProject(state.present);
assert.deepEqual(sum.main_track[0].keyframed, ['scale', 'y']);
assert.equal(sum.overlay_track[0].animation.combo, 'pulse');
console.log('AGENT MOTION OK');
