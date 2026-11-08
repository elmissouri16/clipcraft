import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { runEditorMediaJob } from '../../../electron/agents/editorMedia.cjs';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { motionDataPinned, pinOffsetAt } from '../../../src/features/timeline/track.js';
import { stateAt } from '../../../src/features/timeline/anim.js';
import { pictureGeometry, sourceToStage } from '../../../src/features/preview/pictureGeometry.js';
import { trackingQuality, smoothTrack } from '../../../src/features/agent/trackingTools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-subject-following-'));
const runFF = args => execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 });
const patch = path.join(dir, 'patch.png'), source = path.join(dir, 'source.mp4');
runFF(['-f', 'lavfi', '-i', 'color=magenta:s=64x48,drawbox=x=8:y=8:w=16:h=16:color=white:t=fill,drawbox=x=34:y=24:w=12:h=12:color=black:t=fill', '-frames:v', '1', patch]);
runFF(['-f', 'lavfi', '-i', 'color=gray:s=384x216:r=30:d=5', '-loop', '1', '-i', patch, '-filter_complex', "[0:v][1:v]overlay=x='40+50*t':y=80:shortest=1", '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source]);
const media = { ...await ff.probe(source), id: 'm', path: source };
let state = { past: [], future: [], present: { ...emptyProject(), id: 'subject', width: 108, height: 192, ratio: '9:16', fps: 30,
  media: [media], videoClips: [{ id: 'v', mediaId: 'm', in: 1, out: 4, speed: 1 }], textClips: [{ id: 'label', text: 'Subject', start: 0, duration: 3, x: .5, y: .5 }] } };
let weak = false, active = true;
const runner = createToolRunner({ getProject: () => state.present, dispatch: a => { state = historyReducer(state, a); }, settle: async () => {}, editActive: () => active, requestId: 'follow-test',
  api: { agentMediaJob: async req => {
    assert.equal(req.requestId, 'follow-test');assert.deepEqual(req.frame_ids, ['raw-start-frame']);
    const result = await runEditorMediaJob(req, { cacheDir: path.join(dir, 'cache'), probeAll: async () => [] });
    if (weak) result.points = result.points.map(p => ({ ...p, c: .1 }));return result;
  } },
});
const args = { clip_id: 'v', frame_id: 'raw-start-frame', pick: { x: 122 / 384, y: 104 / 216 }, smoothing_sec: .08 };
const ok = async (name, a) => { const r = await runner.run(name, a);assert.ok(!r.error, r.error);return r; };
const bad = async (name, a, pattern) => { const before = JSON.stringify(state.present);const r = await runner.run(name, a);assert.match(r.error || '', pattern);assert.equal(JSON.stringify(state.present), before); };
await bad('track_subject', { ...args, pick: { x: 2, y: .5 } }, /normalized/);
weak = true;await bad('track_subject', args, /lost the target/);weak = false;
const result = await ok('track_subject', args), clip = state.present.videoClips[0];
assert.ok(result.tracking.confidence.weak_fraction < .05);
assert.ok(clip.transform.scale > 3 && !clip.crop.l && !clip.anim);
for (const t of [.25, 1, 2, 2.75]) {
  const transform = stateAt(clip, t, 3).transform;
  const actualPoint = { x: (72 + 50 * (t + 1)) / 384, y: 104 / 216 };
  const stage = sourceToStage(pictureGeometry(state.present, media, clip, transform), actualPoint.x, actualPoint.y);
  assert.ok(Math.abs(stage.x - .5) < .05, `tracked source center at ${t}: ${stage.x}`);
}
await ok('pin_to_subject', { clip_id: 'label', target_clip_id: 'v' });
const pinned = state.present.textClips[0];
const offset = pinOffsetAt(state.present, { track: 'text', clip: pinned }, 2);
assert.ok(Math.abs(offset.dx) < .05, 'reframed stationary subject does not send a pinned title drifting');
const output = path.join(dir, 'reframed.mp4'), renderProject = { ...state.present, textClips: [], motion: motionDataPinned(state.present) };
runFF(ff.buildExportArgs(renderProject, output).args);
const centers = [];
for (const time of [.25, 1, 2, 2.75]) {
  const pixels = runFF(['-ss', String(time), '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let min = 108, max = -1;
  for (let y = 0; y < 192; y++) for (let x = 0; x < 108; x++) { const i = (y * 108 + x) * 3;if (pixels[i] > 140 && pixels[i + 1] < 110 && pixels[i + 2] > 140) { min = Math.min(min, x);max = Math.max(max, x); } }
  assert.ok(max >= min, 'actual export contains the tracked patch');
  const center = (min + max) / 2;assert.ok(Math.abs(center - 54) < 7, `rendered target center ${center}`);centers.push(center);
}
await ok('split_at', { clip_id: 'v', time_sec: 1.5 });
assert.deepEqual(state.present.videoClips[1].track, clip.track);
await ok('set_speed', { clip_id: state.present.videoClips[1].id, speed: 2 });
assert.deepEqual(state.present.videoClips[1].keyframes, clip.keyframes, 'source-time framing survives speed');
await bad('pin_to_subject', { clip_id: 'label', target_clip_id: 'v' }, /entire follower/);
await ok('pin_to_subject', { clip_id: 'label' });assert.equal(state.present.textClips[0].pin, undefined);
active = false;await bad('track_subject', args, /outside this request/);
const q = trackingQuality([{ t: 0, c: 1 }, { t: 1, c: .1 }, { t: 9, c: 1 }], 0, 10);assert.equal(q.weak_fraction, .8);
assert.deepEqual(smoothTrack([{ t: 0, x: .5, y: .5 }, { t: 1, x: .5, y: .5 }, { t: 2, x: .5, y: .5 }], .2).map(p => p.x), [.5, .5, .5]);
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, confidence: result.tracking.confidence, rendered_centers_px: centers, output }, null, 2));
console.log('Real subject tracking, portrait reframe/export, pins and source-clock edits passed: ' + dir);
