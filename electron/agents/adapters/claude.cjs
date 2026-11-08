// Claude adapter (docs/design/agent-adapters.md): the shared tools as an in-process SDK MCP server,
// one resumed SDK session per chat. Wire format only: it never adds, drops or renames tools or
// instructions. Claude's own built-ins stay off except its web tools under Web research.
const research = require('../research.cjs');

// opts: { sdk, executablePath, cwd, env, cfg, system, tools, webResearch }
function createClaudeAdapter({ sdk, executablePath, cwd, env, cfg, system, tools, webResearch }) {
  const { z } = require('zod');
  let sessionId = null, server = null, query = null, current = null; // current: { onTool, attempt } for the running request
  const webTools = webResearch ? research.CLAUDE_WEB_TOOLS : [];

  // The server lives for one request; a callback outside a request is refused.
  const ensureServer = () => {
    if (server) return server;
    server = sdk.createSdkMcpServer({ name: 'clipcraft', version: '1.0.0', tools: [], alwaysLoad: true, timeout: 900000 });
    for (const declaration of tools) {
      // Public SDK instance registration accepts a whole Zod object, so open-ended external tool
      // schemas retain additional properties.
      server.instance.registerTool(declaration.name, { description: declaration.description, inputSchema: z.fromJSONSchema(declaration.parameters) }, async (args, extra) => {
        if (!current) return { isError: true, content: [{ type: 'text', text: 'No active editor request.' }] };
        return current.onTool(declaration.name, args, { nativeCallId: extra?.requestId, turnId: current.attempt });
      });
    }
    return server;
  };

  return {
    async turn({ prompt, images, attempt, signal, onTool, onSearch }) {
      current = { onTool, attempt };
      ensureServer();
      const controller = new AbortController(), stop = () => controller.abort();
      signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
      const visual = require('../agentImages.cjs').readImages(images || []);
      const content = visual.length ? [{ type: 'text', text: prompt }, ...visual.flatMap((image) => [{ type: 'text', text: image.label }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.data } }])] : prompt;
      const streamed = (async function* () { yield { type: 'user', session_id: sessionId || '', parent_tool_use_id: null, message: { role: 'user', content } }; })();
      query = sdk.query({ prompt: streamed, options: {
        pathToClaudeCodeExecutable: executablePath, cwd,
        env: { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
        systemPrompt: system, tools: webTools, mcpServers: { clipcraft: server }, strictMcpConfig: true,
        allowedTools: [...tools.map((tool) => `mcp__clipcraft__${tool.name}`), ...webTools], settingSources: [], permissionMode: 'dontAsk',
        persistSession: true, ...(sessionId ? { resume: sessionId } : {}),
        ...(cfg.model ? { model: cfg.model } : {}), ...(cfg.reasoningEffort ? { effort: cfg.reasoningEffort } : {}),
        abortController: controller, maxTurns: 100,
      } });
      const searches = new Map(); // web tool id -> query
      let result;
      try {
        for await (const message of query) {
          if (message.session_id) sessionId = message.session_id;
          if (onSearch && webResearch) for (const search of research.claudeSearchEvents(message)) {
            if (search.status === 'running') searches.set(search.id, search.query);
            else if (searches.has(search.id)) search.query = searches.get(search.id); else continue;
            onSearch(search);
          }
          if (message.type !== 'result') continue;
          if (message.subtype !== 'success' || message.is_error) throw new Error((message.errors || []).join('\n') || message.result || `Claude ended: ${message.subtype}`);
          result = { text: message.result || '' };
        }
        if (!result) throw new Error('Claude ended without a completed native response.');
        return result;
      } finally { query.close(); query = null; signal?.removeEventListener('abort', stop); }
    },
    usageTotal: () => null,
    // After each request: no callbacks until the next one, and the in-process server is closed.
    async endRun() { current = null; const s = server; server = null; await Promise.resolve(s?.instance?.close?.()).catch(() => {}); },
    close() { current = null; query?.close(); Promise.resolve(server?.instance?.close?.()).catch(() => {}); server = null; },
  };
}

module.exports = { createClaudeAdapter };
