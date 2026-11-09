// Coalescing, persistence, stale-result boundaries and export waiting for generic graphic edits.
import assert from 'node:assert/strict';
import { createGraphicEdits } from '../../../src/features/graphics/graphicEdits.js';
import { emptyProject, historyReducer } from '../../../src/state/store.js';

const original = { id: 'm', name: 'Graphic', type: 'video', path: '/original.mov', duration: 2, width: 320, height: 180, fps: 30,
  graphic: { code: 'source', inputs: { rate: 1 }, fonts: [] } };
let state = { past: [], future: [], present: { ...emptyProject(), id: 'p', width: 320, height: 180, fps: 30, media: [original],
  videoClips: [{ id: 'bg', gap: true, in: 0, out: 5, speed: 1 }], overlayClips: [{ id: 'c', mediaId: 'm', start: 0, in: 0, out: 2, speed: 1 }] } };
const dispatch = action => { state = historyReducer(state, action); };
const canceled = [], requests = [];
let deferred, fail = false;
const render = async args => {
  requests.push(args);
  if (args.inputs.rate === 2) await new Promise(resolve => { deferred = resolve; });
  if (fail) return { error: 'Invalid component data' };
  return { media: { ...original, id: `m-${args.inputs.rate}`, path: `/rate-${args.inputs.rate}.mov`, graphic: { ...original.graphic, inputs: args.inputs } } };
};
const edits = createGraphicEdits({ getProject: () => state.present, getGesture: () => !!state.gestureStart, dispatch,
  api: { cancelGraphicRender: id => canceled.push(id) }, render, delay: 5 });
const edit = rate => dispatch({ type: 'update', track: 'overlay', id: 'c', patch: { graphicDraft: { inputs: { rate }, duration_sec: 2 } } });
try {
  dispatch({ type: 'beginGesture' }); edit(2); edits.sync();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests.length, 0, 'a held gesture draws live without repeatedly baking video');
  assert.equal(state.present.overlayClips[0].graphicDraft.inputs.rate, 2, 'pending settings are in the saveable project');
  dispatch({ type: 'endGesture' });
  const first = edits.flush();
  await new Promise(resolve => setTimeout(resolve, 0));
  edit(3); edits.sync();
  deferred(); await first; await edits.flush();
  assert.ok(canceled.length, 'superseded render is canceled');
  assert.equal(state.present.media.find(m => m.id === state.present.overlayClips[0].mediaId).graphic.inputs.rate, 3, 'late results cannot restore old settings');
  assert.equal(state.present.overlayClips[0].graphicDraft, undefined, 'export flush waits for a baked, current graphic');
  dispatch({ type: 'undo' });
  assert.equal(state.present.overlayClips[0].graphicDraft.inputs.rate, 2, 'Undo can restore a pending revision');
  edit(4); fail = true; edits.sync();
  await assert.rejects(edits.flush(), /Invalid component data/);
  assert.equal(state.present.media.find(m => m.id === state.present.overlayClips[0].mediaId).path, '/original.mov', 'failed bake keeps the last good media');
  fail = false; edits.retry('c'); await edits.flush();
  assert.equal(state.present.overlayClips[0].mediaId, 'm-4');
  edit(5); edits.sync();
  dispatch({ type: 'update', track: 'overlay', id: 'c', patch: { in: .5, out: 1.5, speed: 2 } });
  edits.sync(); await edits.flush();
  assert.equal(requests.at(-1).duration_sec, 1.5);
  assert.deepEqual([state.present.overlayClips[0].in, state.present.overlayClips[0].out, state.present.overlayClips[0].speed], [.5, 1.5, 2], 'baking preserves timeline trims and speed');
  console.log('GRAPHIC EDITS OK (saved drafts, held gestures, newest result, Undo, export flush, errors and retry)');
} finally { edits.dispose(); }
