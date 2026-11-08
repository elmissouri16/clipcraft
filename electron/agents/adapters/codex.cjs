// Codex adapter (docs/design/agent-adapters.md): the shared tools as app-server dynamic tools on one
// retained thread. Wire format only: it never adds, drops or renames tools or instructions.
const { CodexNative } = require('../codexNative.cjs');

// opts: { executablePath, cwd, env, cfg, system, tools, webResearch, CodexSession }
function createCodexAdapter({ executablePath, cwd, env, cfg, system, tools, webResearch, CodexSession = CodexNative }) {
  const session = new CodexSession({ executablePath, cwd, env, cfg, system, tools, webSearch: webResearch });
  return {
    // One turn: resolves { text, tokenUsage? }. onTool(name, args, { nativeCallId, turnId }).
    turn: ({ prompt, images, signal, onTool, onSearch }) => session.run({ prompt, images, signal, onTool, onSearch }),
    // Codex reports running totals for the thread; the session manager takes the difference.
    usageTotal: () => session.tokenUsage?.total || null,
    endRun() {},
    close: () => session.close(),
  };
}

module.exports = { createCodexAdapter };
