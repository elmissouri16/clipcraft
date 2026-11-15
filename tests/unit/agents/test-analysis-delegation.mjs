import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import delegation from '../../../electron/agents/analysisDelegation.cjs';
import ff from '../../../electron/media/ffmpeg.cjs';
import indexes from '../../../electron/media/sourceIndex.cjs';
import frameModule from '../../../electron/agents/agentFrames.cjs';
import { createAnalysisHost } from '../../../src/features/agent/analysisHost.js';
import { nativeTools } from '../../../src/features/agent/runNativeAgent.js';
import { TOOL_DECLARATIONS } from '../../../src/features/agent/tools.js';
import { emptyProject } from '../../../src/state/store.js';
import { SUBAGENT_LIMITS, scopedAnalysisCall } from '../../../shared/subagents.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-analysis-delegation-')), checks = [];
const frames = new frameModule.AgentFrames(() => { throw Error('Children cannot render the timeline.'); });
const parse = result => { assert.ok(!result.isError, result.content[0].text);return JSON.parse(result.content[0].text); };
try {
  const file = path.join(dir, 'source.mp4');execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=22', '-c:v', 'libx264', file]);
  const media = { ...await ff.probe(file), id: 'm', path: file, name: 'Video' }, source = new indexes.SourceIndex(path.join(dir, 'index'));
  const status = await source.index(media, { speech: false, chunk_sec: 10 });
  const project = { ...emptyProject(), media: [media], videoClips: [{ id: 'original', mediaId: 'm', in: 0, out: 2 }] }, original = JSON.stringify(project);
  let enabled = true, mode = 'normal', active = 0, peak = 0, job, manager, bridge, edits = 0;const closed = [], progress = [], childProof = [];
  let wideReady = 0, releaseWide;const wideBarrier = new Promise(resolve => { releaseWide = resolve; });
  const api = {
    agentCancel: async id => { assert.equal(id, 'parent');job.controller.abort(); },
    agentSourceDiscovery: async req => {
      const input = project.media.find(m => m.id === req.media_id);
      if (req.action === 'find') return source.find(input, req.index_id, req.options);
      if (req.action === 'transcript') return source.transcript(input, req.index_id, req.options);
      return source.review(input, req, { owner: `1:${req.requestId}` });
    },
    agentInspectFrames: req => frames.inspect(1, req),
    agentDelegateAnalysis: req => manager.run({ job, event: { sender: { id: 1 } }, req, declarations: TOOL_DECLARATIONS }),
  };
  const fresh = () => {
    job = { cfg: { provider: 'codex-sdk', model: 'inherited-model', reasoningEffort: 'high', subagents: true, webResearch: true }, controller: new AbortController(), pending: new Map() };
    bridge = createAnalysisHost({ ctx: { getProject: () => project, dispatch: () => { edits++; }, editActive: () => true, api, settle: async () => {} }, requestId: 'parent', isCanceled: () => job.controller.signal.aborted, enabled: true });
    assert.equal(bridge.ready(), false);
    job.invokeAnalysis = (name, args, analysis) => bridge.run({ requestId: 'parent', name, args, analysis });
  };
  const local = {
    closeNativeOwner: key => closed.push(key),
    runEditorNative: async (cfg, options) => {
      active++;peak = Math.max(peak, active);
      try {
        assert.equal(cfg.model, 'inherited-model');assert.equal(cfg.reasoningEffort, 'high');assert.equal(cfg.subagents, false);assert.equal(cfg.webResearch, false);
        assert.deepEqual(options.tools.map(t => t.name).sort(), ['find_video_moments', 'inspect_frames', 'read_video_transcript', 'review_video_moment', 'submit_analysis']);
        assert.ok((await options.onTool('add_text', { text: 'Forbidden' })).isError);
        const scope = JSON.parse(options.prompt.split('\n')[0].slice('Source: '.length));
        if (mode === 'empty_unreviewed') {
          assert.ok((await options.onTool('submit_analysis', { summary: 'No findings without looking.', findings: [] })).isError);
          return { text: 'Nothing to report.' };
        }
        assert.ok((await options.onTool('inspect_frames', { source: 'timeline', media_id: 'm', source_times_sec: [scope.start_sec] })).isError);
        assert.ok((await options.onTool('find_video_moments', { media_id: 'other', index_id: status.index_id })).isError);
        if (mode === 'hang') await new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(Error('Stopped child')), { once: true }); });
        if (mode === 'manual') project.name = 'A manual edit during analysis';
        assert.ok((await options.onTool('read_video_transcript', { media_id: scope.media_id, index_id: scope.index_id, start_sec: scope.start_sec, end_sec: scope.end_sec + 1 })).isError);
        const dialogue = parse(await options.onTool('read_video_transcript', { media_id: scope.media_id, index_id: scope.index_id, limit: 2 }));
        assert.equal(dialogue.source_range.start_sec, scope.start_sec);assert.equal(dialogue.source_range.end_sec, scope.end_sec);
        const found = parse(await options.onTool('find_video_moments', { media_id: scope.media_id, index_id: scope.index_id, clip_length_sec: 5, limit: 2 }));
        assert.ok(found.candidates.every(c => c.start_sec >= scope.start_sec && c.end_sec <= scope.end_sec));
        const windows = mode === 'wide' ? [0, 6, 12].map(start => ({ start_sec: start, end_sec: start + 5 })) : [found.candidates[0] || found.exploration[0]];
        const findings = [];
        for (const c of windows) {
          const output = await options.onTool('review_video_moment', { media_id: scope.media_id, index_id: scope.index_id, start_sec: c.start_sec, end_sec: c.end_sec });
          const review = parse(output);assert.equal(output.content.filter(b => b.type === 'image').length, 6);childProof.push(review);
          assert.ok(review.transcript_context.start_sec >= scope.start_sec);assert.ok(review.transcript_context.end_sec <= scope.end_sec);
          findings.push({ review_id: review.review_id, start_sec: review.start_sec, end_sec: review.end_sec, title: 'A source passage', reason: 'Ordered sampled frames show changing picture content with lead-in and aftermath.', confidence: 'low', frame_ids: review.frame_ids });
        }
        if (mode === 'wide') {
          wideReady++;if (wideReady === 6) { assert.equal(frames.scopes.size, 6);assert.equal(frames.records.size, 108);releaseWide(); }
          await wideBarrier;
        }
        const submit = { summary: 'Reviewed source passages; continuous action remains uncertain.', findings: mode === 'empty_reviewed' ? [] : findings };
        const bad = structuredClone({ ...submit, findings });bad.findings[0].frame_ids = ['invented', 'fake', 'unseen'];assert.ok((await options.onTool('submit_analysis', bad)).isError);
        parse(await options.onTool('submit_analysis', submit));assert.ok(await options.isComplete());
        await new Promise(resolve => setTimeout(resolve, 25));
        return { text: 'Submitted.', tokenUsage: { inputTokens: 10, outputTokens: 5 } };
      } finally { active--; }
    },
  };
  manager = delegation.createAnalysisDelegation({ localAgents: local, agentFrames: frames, agentRequests: new Map(), sourceIndex: () => source, enabled: () => enabled, emit: (_e, _id, e) => progress.push(e) });fresh();
  const args = { media_id: 'm', index_id: status.index_id, tasks: [{ role: 'analyst', start_sec: 0, end_sec: 10, task: 'Find a complete passage.' }, { role: 'analyst', start_sec: 10, end_sec: 20, task: 'Find a distinct passage.' }, { role: 'reviewer', start_sec: 0, end_sec: 10, task: 'Challenge the setup and payoff of early candidates.' }] };
  const result = await bridge.delegate(args);assert.equal(result.ok, true);assert.equal(result.partial, false);assert.equal(result.tasks.length, 3);assert.equal(peak, 2);assert.equal(closed.length, 3);
  assert.equal(bridge.ready(), true);assert.deepEqual(bridge.report(), { subagents: { status: 'used', tasks_completed: 3 } });
  assert.equal(JSON.stringify(project), original);assert.equal(edits, 0);assert.ok(result.tasks.every(t => t.findings[0].evidence.length === 6));assert.ok(progress.some(p => p.role === 'reviewer' && p.status === 'done'));
  checks.push('two concurrent native children plus a queued reviewer inherit model/settings and return real source evidence without writes');
  fresh();mode = 'empty_unreviewed';
  const unreviewed = await bridge.delegate({ ...args, tasks: args.tasks.slice(0, 1) });assert.equal(unreviewed.partial, true);assert.equal(unreviewed.tasks[0].status, 'failed');assert.equal(bridge.ready(), false);
  fresh();mode = 'empty_reviewed';
  const empty = await bridge.delegate({ ...args, tasks: args.tasks.slice(0, 1) });assert.equal(empty.tasks[0].status, 'completed');assert.equal(empty.tasks[0].findings.length, 0);assert.ok(empty.tasks[0].reviewed_ranges.length);assert.equal(bridge.ready(), true);
  checks.push('empty findings require actual presented passage images; untouched submissions cannot satisfy delegation');
  mode = 'normal';
  const child = childProof[0];assert.throws(() => source.propose(media, { index_id: status.index_id, picks: [{ review_id: child.review_id, frame_ids: child.frame_ids, title: 'Unseen', reason: 'Unseen', confidence: 'low' }] }, { owner: '1:parent', evidence: ids => frames.evidence(1, ids, 'parent') }), /current review/);
  checks.push('child proof cannot authorize coordinator proposals; the coordinator must inspect its own finalists');
  fresh();mode = 'wide';peak = 0;job.cfg.subagentConcurrency = 6;
  const expanded = await bridge.delegate({ ...args, tasks: Array.from({ length: 6 }, () => ({ role: 'analyst', start_sec: 0, end_sec: 22, task: 'Inspect three distinct passages for the evidence retention check.' })) });
  assert.equal(peak, 6);assert.equal(expanded.partial, false);assert.ok(expanded.tasks.every(t => t.findings.length === 3));assert.equal(frames.records.size, 0);assert.equal(frames.scopes.size, 0);
  checks.push('six concurrent agents retain all three reviewed findings each, then release their isolated frame storage');
  fresh();mode = 'normal';peak = 0;job.cfg.subagentConcurrency = 1;
  const serial = await bridge.delegate(args);assert.equal(peak, 1);assert.equal(serial.partial, false);
  checks.push('the selected concurrency of one serializes the same batch');
  for (const provider of ['codex-sdk', 'claude-agent-sdk', 'opencode-sdk']) {
    assert.ok(!nativeTools(provider).tools.some(t => t.name === 'delegate_video_analysis'));
    assert.ok(nativeTools(provider, [], { subagents: true }).tools.some(t => t.name === 'delegate_video_analysis'));
  }
  enabled = false;await assert.rejects(bridge.delegate(args), /disabled/);enabled = true;
  job.analysisTasks = SUBAGENT_LIMITS.tasksPerRequest;await assert.rejects(bridge.delegate(args), /at most/);
  checks.push('setting off removes delegation for every native provider; main process also rejects disabled or over-budget batches');
  const scope = { media_id: 'm', index_id: status.index_id, start_sec: 10, end_sec: 20 };
  assert.throws(() => scopedAnalysisCall('find_video_moments', { media_id: 'm', index_id: status.index_id, start_sec: 0 }, scope), /assigned/);
  assert.throws(() => scopedAnalysisCall('delegate_video_analysis', {}, scope), /cannot|unavailable/);
  checks.push('scope guards reject outside ranges and nested delegation');
  const audioFile = path.join(dir, 'audio-source.mp4');execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=22', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=22', '-c:v', 'libx264', '-c:a', 'aac', audioFile]);
  const audioMedia = { ...await ff.probe(audioFile), id: 'audio-source', path: audioFile };project.media.push(audioMedia);
  const audioStatus = await source.index(audioMedia, { speech: false, chunk_sec: 10 });
  const audioArgs = { ...args, media_id: audioMedia.id, index_id: audioStatus.index_id, tasks: args.tasks.slice(0, 1) };
  fresh();await assert.rejects(bridge.delegate(audioArgs), /Speech processing does not cover/);assert.equal(active, 0);
  await assert.rejects(bridge.delegate({ ...audioArgs, evidence_mode: 'visual_only', visual_only_reason: ' ' }), /concrete reason/);
  const visualOnly = await bridge.delegate({ ...audioArgs, evidence_mode: 'visual_only', visual_only_reason: 'Inspect picture composition only; dialogue is outside this task.' });
  assert.equal(visualOnly.tasks[0].status, 'completed');assert.equal(visualOnly.evidence.missing_speech, true);assert.ok(bridge.visualOnlyReason);
  checks.push('audio-bearing sources require processed speech by default; visual-only fallback is explicit, scoped and disclosed');
  fresh();mode = 'hang';const cancel = bridge.delegate(args);while (!active) await new Promise(r => setTimeout(r, 5));job.controller.abort();await assert.rejects(cancel, /Stopped|stopped/);
  assert.equal(active, 0);assert.equal(job.pending.size, 0);assert.equal(edits, 0);checks.push('parent cancellation stops active and queued children, closes native sessions and preserves the edit');
  fresh();mode = 'manual';await assert.rejects(bridge.delegate(args), /Stopped|stopped|changed/);assert.equal(active, 0);assert.equal(project.name, 'A manual edit during analysis');assert.equal(edits, 0);
  checks.push('manual edits cancel child work and remain intact instead of accepting stale analysis');
  fresh();manager = delegation.createAnalysisDelegation({ localAgents: local, agentFrames: frames, agentRequests: new Map(), sourceIndex: () => source, enabled: () => true, emit: () => {}, limits: { timeoutMs: 40 } });
  mode = 'hang';
  const timeout = await bridge.delegate({ ...args, tasks: args.tasks.slice(0, 1) });assert.equal(timeout.partial, true);assert.equal(timeout.tasks[0].status, 'failed');assert.match(timeout.tasks[0].error, /timed out/);assert.equal(active, 0);
  checks.push('timed-out child returns an honest partial batch without hanging or editing');
  const output = { ok: true, checks };if (process.env.ANALYSIS_DELEGATION_EVIDENCE) fs.writeFileSync(process.env.ANALYSIS_DELEGATION_EVIDENCE, JSON.stringify(output, null, 2));console.log(JSON.stringify(output, null, 2));
} finally { frames.dispose();fs.rmSync(dir, { recursive: true, force: true }); }
