import assert from 'node:assert/strict';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
const baseline = () => ({ ...emptyProject(), media: [{ id: 'm', path: '/source.mp4', type: 'video', duration: 6, hasAudio: true, width: 640, height: 360 }],
  videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 6 }], audioClips: [{ id: 'a', mediaId: 'm', start: 0, in: 0, out: 6 }] });
const cases = [
  ['track_subject', { clip_id: 'v', frame_id: 'frame', pick: { x: .5, y: .5 } }, 'agentMediaJob', { fps: 30, points: [{ t: 0, x: .5, y: .5, c: 1 }, { t: 5.97, x: .6, y: .5, c: 1 }] }],
  ['duck_audio', { target_clip_ids: ['a'], speech_clip_ids: ['v'] }, 'agentSilences', { silences: [] }],
  ['import_media', { paths: ['/new.png'] }, 'agentFileJob', { items: [{ path: '/new.png', type: 'image', width: 640, height: 360 }], failures: [], warnings: [] }],
  ['caption_tools', { action: 'import_srt', file_path: '/captions.srt' }, 'agentFileJob', { text: '1\n00:00:01,000 --> 00:00:02,000\nHello\n' }],
];
let checks = 0;
for (const [name, args, host, response] of cases) for (const interrupt of ['cancel', 'owner', 'manual']) {
  let state = { past: [], future: [], present: baseline() }, canceled = false, active = true, release, reached = false;
  const api = { [host]: async () => { reached = true;return await new Promise(resolve => { release = resolve; }); } };
  const ctx = { getProject: () => state.present, dispatch: a => { state = historyReducer(state, a); }, settle: async () => {}, isCanceled: () => canceled, editActive: () => active, requestId: `${name}-${interrupt}`, api,
    addProbed: item => { const media = { ...item, id: 'new' };state = historyReducer(state, { type: 'addMedia', items: [media] });return media; } };
  const runner = createToolRunner(ctx), pending = runner.run(name, args);
  await new Promise(resolve => setTimeout(resolve, 0));assert.ok(reached, `${name} reaches the request-owned host job`);
  if (interrupt === 'cancel') canceled = true;
  if (interrupt === 'owner') active = false;
  if (interrupt === 'manual') state = historyReducer(state, { type: 'setProject', patch: { name: 'Manual edit' } });
  const before = JSON.stringify(state.present);release(response);
  const result = await pending;
  assert.ok(result.error, `${name} rejects a late ${interrupt} result`);assert.equal(JSON.stringify(state.present), before, `${name} cannot overwrite the current project`);checks++;
}
console.log(`Late job ownership passed: ${checks} cancel, request ownership and manual-edit cases`);
