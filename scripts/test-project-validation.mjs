// Malformed project loads must never replace the current document or its history.
import assert from 'node:assert/strict';
import { emptyProject, normalizeProject, historyReducer } from '../src/store.js';

const current = { ...emptyProject(), name: 'Keep my edit' };
const state = { past: [emptyProject()], present: current, future: [] };
for (const project of [null, [], 'project', 42,
  { videoClips: null }, { media: {} }, { audioClips: 'bad' },
  { textClips: [null] }, { overlayClips: [false] }, { effectClips: {} },
  { markers: ['bad'] }, { name: {} }, { width: 0 }, { fps: '30' },
  { videoClips: [{ speed: 0 }] }, { overlayClips: [{ layer: -1 }] },
  { videoClips: [{ out: Infinity }] }, { textClips: [{ text: {} }] },
  { media: [{ path: null }] }, { videoClips: [{ effects: {} }] },
]) {
  assert.throws(() => normalizeProject(project), /Invalid project field/);
  assert.equal(historyReducer(state, { type: 'load', project }), state);
}

// Legacy missing fields and nullable optional fields keep their previous defaults.
const legacy = normalizeProject({ name: 'Old project', overlayClips: null, markers: null });
assert.deepEqual(legacy.videoClips, []);
assert.deepEqual(legacy.overlayClips, []);
assert.deepEqual(legacy.markers, []);
assert.equal(legacy.fps, 30);
assert.ok(legacy.id);
const extension = { futureField: { nested: 'preserve me' } };
const roundtrip = normalizeProject(JSON.parse(JSON.stringify({ ...current, ...extension })));
assert.equal(roundtrip.id, current.id);
assert.deepEqual(roundtrip.futureField, extension.futureField);
assert.equal(historyReducer(state, { type: 'load', project: legacy }).present.name, 'Old project');
console.log('project validation ok (invalid loads preserve edits, legacy defaults, roundtrip)');
