import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import sourceIndex from '../../../electron/media/sourceIndex.cjs';
import framesModule from '../../../electron/agents/agentFrames.cjs';
import moments from '../../../electron/media/sourceMoments.cjs';
import toolResult from '../../../electron/agents/toolResult.cjs';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { normalizeToolActivity } from '../../../src/features/agent/activityData.js';
import { describeToolActivity } from '../../../src/features/agent/toolActivity.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-source-discovery-'));
const checks = [], passed = name => checks.push(name);
const frames = new framesModule.AgentFrames(async () => { throw Error('Source analysis must not render the timeline.'); });
try {
  const file = path.join(dir, 'source.mp4');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=42', '-f', 'lavfi', '-i',
    "aevalsrc=exprs='if(between(t,18,23),0.7,0.03)*sin(2*PI*440*t)|-if(between(t,18,23),0.7,0.03)*sin(2*PI*440*t)':s=8000:d=42",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  const media = { ...await ff.probe(file), id: 'source', name: 'Stream recording', path: file };
  let transcriptions = 0;
  const services = { transcribe: async (_m, start, end) => { transcriptions++;const core = Math.ceil(start / 10) * 10, at = core - start + .5;return [{ start: at, end: Math.min(at + 1, end - start), text: core === 20 ? 'A quiet clever comeback worth keeping.' : 'A complete setup and explanation.', words: [{ text: 'setup', start: at, end: at + .4, timing: 'measured' }] }]; } };
  let service = new sourceIndex.SourceIndex(path.join(dir, 'index'), services);
  const first = await service.index(media, { chunk_sec: 10, max_chunks: 1 });
  assert.equal(first.complete, false);assert.equal(first.indexed_sec, 10);assert.deepEqual(first.coverage, [{ start_sec: 0, end_sec: 10 }]);assert.equal(first.unscanned_ranges_total, 4);
  passed('partial coverage reports indexed and unscanned source ranges');
  const firstFile = path.join(service.folder(first.index_id), '0.chunk.json'), firstTime = fs.statSync(firstFile).mtimeMs;
  service = new sourceIndex.SourceIndex(path.join(dir, 'index'), services);
  const resumed = await service.index(media, { chunk_sec: 10, max_chunks: 8 });
  assert.equal(resumed.complete, true);assert.equal(resumed.processed_chunks, 4);assert.equal(transcriptions, 5);assert.equal(fs.statSync(firstFile).mtimeMs, firstTime);
  const index = service.load(media, first.index_id);assert.equal(index.chunks[2].segments[0].start, 20.5);assert.equal(index.chunks[2].segments[0].words[0].start, 20.5);
  passed('service restart reuses completed chunks and shifts chunk-local speech to source time');
  fs.writeFileSync(path.join(service.folder(first.index_id), 'index.json'), '{}');
  const repaired = await service.index(media, { chunk_sec: 10 });assert.equal(repaired.processed_chunks, 0);assert.equal(repaired.complete, true);
  fs.writeFileSync(path.join(service.folder(first.index_id), '1.chunk.json'), '{}');
  assert.equal((await service.index(media, { chunk_sec: 10 })).processed_chunks, 1);passed('damaged manifest and chunk recover without discarding valid work');
  const bins = index.chunks.flatMap(c => c.bins);assert.ok(bins.find(b => b.time_sec === 20).rms_db > -12);assert.ok(bins.find(b => b.time_sec === 5).rms_db < -25);
  passed('real stereo audio activity retains phase-opposed energy');
  const found = service.find(media, first.index_id, { kind: 'gameplay', clip_length_sec: 8, limit: 2 });assert.equal(found.candidates.length, 2);assert.ok(found.exploration.length);assert.equal(found.next_offset, 2);
  const queried = service.find(media, first.index_id, { query: 'clever comeback', clip_length_sec: 8 });assert.ok(queried.candidates.length);assert.ok(queried.candidates.every(c => c.transcript.includes('clever comeback')));
  assert.equal(service.find(media, first.index_id, { query: 'absent words' }).candidates.length, 0);
  passed('retrieval supports literal speech search, paging and quiet exploration');
  const candidate = queried.candidates[0], owner = 'editor:request';
  const review = await service.review(media, { index_id: first.index_id, ...candidate }, { owner });
  assert.ok(fs.statSync(review.file).size > 100);assert.ok(Math.abs((await ff.probe(review.file)).duration - (candidate.end_sec - candidate.start_sec)) < .2);
  const project = { ...emptyProject(), width: 320, height: 180, media: [media], videoClips: [{ id: 'existing', mediaId: 'source', in: 0, out: 2, speed: 1 }] };
  const inspected = await frames.inspect(1, { project, source: 'media', media_id: 'source', source_times_sec: review.sample_times_sec, revision: 'r' });
  const frameIds = inspected.frames.map(f => f.id), picks = [{ review_id: review.review_id, frame_ids: frameIds, title: 'A complete comeback', reason: 'The sampled sequence and speech preserve a setup and its response.', confidence: 'medium' }];
  const req = { index_id: first.index_id, picks }, evidence = ids => frames.evidence(1, ids, 'request');
  assert.throws(() => service.propose(media, req, { owner, evidence }), /present/);
  frames.images(1, frameIds);frames.markPresented(1, frameIds, 'request', 'test', 'vision');
  assert.throws(() => service.propose(media, req, { owner: 'other-request', evidence }), /current review/);
  assert.throws(() => service.propose(media, { ...req, picks: [{ ...picks[0], frame_ids: frameIds.slice(0, 2) }] }, { owner, evidence }), /beginning/);
  assert.throws(() => service.propose(media, { ...req, picks: [{ ...picks[0], frame_ids: [frameIds[2], frameIds[4], frameIds[2]] }] }, { owner, evidence }), /beginning/);
  assert.throws(() => service.propose(media, { ...req, picks: [picks[0], picks[0]] }, { owner, evidence }), /overlap/);
  const proposed = service.propose(media, req, { owner, evidence });assert.equal(proposed.picks.length, 1);
  assert.deepEqual(toolResult.frameIds('review_video_moment', { frames: inspected.frames }), frameIds);
  const activity = normalizeToolActivity(describeToolActivity('propose_video_clips', {}, project, proposed));assert.equal(activity.discovery.picks[0].pick_id, proposed.picks[0].pick_id);
  passed('real previews and presented source evidence gate proposals; foreign requests, sparse evidence and duplicates are refused');
  fs.writeFileSync(review.file, 'damaged preview');
  assert.throws(() => service.propose(media, req, { owner, evidence }), /unchanged source\/preview/);
  const previewRepair = await service.review(media, { index_id: first.index_id, ...candidate }, { owner });assert.ok((await ff.probe(previewRepair.file)).duration > 0);passed('damaged previews are regenerated and changed review artifacts cannot authorize a proposal');
  let state = { past: [], future: [], present: project };state = historyReducer(state, { type: 'beginAgentEdit', token: 'add' });
  const runner = createToolRunner({ getProject: () => state.present, dispatch: a => { state = historyReducer(state, { ...a, agentToken: 'add' }); }, settle: async () => {}, requestId: 'add', api: {
    agentSourceDiscovery: async r => service.pick(media, r.index_id, r.pick_id),
  } });
  const result = await runner.run('add_video_clip', { media_id: 'source', index_id: first.index_id, pick_id: proposed.picks[0].pick_id });assert.ok(!result.error, result.error);
  assert.equal(state.present.videoClips.length, 2);assert.equal(state.present.videoClips[0].id, 'existing');assert.equal(state.present.videoClips[1].in, candidate.start_sec);assert.equal(state.present.videoClips[1].out, candidate.end_sec);
  state = historyReducer(state, { type: 'endAgentEdit', token: 'add' });state = historyReducer(state, { type: 'undo' });assert.deepEqual(state.present.videoClips, project.videoClips);
  passed('adding a pick appends only its source range and one Undo restores the existing edit');
  const savedPicks = path.join(service.folder(first.index_id), 'picks.json'), priorPicks = fs.readFileSync(savedPicks);
  fs.writeFileSync(savedPicks, JSON.stringify([{ ...proposed.picks[0], start_sec: -1 }]));assert.throws(() => service.pick(media, first.index_id, proposed.picks[0].pick_id), /stale/);
  fs.writeFileSync(savedPicks, '{}');assert.throws(() => service.pick(media, first.index_id, proposed.picks[0].pick_id), /stale/);fs.writeFileSync(savedPicks, priorPicks);
  passed('duplicate frame IDs cannot inflate evidence and malformed saved picks cannot authorize invalid ranges');
  // Abort after a committed chunk, then recreate the service and resume.
  const cancelDir = path.join(dir, 'cancel'), abort = new AbortController();let runs = [];
  service = new sourceIndex.SourceIndex(cancelDir, { ...services, scan: async (...args) => { runs.push(args[1]);return (await import('../../../electron/media/sourceSignals.cjs')).default.scanChunk(...args); } });
  await assert.rejects(service.index(media, { chunk_sec: 10 }, { signal: abort.signal, onProgress: p => { if (p.completed_chunks === 1) abort.abort(); } }), { name: 'AbortError' });
  service = new sourceIndex.SourceIndex(cancelDir, services);const finished = await service.index(media, { chunk_sec: 10 });assert.equal(finished.processed_chunks, 4);
  await assert.rejects(service.index(media, { chunk_sec: 10 }, { signal: AbortSignal.abort() }), { name: 'AbortError' });passed('Stop keeps committed work; restart resumes missing chunks and cached success respects cancellation');
  // A failed recognizer preserves independent visual work but never publishes
  // speech coverage it did not process.
  const broken = new sourceIndex.SourceIndex(path.join(dir, 'speech-error'), { ...services, transcribe: async () => { throw Error('speech failed'); } });
  await assert.rejects(broken.index(media, { chunk_sec: 10 }), /speech failed/);
  const incomplete = broken.describe(media).analyses[0];assert.equal(incomplete.indexed_sec, 10);assert.equal(incomplete.complete, false);assert.equal(incomplete.transcript.processed_sec, 0);
  passed('failed speech preserves visual work without claiming transcript coverage or overall completion');
  const beforeChange = first.index_id, stat = fs.statSync(file);fs.utimesSync(file, stat.atime, new Date(stat.mtimeMs + 5000));
  assert.throws(() => service.find(media, beforeChange, {}), /stale/);assert.throws(() => service.pick(media, beforeChange, proposed.picks[0].pick_id), /stale/);
  passed('source replacement invalidates index and saved clip picks');
  const cutFile = path.join(dir, 'boundary.mp4');execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=96x54:r=10:d=10', '-f', 'lavfi', '-i', 'color=red:s=96x54:r=10:d=10', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', cutFile]);
  const cutMedia = { ...await ff.probe(cutFile), id: 'cut', path: cutFile }, cutService = new sourceIndex.SourceIndex(path.join(dir, 'boundary-index'));
  const cutStatus = await cutService.index(cutMedia, { speech: false, chunk_sec: 10 });
  assert.ok(cutService.load(cutMedia, cutStatus.index_id).chunks.flatMap(c => c.cuts).some(t => Math.abs(t - 10) < .11));passed('real cut detection preserves an event exactly at a chunk boundary');
  // Long-duration, low-resolution fixture: prove coverage is not silently capped
  // at the reference analyzer's 30-minute limit. This is not a 4K speed benchmark.
  const longFile = path.join(dir, 'long.mp4');execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=96x54:r=1:d=1860', '-c:v', 'libx264', longFile]);
  const longMedia = { ...await ff.probe(longFile), id: 'long', path: longFile };
  const longService = new sourceIndex.SourceIndex(path.join(dir, 'long-index'));
  const longStatus = await longService.index(longMedia, { speech: false, chunk_sec: 300 });assert.equal(longStatus.complete, true);assert.ok(longStatus.indexed_sec > 1800);
  const late = longService.find(longMedia, longStatus.index_id, { start_sec: 1810, clip_length_sec: 20 });assert.ok(late.exploration.length);assert.ok(late.exploration.every(c => c.start_sec >= 1810));
  passed('real source indexing covers footage beyond 30 minutes and exposes late quiet moments');
  // Source-time retrieval never crosses a hole in completed coverage.
  const hole = { ...index, chunks: index.chunks.filter(c => c.index !== 1) }, holeResult = moments.candidates(hole, { clip_length_sec: 20 });
  assert.ok([...holeResult.candidates, ...holeResult.exploration].every(c => !(c.start_sec < 20 && c.end_sec > 10)));passed('candidate windows do not bridge unscanned source gaps');
  const fractional = { ...index, duration_sec: 42.066667, chunks: [{ index: 0, start_sec: 0, end_sec: 42.066667, bins: [], segments: [], cuts: [] }] };
  const edge = moments.candidates(fractional, { start_sec: 40, clip_length_sec: 5 });assert.ok([...edge.candidates, ...edge.exploration].every(c => c.end_sec <= fractional.duration_sec));passed('fractional source durations never round candidate ends beyond the media');
  const output = { ok: true, checks, dir };
  if (process.env.SOURCE_DISCOVERY_EVIDENCE) fs.writeFileSync(process.env.SOURCE_DISCOVERY_EVIDENCE, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally { frames.dispose();fs.rmSync(dir, { recursive: true, force: true }); }
