// The per-request agent report (electron/agents/runReport.cjs): counts per tool, completion check
// failures, outcome and tokens; no text; the file keeps its newest half past the cap; a write
// failure never throws.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createRunReport } = require('../../../electron/agents/runReport.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-run-report-'));
try {
  let t = 1000;
  const report = createRunReport({ dir, provider: 'claude-agent-sdk', model: 'opus', webResearch: true, now: () => t });
  for (const [name, err] of [['add_text', false], ['set_animation', true], ['set_animation', true], ['complete_edit', true], ['complete_edit', false]]) report.call(name, err);
  t = 13400;
  const line = report.finish({ outcome: 'completed', tokenUsage: { inputTokens: 10 } });
  assert.deepEqual({ calls: line.calls, failed: line.failed, completeEditFailed: line.completeEditFailed, durationSec: line.durationSec }, { calls: 5, failed: 3, completeEditFailed: 1, durationSec: 12.4 });
  assert.deepEqual(line.tools.set_animation, { calls: 2, failed: 2 });
  const saved = fs.readFileSync(path.join(dir, 'agent-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(saved.length, 1); assert.equal(saved[0].provider, 'claude-agent-sdk'); assert.equal(saved[0].webResearch, true); assert.equal(saved[0].outcome, 'completed');
  assert.deepEqual(Object.keys(saved[0]).sort(), ['at', 'calls', 'completeEditFailed', 'durationSec', 'failed', 'model', 'outcome', 'provider', 'tokenUsage', 'tools', 'webResearch'], 'counts only, no text fields');
  // Past the cap the file keeps its newest half.
  fs.writeFileSync(path.join(dir, 'agent-runs.jsonl'), Array.from({ length: 30000 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(60) })).join('\n') + '\n');
  createRunReport({ dir, provider: 'codex-sdk' }).finish({ outcome: 'failed' });
  const after = fs.readFileSync(path.join(dir, 'agent-runs.jsonl'), 'utf8').trim().split('\n');
  assert.ok(after.length < 16000 && JSON.parse(after[0]).i === 15000 && JSON.parse(after.at(-1)).provider === 'codex-sdk');
  // An unwritable folder never throws.
  const blocked = path.join(dir, 'file-not-dir'); fs.writeFileSync(blocked, '');
  assert.doesNotThrow(() => createRunReport({ dir: blocked, provider: 'codex-sdk' }).finish({ outcome: 'canceled' }));
  console.log('RUN REPORT OK (per-tool counts, completion failures, no text, cap, never throws)');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
