// OpenCode adapter (docs/design/agent-adapters.md): the shared tools over a private MCP endpoint to one
// retained OpenCode session. Wire format only: it never adds, drops or renames tools or instructions.
const { OpenCodeSession } = require('../opencodeNative.cjs');

// opts: { sdk, executablePath, cwd, env, cfg, system, tools, webResearch, Session }
function createOpenCodeAdapter({ sdk, executablePath, cwd, env, cfg, system, tools, webResearch, Session = OpenCodeSession }) {
  const session = new Session({ sdk, executablePath, cwd, env, cfg, system, tools, webResearch });
  return {
    // One turn: resolves { text, tokenUsage? }. onTool(name, args, { nativeCallId, turnId }).
    turn: ({ prompt, images, attempt, signal, onTool, onSearch }) => session.run({ prompt, images, signal, onTool, onSearch, turnId: attempt }),
    // OpenCode reports running totals for the session; the session manager takes the difference.
    usageTotal: () => session.tokenUsage ? require('../opencodeNative.cjs').usageOf(session.tokenUsage) : null,
    endRun() {},
    close: () => session.close(),
  };
}

module.exports = { createOpenCodeAdapter };
