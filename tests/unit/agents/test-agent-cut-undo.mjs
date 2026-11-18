// Assistant ripple cuts, undo and retake ids.
// - A cut that only ripples content which already ran past the video (a music bed, a title) applies,
//   adds no black coverage tail, and is not blocked; content the assistant adds still gets coverage.
// - The undo tool reverts the whole last tool call, however many reducer steps it dispatched.
// - remove_retakes ids name the candidate itself: an id from a dry run still names the same sentence
//   after another cut, and an id whose candidate is gone is refused.
// Usage: node tests/unit/agents/test-agent-cut-undo.mjs
import assert from 'node:assert/strict';
globalThis.window = { api: {} };
const { emptyProject, historyReducer, exportDuration } = await import('../../../src/state/store.js');
const { createToolRunner } = await import('../../../src/features/agent/tools.js');
const { makeAgentCtx } = await import('../../../src/features/agent/agentCtx.js');

const talk = { id: 'm', name: 'talk', type: 'video', duration: 30, width: 100, height: 100, hasAudio: true };
const runnerFor = (p, extra = {}) => {
  const box = { s: { past: [], future: [], present: structuredClone(p) } };
  const ctx = { getProject: () => box.s.present, dispatch: (a) => { box.s = historyReducer(box.s, a); }, settle: async () => {}, api: {}, ...extra };
  return { box, runner: createToolRunner(ctx) };
};
const tail = (p) => p.videoClips.filter((c) => c.agentCoverage);

{
  // A music bed running far past the video, and a cut on the video.
  const p = { ...emptyProject(), media: [talk, { id: 'song', name: 'song', type: 'audio', duration: 180 }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }], audioClips: [{ id: 'music', mediaId: 'song', in: 0, out: 60, start: 0, speed: 1, volume: 0.3 }] };
  for (const [tool, args, length] of [['cut_range', { start_sec: 2, end_sec: 4 }, 8], ['keep_ranges', { ranges: [{ start_sec: 0, end_sec: 6 }] }, 6]]) {
    const { box, runner } = runnerFor(p);
    const r = await runner.run(tool, args);
    assert.equal(r.status, 'applied', `${tool}: ${r.error || ''}`);
    assert.equal(exportDuration(box.s.present), length, `${tool} removes exactly the requested time`);
    assert.deepEqual(tail(box.s.present), [], `${tool} adds no black tail for the music bed`);
  }
  // Twice in a row: the second cut splits a piece of the music again.
  const { box, runner } = runnerFor(p);
  assert.equal((await runner.run('cut_range', { start_sec: 2, end_sec: 4 })).status, 'applied');
  assert.equal((await runner.run('cut_range', { start_sec: 4, end_sec: 5 })).status, 'applied');
  assert.equal(exportDuration(box.s.present), 7);
  assert.deepEqual(tail(box.s.present), []);
}
{
  // An overlay and a title that already ran past the end: rippled along, never covered.
  for (const extra of [{ overlayClips: [{ id: 'o', mediaId: 'm', in: 0, out: 4, speed: 1, start: 8 }] }, { textClips: [{ id: 't', text: 'Title', start: 9, duration: 2 }] }]) {
    const p = { ...emptyProject(), media: [talk], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }], ...extra };
    const { box, runner } = runnerFor(p);
    const r = await runner.run('cut_range', { start_sec: 2, end_sec: 4 });
    assert.equal(r.status, 'applied', r.error);
    assert.equal(exportDuration(box.s.present), 8);
    assert.deepEqual(tail(box.s.present), []);
  }
}
{
  // Coverage still follows content the assistant adds past the end, and content inside the export.
  const p = { ...emptyProject(), media: [talk], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }] };
  let s = { past: [], future: [], present: p };
  s = historyReducer(s, { type: 'addText', clipId: 'late', at: 9, duration: 3, coverExport: true });
  assert.equal(exportDuration(s.present), 12, 'an added title past the end is covered');
  assert.equal(tail(s.present).length, 1);
}

{
  // undo reverts the whole add_media call (it dispatches more than one step).
  const p = { ...emptyProject(), media: [talk, { id: 'b', name: 'broll', type: 'video', duration: 8, width: 100, height: 100 }], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }] };
  let s = { past: [], future: [], present: p };
  const dispatch = (a) => { s = historyReducer(s, a); };
  const app = { getAgentEdit: () => s.agentEdit, getAgentInterruption: () => s.agentInterruption };
  const ctx = makeAgentCtx({ app, provider: 'x', getProject: () => s.present, dispatch, settle: async () => {}, requestId: 'req1', isCurrent: () => true, isStopped: () => false });
  dispatch({ type: 'beginAgentEdit', token: 'req1' });
  const runner = createToolRunner({ ...ctx, requestId: 'req1' });
  assert.equal((await runner.run('cut_range', { start_sec: 8, end_sec: 9 })).status, 'applied');
  const afterCut = s.present;
  const add = await runner.run('add_media', { media_id: 'b' });
  assert.equal(add.status, 'applied', add.error);
  assert.ok(s.agentEdit.steps.length >= 3, 'add_media dispatched several steps');
  const u = await runner.run('undo', {});
  assert.ok(!u.error, u.error);
  assert.ok(!s.present.videoClips.some((c) => c.id === add.clip_id), 'the added clip is gone');
  assert.deepEqual(s.present.videoClips, afterCut.videoClips, 'the project is exactly as before add_media');
  assert.equal(exportDuration(s.present), 9, 'the earlier cut stays');
  assert.ok(!(await runner.run('undo', {})).error);
  assert.equal(exportDuration(s.present), 10, 'a second undo reverts the cut call');
  assert.match((await runner.run('undo', {})).error, /Nothing of yours/);
}

{
  // Retake ids from a dry run keep naming the same candidate after an earlier cut.
  const W = (text, s, e) => ({ text, start: s, end: e, timing: 'measured' });
  const seg = (ws) => ({ start: ws[0].start, end: ws.at(-1).end, text: ws.map((w) => w.text).join(' '), word_timing: 'measured', words: ws });
  const segments = [
    seg([W('So', 0, .3), W('today', .3, .6), W('we', .6, .9), W('talk.', .9, 1.4)]),
    seg([W('So', 2.5, 2.8), W('today', 2.8, 3.1), W('we', 3.1, 3.4), W('talk', 3.4, 3.7), W('about', 3.7, 4), W('editing.', 4, 4.5)]),
    seg([W('Sorry', 9, 9.4), W('again.', 9.4, 10)]),
    seg([W('Here', 11, 11.3), W('is', 11.3, 11.5), W('the', 11.5, 11.7), W('plan.', 11.7, 12.2)]),
    seg([W('We', 15, 15.3), W('love', 15.3, 15.6), W('simple', 15.6, 16), W('cuts.', 16, 16.5)]),
    seg([W('We', 17, 17.3), W('love', 17.3, 17.6), W('simple', 17.6, 18), W('tools', 18, 18.4), W('too.', 18.4, 19)]),
  ];
  const p = { ...emptyProject(), fps: 30, media: [talk], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 30, speed: 1 }] };
  const { box, runner } = runnerFor(p, { api: { runCaptions: async () => ({ ok: true, segments, language: 'en' }) } });
  const dry = await runner.run('remove_retakes', { dry_run: true, kinds: ['restart', 'restart_cue'] });
  const [first, cue, legit] = dry.candidates;
  assert.deepEqual([first.removed, cue.removed, legit.removed], ['So today we talk.', 'Sorry again.', 'We love simple cuts.']);
  assert.ok(dry.candidates.every((c) => !/^r\d+$/.test(c.id)), 'ids are not list positions');
  assert.equal((await runner.run('remove_retakes', { retake_ids: [first.id] })).status, 'applied');
  const second = await runner.run('remove_retakes', { retake_ids: [cue.id] });
  assert.equal(second.status, 'applied', second.error);
  assert.deepEqual(second.removed.map((r) => r.removed), ['Sorry again.'], 'the remembered id still names "Sorry again."');
  const again = await runner.run('remove_retakes', { dry_run: true, kinds: ['restart', 'restart_cue'] });
  assert.ok(again.candidates.some((c) => c.id === legit.id && c.removed === 'We love simple cuts.'), 'the kept candidate keeps its id');
  assert.match((await runner.run('remove_retakes', { retake_ids: [first.id] })).error, /unknown/, 'an id whose candidate is gone is refused');
  assert.equal(exportDuration(box.s.present) < 30, true);
}
{
  // generate_images runs through runImages, not run(): it must mark where its steps begin too, or the
  // undo that follows also reverts the call before it.
  let state = { past: [], future: [], present: { ...emptyProject(), name: 'Original' } };
  const raw = (a) => { state = historyReducer(state, a); };
  const token = 'req-images';
  window.api = { agentGenerateImages: async (req) => ({ results: req.scenes.map((s, i) => ({ type: 'image', path: `/gen${i}.png`, name: `g${i}`, width: 1080, height: 1920 })) }) };
  raw({ type: 'beginAgentEdit', token });
  let ctx;
  const app = { getAgentEdit: () => state.agentEdit, addProbed: (res) => { const m = { ...res, id: res.path }; ctx.dispatch({ type: 'addMedia', items: [m] }); return m; } };
  ctx = { ...makeAgentCtx({ app, provider: 'codex-sdk', getProject: () => state.present, dispatch: raw, settle: async () => {}, requestId: token, isCurrent: () => true, isStopped: () => false }), requestId: token, isCanceled: () => false };
  const runner = createToolRunner(ctx);
  assert.equal((await runner.run('set_project', { name: 'Renamed first' })).status, 'applied');
  const images = await runner.runImages([{ prompt: 'one', start_sec: 0, duration_sec: 2 }, { prompt: 'two', start_sec: 2, duration_sec: 2 }]);
  assert.ok(images.every((r) => r.status === 'applied') && state.present.overlayClips.length === 2, 'the image batch inserts its scenes');
  assert.equal((await runner.run('undo', {})).status, 'applied');
  assert.equal(state.present.overlayClips.length, 0, 'undo removes the image batch');
  assert.equal(state.present.name, 'Renamed first', 'and keeps the call before it');
  window.api = {};
}
console.log('agent cut coverage, call undo and retake ids OK');
