// Smooth motion: keyframes that flow through ('continuous'), smooth journeys along a path
// (move_along_path), and the frame-by-frame measurements CraftAI checks its motion with
// (stops, jerks, reversals) in the tools, the critique and the section review.
// Usage: node tests/unit/agents/test-agent-smooth-motion.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject } from '../../../src/state/store.js';
import { createToolRunner, TOOL_DECLARATIONS } from '../../../src/features/agent/tools.js';
import { stateAt } from '../../../src/features/timeline/anim.js';
import { motionQuality } from '../../../src/features/timeline/motionQuality.js';
import { critiqueProject, introducedIssues } from '../../../src/features/agent/editorial.js';
import { reviewTimelineData } from '../../../src/features/agent/reviewTools.js';
import { pathKeys } from '../../../src/features/agent/pathTools.js';
import { TOOL_GROUPS } from '../../../src/features/agent/toolCatalog.js';

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const W = 1080, H = 1920, FPS = 30;
const keys = (pairs, e) => pairs.map(([t, v], i) => ({ t, v, ...(i && e ? { e } : {}) }));
const clipOf = (keyframes, out = 8) => ({ id: 'c', mediaId: 'm', in: 0, out, speed: 1, keyframes });
const quality = (c, extra = {}) => motionQuality((lt) => stateAt(c, lt, c.out - c.in), { len: c.out - c.in, fps: FPS, width: W, height: H, ...extra });
const speed = (c, prop, t, h = 1e-3) => (stateAt(c, t + h, 8).transform[prop] - stateAt(c, t - h, 8).transform[prop]) / (2 * h);

// A steady five-point push-in with a drift: every key rises.
const push = [[0, 1], [2, 1.1], [4, 1.18], [6, 1.24], [8, 1.3]];
const pushClip = (e) => clipOf({ scale: keys(push, e), x: keys(push.map(([t, v]) => [t, (v - 1) * 0.3]), e) });

await check('continuous keyframes pass through every key without stopping', () => {
  const c = pushClip('continuous'), old = pushClip('inout');
  for (const [t, v] of push) near(stateAt(c, t, 8).transform.scale, v, 1e-9, `key at ${t}`);
  for (const t of [2, 4, 6]) {
    assert.ok(speed(c, 'scale', t) > 0.02, `still moving at ${t}: ${speed(c, 'scale', t)}`);
    near(speed(old, 'scale', t), 0, 1e-3, `inout stops at ${t}`);
  }
  near(speed(c, 'scale', 0.001), 0, 0.01, 'starts from rest'); near(speed(c, 'scale', 7.999), 0, 0.01, 'arrives at rest');
  // Never overshoots: monotone keys give a monotone curve.
  let last = 1; for (let t = 0; t <= 8; t += 1 / FPS) { const s = stateAt(c, t, 8).transform.scale; assert.ok(s >= last - 1e-12, `monotone at ${t}`); last = s; }
});

await check('continuous slows to a stop where the value turns back, without overshooting', () => {
  const c = clipOf({ x: keys([[0, 0], [2, 0.2], [4, 0.1], [6, 0.3]], 'continuous') });
  near(speed(c, 'x', 2), 0, 1e-3, 'turning point');
  for (let t = 0; t <= 4; t += 0.02) assert.ok(stateAt(c, t, 8).transform.x <= 0.2 + 1e-12, `no overshoot at ${t}`);
});

await check('motion measurements: stop-and-go at eased keys, none with continuous', () => {
  const old = quality(pushClip('inout')), smooth = quality(pushClip('continuous'));
  assert.equal(old.stops.length, 3, JSON.stringify(old.stops)); assert.equal(old.smooth, false);
  assert.deepEqual([smooth.stops, smooth.jerks, smooth.reversals], [[], [], []]); assert.equal(smooth.smooth, true);
});

await check('a real hold is not a stop, and a turn after it is marked after_hold', () => {
  const q = quality(clipOf({ scale: keys([[0, 1.1], [3, 1.3], [3.6, 1.3], [8, 1.15]], 'inout') }));
  assert.equal(q.stops.length, 0, JSON.stringify(q.stops));
  assert.equal(q.reversals.length, 1); assert.equal(q.reversals[0].after_hold, true);
  const breathing = quality(clipOf({ scale: keys([[0, 1.1], [2, 1.3], [4, 1.1], [6, 1.3]], 'inout') }));
  assert.equal(breathing.reversals.length, 2); assert.ok(breathing.reversals.every((r) => !r.after_hold));
});

await check('linear keys meeting at different speeds are a jerk; eased acceleration is not', () => {
  const q = quality(clipOf({ x: keys([[0, 0], [3, 0.05], [5, 0.45]], 'linear') }));
  // At 3 s the speed jumps twelvefold; at 5 s the move stops dead.
  assert.equal(q.jerks.length, 2, JSON.stringify(q.jerks)); near(q.jerks[0], 3, 0.05, 'at the key'); near(q.jerks[1], 5, 0.05, 'abrupt stop');
  assert.equal(quality(clipOf({ x: keys([[0, 0], [1, 0.4]], 'inout') })).jerks.length, 0, 'eased acceleration and braking are steady');
  assert.equal(quality(clipOf({ x: keys([[0, 0], [1, 0.4]], 'in') })).jerks.length, 1, 'an ease-in that ends at full speed stops dead');
});

await check('rotation jumps, fast pans and entrance pops', () => {
  const spin = quality(clipOf({ rot: keys([[0, 0], [2, 0], [2.04, 30]], 'linear') }));
  assert.ok(spin.rotation_jumps.length >= 1);
  const whip = quality(clipOf({ x: keys([[1, 0], [1.6, 1]], 'linear') }));
  assert.deepEqual(whip.fast.map((f) => f.kind), ['pan']);
  // An overlay popping in from 3% scale is an entrance, not a defect.
  const pop = quality(clipOf({ scale: keys([[0, 0.03], [0.35, 0.44], [0.6, 0.4]], 'back') }, 3), { entrance: true });
  assert.deepEqual([pop.jerks, pop.fast], [[], []]);
});

// The real tools against the real reducer.
let state = { past: [], future: [], present: { ...normalizeProject({}), fps: FPS, width: W, height: H, ratio: '9:16',
  media: [{ id: 'm', name: 'map.png', type: 'image', duration: 30, width: W, height: H }, { id: 'ship', name: 'ship.png', type: 'image', duration: 30, width: W, height: H }],
  videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 8, speed: 1 }, { id: 'b', mediaId: 'm', in: 0, out: 8, speed: 1 }],
  overlayClips: [{ id: 's', mediaId: 'ship', start: 2, in: 0, out: 5, speed: 1 }] } };
const ctx = { getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, api: {}, settle: async () => {} };
const run = (name, args) => createToolRunner(ctx).run(name, args);
const clip = (id) => [...state.present.videoClips, ...state.present.overlayClips].find((c) => c.id === id);

await check('add_keyframes accepts continuous and reports the motion it made', async () => {
  const stepped = await run('add_keyframes', { clip_id: 'a', property: 'scale', easing: 'inout', keyframes: push.map(([t, v]) => ({ time_sec: t, value: v })) });
  assert.ok(stepped.ok, JSON.stringify(stepped)); assert.equal(stepped.motion.stops.length, 3);
  const flowing = await run('add_keyframes', { clip_id: 'a', property: 'scale', easing: 'continuous', keyframes: push.map(([t, v]) => ({ time_sec: t, value: v })) });
  assert.ok(flowing.ok); assert.equal(flowing.motion.stops.length, 0); assert.equal(clip('a').keyframes.scale[2].e, 'continuous');
  assert.match((await run('add_keyframes', { clip_id: 'a', property: 'x', easing: 'wobbly', keyframes: [{ time_sec: 1, value: 0 }] })).error, /continuous/);
});

await check('move_along_path: one smooth journey through the waypoints, facing its way', async () => {
  assert.ok(TOOL_DECLARATIONS.some((d) => d.name === 'move_along_path') && TOOL_GROUPS.motion.includes('move_along_path'));
  const points = [{ x: -0.4, y: 0.2 }, { x: -0.1, y: 0.1 }, { x: 0.1, y: -0.05 }, { x: 0.35, y: -0.25 }];
  const r = await run('move_along_path', { clip_id: 's', points, start_sec: 2.5, end_sec: 6.5, orient: true, heading_deg: 0 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.motion.stops, r.motion.jerks, r.motion.rotation_jumps], [[], [], []], JSON.stringify(r.motion));
  const s = clip('s'), len = 5, at = (t) => stateAt(s, t - 2, len).transform;
  near(at(2.5).x, -0.4, 1e-9, 'starts at the first point'); near(at(6.5).y, -0.25, 1e-9, 'ends at the last point');
  // It passes the middle waypoints exactly, while still moving.
  const times = s.keyframes.x.map((k) => k.t + 2);
  near(at(times[1]).x, -0.1, 1e-9, 'second waypoint'); assert.ok(Math.abs(at(times[1] + 0.01).x - at(times[1] - 0.01).x) > 1e-4, 'moving through it');
  // Heading up and to the right on a portrait canvas: the rotation is negative (screen y points down).
  assert.ok(at(times[2]).rot < 0 && at(times[2]).rot > -90, `rotation ${at(times[2]).rot}`);
  assert.match((await run('move_along_path', { clip_id: 's', points: [{ x: 0, y: 0 }] })).error, /2 to 24/);
  assert.match((await run('move_along_path', { clip_id: 's', points: [{ x: 0, y: 0, scale: 1 }, { x: 0.1, y: 0 }] })).error, /every point/);
  assert.match((await run('move_along_path', { clip_id: 's', points, start_sec: 0, end_sec: 3 })).error, /inside the clip/);
});

await check('path legs are spaced by distance, with longer first and last legs', () => {
  const { times } = pathKeys([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 0 }], { from: 0, to: 6, width: 1000, height: 1000 });
  near(times[1], 6 * 1.5 / 4, 1e-9, 'first leg'); near(times[2] - times[1], 6 / 4, 1e-9, 'middle leg');
});

await check('the critique reports stop-and-go and camera breathing, and gates new stops', async () => {
  const before = state.present;
  await run('add_keyframes', { clip_id: 'b', property: 'scale', easing: 'inout', keyframes: [[0, 1.1], [2, 1.3], [4, 1.1], [6, 1.3]].map(([t, v]) => ({ time_sec: 8 + t, value: v })) });
  await run('add_keyframes', { clip_id: 'a', property: 'scale', easing: 'inout', keyframes: push.map(([t, v]) => ({ time_sec: t, value: v })) });
  const report = critiqueProject(state.present), codes = report.issues.map((i) => i.code);
  assert.ok(codes.includes('motion_stop') && codes.includes('motion_reversal'), codes.join());
  assert.match(report.issues.find((i) => i.code === 'motion_stop').fix, /continuous/);
  assert.ok(report.metrics.motion.stops >= 3 && report.metrics.motion.camera_reversals === 2, JSON.stringify(report.metrics.motion));
  assert.ok(introducedIssues(before, state.present).some((i) => i.code === 'motion_stop'), 'the completion gate asks for it to be fixed');
  // Rebuilt to flow and to go one way: nothing left to report.
  await run('add_keyframes', { clip_id: 'a', property: 'scale', easing: 'continuous', keyframes: push.map(([t, v]) => ({ time_sec: t, value: v })) });
  await run('add_keyframes', { clip_id: 'b', property: 'scale', easing: 'continuous', keyframes: [[0, 1.1], [2, 1.15], [4, 1.22], [6, 1.3]].map(([t, v]) => ({ time_sec: 8 + t, value: v })) });
  const fixed = critiqueProject(state.present).issues.map((i) => i.code).filter((c) => c.startsWith('motion_'));
  assert.deepEqual(fixed, []);
});

await check('the section review carries the same measurements', async () => {
  // Back to a stepped push: it stops at 2, 4 and 6 s; the review of 0–5 s reports the first two.
  await run('add_keyframes', { clip_id: 'a', property: 'scale', easing: 'inout', keyframes: push.map(([t, v]) => ({ time_sec: t, value: v })) });
  const row = reviewTimelineData(state.present, 0, 5).planned_motion.find((m) => m.clip_id === 'a');
  assert.equal(row.smooth, false); assert.equal(row.stops_sec.length, 2, JSON.stringify(row)); near(row.stops_sec[0], 2, 0.1, 'stop at the key');
  assert.ok(Array.isArray(row.jerks_sec) && Number.isFinite(row.peak_zoom_pct_per_sec));
});

console.log(`${checks.length} smooth motion checks passed`);
