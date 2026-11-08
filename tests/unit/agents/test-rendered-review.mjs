import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { inspectRenderedVideo, audioSignals } from '../../../electron/agents/renderReview.cjs';
import { runEditorMediaJob } from '../../../electron/agents/editorMedia.cjs';
import { motionDataPinned } from '../../../src/features/timeline/track.js';
import { emptyProject } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { projectRevision } from '../../../src/features/agent/context.js';
import { reviewTimelineData } from '../../../src/features/agent/reviewTools.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-rendered-review-')), file = path.join(dir, 'section.mp4');
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=160x96:r=12:d=1', '-f', 'lavfi', '-i', 'color=black:s=160x96:r=12:d=0.5', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=12:d=1.5',
  '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,1),0.05,if(lt(t,2),0.2,0))*sin(2*PI*440*t)':s=48000:d=3", '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const review = await inspectRenderedVideo(file, { sampleTimes: [0, 1.25, 2.5] });
assert.equal(review.video.decoded_frames, 36);assert.equal(review.video.timestamp_gap_candidates.length, 0);
assert.ok(review.video.black_candidates.some(r => r.start_sec <= 1.05 && r.end_sec >= 1.45));
assert.ok(review.video.still_candidates.some(r => r.start_sec === 0 && r.end_sec >= .9));
assert.ok(review.video.largest_frame_changes.some(r => Math.abs(r.time_sec - 1.5) < .1));
assert.ok(review.audio.peak_dbfs < -4 && review.audio.peak_dbfs > -16, 'decoded AAC peaks include codec transient overshoot');
assert.ok(review.audio.silence_candidates.some(r => r.start_sec <= 2.1 && r.end_sec >= 2.9));
assert.ok(review.audio.levels[2].rms_dbfs - review.audio.levels[0].rms_dbfs > 10);
assert.equal(review.frames.length, 3);for (const [i, frame] of review.frames.entries()) { assert.equal(frame.bytes[0], 255);assert.equal(frame.bytes[1], 216);fs.writeFileSync(path.join(dir, `sample-${i}.jpg`), frame.bytes); }
assert.ok(review.limitations.some(text => text.includes('no continuous semantic')));
const cover = path.join(dir, 'cover.jpg'), covered = path.join(dir, 'with-cover.mp4');
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=green:s=640x480', '-frames:v', '1', cover]);
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-i', file, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic', covered]);
const coveredReview = await inspectRenderedVideo(covered, { sampleTimes: [1.25] });
assert.equal(coveredReview.video.decoded_frames, 36, 'review decodes the video rather than a larger embedded cover');
assert.ok(coveredReview.video.black_candidates.length > 0);
const longFile = path.join(dir, 'long.mp4');
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=32x32:r=2:d=31', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', longFile]);
const partial = await inspectRenderedVideo(longFile, { sampleTimes: [0, 29] });assert.equal(partial.partial, true);assert.equal(partial.reviewed_end_sec, 30);assert.equal(partial.video.decoded_frames, 60);
const stereo = path.join(dir, 'stereo.wav');
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*440*t)|-0.2*sin(2*PI*440*t):s=48000:d=1', stereo]);
const stereoReview = await audioSignals(stereo);assert.ok(stereoReview.rms_dbfs > -20 && !stereoReview.silence_candidates.length, 'opposite-phase stereo is measured without mono cancellation');
await assert.rejects(inspectRenderedVideo(file, { signal: AbortSignal.abort() }), /stopped/);
let p = { ...emptyProject(), id: 'review', width: 160, height: 96, fps: 12,
  media: [{ ...await ff.probe(file), id: 'm', path: file }], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 3, keyframes: { scale: [{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 1.01, v: 2 }] } }] };
const original = JSON.stringify(p);let stale = false, canceled = false, exportCalls = 0;
const layeredFile = path.join(dir, 'speed-overlay.mp4');
const grid = path.join(dir, 'grid.mp4');
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=12:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', grid]);
const gridMedia = { ...await ff.probe(grid), id: 'grid', path: grid };
await ff.runExport({ ...p, width: 320, height: 180, media: [...p.media, gridMedia], videoClips: [{ id: 'v', mediaId: 'grid', in: 0, out: 3 }], overlayClips: [{ id: 'o', mediaId: 'grid', in: 2, out: 3, speed: 2, start: 2.5, muted: true }] }, layeredFile).promise;
const layeredReview = await inspectRenderedVideo(layeredFile, { sampleTimes: [2.8] });
assert.equal(layeredReview.video.decoded_frames, 36, 'a sped-up final overlay must not truncate the underlying video');
const reversed = await runEditorMediaJob({ action: 'reverse', item: gridMedia, from: 0, to: 2 }, { cacheDir: path.join(dir, 'cache'), probeAll: async files => Promise.all(files.map(async path => ({ ...await ff.probe(path), path }))) });
const endTrim = { ...p, width: 320, height: 180, media: [gridMedia, { ...reversed, id: 'reverse' }], videoClips: [{ id: 'v', mediaId: 'grid', in: 0, out: 2 }], overlayClips: [
  { id: 'first', mediaId: 'reverse', in: .5, out: 2, start: 0, muted: true, keyframes: { x: [{ t: .5, v: 0 }, { t: 2, v: .01 }] } },
  { id: 'second', mediaId: 'grid', in: 2, out: 3, speed: 2, start: 1.5, muted: true },
] };
const trimmedFile = path.join(dir, 'trimmed-overlay.mp4');await ff.runExport({ ...endTrim, motion: motionDataPinned(endTrim) }, trimmedFile).promise;
assert.equal((await inspectRenderedVideo(trimmedFile, { sampleTimes: [1.8] })).video.decoded_frames, 24, 'trimmed animated overlay EOF must not shorten later layers');
const doubledFile = path.join(dir, 'upsampled-overlay.mp4');
await ff.runExport({ ...endTrim, motion: motionDataPinned(endTrim), export: { codecFamily: 'h264', mode: 'crf', crf: 24, encoderPreset: 'veryfast', audioKbps: 128, outW: 320, outH: 180, outFps: 24 } }, doubledFile).promise;
assert.equal((await inspectRenderedVideo(doubledFile, { sampleTimes: [1.95] })).video.decoded_frames, 48, 'final FPS conversion preserves every output tick after composition');
const runner = createToolRunner({ getProject: () => p, dispatch: () => { throw Error('Review must not edit'); }, settle: async () => {}, requestId: 'review-test', isCanceled: () => canceled,
  startExport: async (options, request) => { exportCalls++;assert.equal(options.review, true);assert.equal(request.revision, projectRevision(p));if (stale) p = { ...p, name: 'Manual edit' };return { ok: true, file, size: fs.statSync(file).size, metadata: { duration_sec: 3, fps: 12, width: 160, height: 96 } }; },
  api: { agentReviewRendered: async request => {
    assert.equal(request.file, file);assert.deepEqual(request.sample_times, [0, 1.25, 2.5]);
    return { ...review, frames: review.frames.map((f, i) => ({ id: `rendered-${i}`, source: 'rendered', time_sec: f.render_time_sec })), semantic_audio_review: false, continuous_semantic_video_review: false };
  } },
});
const args = { start_sec: 0, end_sec: 3, sample_times_sec: [0, 1.25, 2.5] }, result = await runner.run('review_section', args);
assert.ok(!result.error, result.error);assert.equal(result.artifact.path, file);assert.equal(result.semantic_audio_review, false);assert.equal(JSON.stringify(p), original);
assert.ok(result.timeline.planned_motion[0].abrupt_transform_candidates_sec.length > 0);
assert.ok(!runner.mutates('review_section') && runner.requiresSuccess('review_section'));
assert.ok((await runner.run('review_section', { start_sec: 0, end_sec: 31 })).error);
assert.ok((await runner.run('review_section', { start_sec: 0, end_sec: 3, sample_times_sec: [3] })).error);
stale = true;assert.match((await runner.run('review_section', args)).error, /project changed/);
assert.equal(p.name, 'Manual edit');
canceled = true;assert.ok((await runner.run('review_section', args)).error);assert.equal(exportCalls, 2, 'canceled request cannot start another render');
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, video: review.video, audio: review.audio, limitations: review.limitations, output: file }, null, 2));
console.log('Actual encoded-section decode, black/still/motion candidates, audio levels/silence, image evidence and stale guards passed: ' + dir);
