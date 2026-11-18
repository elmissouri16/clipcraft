// Delegated analysis children wait for concurrency slots; a child's time limit covers its own work
// and starts once it holds its slots (electron/agents/analysisDelegation.cjs). With more tasks than
// slots, queued children must not report "timed out" after little or no work, while a child that
// itself runs past the limit still times out. Usage: node tests/unit/agents/test-analysis-slot-timeout.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createAnalysisDelegation } = require('../../../electron/agents/analysisDelegation.cjs');
const { fileFingerprint } = require('../../../electron/media/mediaAnalysis.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-slot-timeout-')), file = path.join(dir, 'source.bin');
fs.writeFileSync(file, 'source');
const index = { index_id: 'i1', duration_sec: 600, fingerprint: fileFingerprint(file), has_audio: false, options: { language: 'en' } };
const run = async (work, timeoutMs) => {
  const ran = new Map();
  const localAgents = { closeNativeOwner() {}, runEditorNative: async (_cfg, { signal, prompt }) => {
    const n = JSON.parse(prompt.split('\n')[0].replace('Source: ', '')).start_sec / 60;
    const began = Date.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, work[n]);
      signal.addEventListener('abort', () => { clearTimeout(timer);reject(Object.assign(Error('aborted'), { name: 'AbortError' })); }, { once: true });
    }).finally(() => ran.set(n, Date.now() - began));
    return { text: '' };
  } };
  const delegation = createAnalysisDelegation({ localAgents, agentFrames: { openScope() {}, closeScope() {}, evidence: () => [] }, agentRequests: new Map(),
    sourceIndex: () => ({ load: () => index, status: () => ({ coverage: [{ start_sec: 0, end_sec: 600 }] }) }), enabled: () => true, emit: () => {}, limits: { timeoutMs } });
  const job = { controller: new AbortController(), pending: new Map(), cfg: { provider: 'codex-sdk', model: 'm', subagents: true, subagentConcurrency: 2 } };
  const declarations = ['read_video_transcript', 'find_video_moments', 'review_video_moment', 'inspect_frames'].map((name) => ({ name, description: name, parameters: { type: 'OBJECT', properties: {} } }));
  const tasks = work.map((_, i) => ({ role: 'analyst', start_sec: i * 60, end_sec: i * 60 + 60, task: 'look' }));
  const result = await delegation.run({ job, event: { sender: { id: 1 } }, declarations,
    req: { requestId: 'r', media_id: 'm', index_id: 'i1', evidence_mode: 'visual_only', visual_only_reason: 'test', tasks, project: { media: [{ id: 'm', path: file, name: 'src' }] } } });
  return { tasks: result.tasks, ran };
};
(async () => {
  try {
    // Six children of 120 ms, two at a time, under a 200 ms limit: the later ones wait ~240-360 ms for a slot.
    let r = await run([120, 120, 120, 120, 120, 120], 200);
    assert.equal(r.ran.size, 6, 'every child got to run');
    r.tasks.forEach((task, i) => assert.doesNotMatch(String(task.error), /timed out/, `child ${i + 1} waited for its slot and was not timed out`));
    for (const [n, ms] of r.ran) assert.ok(ms >= 110, `child ${n + 1} had its own time (${ms} ms)`);
    // A child whose own work runs past the limit still times out.
    r = await run([40, 400], 150);
    assert.match(String(r.tasks[1].error), /timed out/);assert.doesNotMatch(String(r.tasks[0].error), /timed out/);
    console.log('analysis slot timeout ok: a child\'s limit starts when it holds its slots; long work still times out');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error);process.exitCode = 1; });
