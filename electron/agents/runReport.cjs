// One line per native agent request in <userData>/logs/agent-runs.jsonl, so agents are compared on
// numbers (docs/design/agent-adapters.md): provider, model, web research, tool calls and failures
// per tool, completion check failures, duration, tokens and outcome. Counts only: no prompt, tool
// arguments or error text (they can quote the user's project).
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024;

function createRunReport({ dir, provider, model, webResearch, now = Date.now }) {
  const started = now(), tools = {};
  let calls = 0, failed = 0;
  return {
    call(name, isError) {
      calls++; if (isError) failed++;
      const t = tools[name] || (tools[name] = { calls: 0, failed: 0 });
      t.calls++; if (isError) t.failed++;
    },
    // outcome: 'completed' | 'failed' | 'canceled'
    finish({ outcome, tokenUsage } = {}) {
      const line = { at: new Date(started).toISOString(), provider, model: model || '', webResearch: !!webResearch, outcome,
        durationSec: Math.round((now() - started) / 100) / 10, calls, failed, completeEditFailed: tools.complete_edit?.failed || 0, tools,
        ...(tokenUsage ? { tokenUsage } : {}) };
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'agent-runs.jsonl');
        // Keep the newest half when the file grows past its cap.
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
          const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
          fs.writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
        }
        fs.appendFileSync(file, JSON.stringify(line) + '\n');
      } catch { /* A report must never fail a request. */ }
      return line;
    },
  };
}

module.exports = { createRunReport };
