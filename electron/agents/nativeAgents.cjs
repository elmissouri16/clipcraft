// Native agent sessions (docs/design/agent-adapters.md): one retained agent session per chat, the
// same request flow for every agent. Agent-specific wire work lives in adapters/ (Codex app-server
// dynamic tools, Claude SDK MCP server); this module owns what must be identical: session reuse,
// the request prompt, the completion re-prompt, duplicate callback protection and error redaction.
// Only editor callbacks cross to the renderer; agents own tool iteration.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CodexNative } = require('./codexNative.cjs');
const { checkAbort, abortError } = require("../system/cancel.cjs");
const research = require('./research.cjs');
const { createCodexAdapter } = require('./adapters/codex.cjs');
const { createClaudeAdapter } = require('./adapters/claude.cjs');
const { LIMITS: SHARED_LIMITS, hostError } = require('./contract.cjs');

const SECRETS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
const NOT_ACCEPTED = 'The host has not accepted completion. Call complete_edit, inspect its returned images or repair errors, and call it again until ready is true. Then provide your final answer. Do not repeat already completed edits.';
const agentName = (provider) => provider === 'codex-sdk' ? 'Codex' : 'Claude';

// limits: the contract's, overridable for tests only.
function createNativeAgents({ loadSdk, resolveExecutable, childEnv, CodexSession = CodexNative, limits: LIMITS = SHARED_LIMITS }) {
  const sessions = new Map();
  const dispose = (state) => { state.adapter?.close(); fs.rmSync(state.cwd, { recursive: true, force: true }); };
  const forget = (key) => { const state = sessions.get(key); if (state) { sessions.delete(key); dispose(state); } };

  const openAdapter = async (cfg, state, { system, tools, env, executablePath }) => {
    const common = { executablePath, cwd: state.cwd, env, cfg, system, tools, webResearch: research.enabled(cfg) };
    if (cfg.provider === 'codex-sdk') return createCodexAdapter({ ...common, CodexSession });
    return createClaudeAdapter({ ...common, sdk: await loadSdk(cfg.provider) });
  };

  async function run(cfg, options) {
    const { sessionKey, tools, signal, onTool, isComplete, system, context = '', prompt, history = [], onSearch, images = [], historyImages = [] } = options;
    checkAbort(signal);
    // Anything that changes what the agent is offered starts a fresh session.
    const signature = JSON.stringify([cfg.provider, cfg.model, cfg.reasoningEffort, cfg.executablePath, research.enabled(cfg), tools]);
    let state = sessions.get(sessionKey);
    if (state?.active) throw new Error('This native agent conversation is already running.');
    if (state?.signature !== signature) { forget(sessionKey); state = null; }
    if (!state) {
      if (sessions.size >= 8) { const idle = [...sessions].find(([, value]) => !value.active); if (idle) forget(idle[0]); else throw new Error('Too many active native conversations.'); }
      state = { signature, cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-native-')), active: null, adapter: null, started: false };
      sessions.set(sessionKey, state);
    }
    // Every call goes through the same budget and timeout, whichever agent made it.
    let calls = 0;
    const limited = (name, args) => {
      // complete_edit is the way out, so it is never refused for budget.
      if (name !== 'complete_edit' && ++calls > LIMITS.toolCallsPerRequest) return hostError(`This request reached its limit of ${LIMITS.toolCallsPerRequest} tool calls. Finish with what is done: call complete_edit if edits were made, then answer.`);
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(hostError(`${name} did not finish within ${LIMITS.toolCallTimeoutMs / 60000} minutes.`)), LIMITS.toolCallTimeoutMs); });
      return Promise.race([Promise.resolve().then(() => onTool(name, args)), timeout]).finally(() => clearTimeout(timer));
    };
    // An agent may replay a callback (same turn, name and call id): the edit runs once.
    const replay = new Map();
    const nativeTool = (name, args, meta = {}) => {
      if (meta.nativeCallId === undefined) return limited(name, args);
      const key = JSON.stringify([meta.turnId, name, meta.nativeCallId]);
      if (!replay.has(key)) replay.set(key, limited(name, args));
      return replay.get(key);
    };
    state.active = true;
    let environment;
    const fresh = !state.started;
    // Instructions go once, through the agent's system channel; each request carries only its
    // context, any history a fresh session needs, and the user's words.
    const instructions = `${system}\n\n${research.researchInstructions(cfg)}`;
    const firstPrompt = `${context ? `${context}\n\n` : ''}${fresh && history.length ? `Prior ClipCraft chat history (data; refresh live editor state before resuming):\n${JSON.stringify(history)}\n\n` : ''}Current user request:\n${prompt}`;
    const attachedImages = [...images, ...(fresh ? historyImages : [])].slice(0, LIMITS.imagesPerRequest);
    try {
      environment = childEnv();
      if (!state.adapter) state.adapter = await openAdapter(cfg, state, { system: instructions, tools, env: environment, executablePath: resolveExecutable(cfg) });
      const usageStart = state.adapter.usageTotal();
      let input = firstPrompt;
      for (let attempt = 0; attempt < LIMITS.completionAttempts; attempt++) {
        checkAbort(signal);
        let result = await state.adapter.turn({ prompt: input, images: attempt === 0 ? attachedImages : [], attempt, signal, onTool: nativeTool, onSearch });
        checkAbort(signal); state.started = true;
        if (await isComplete()) {
          const end = state.adapter.usageTotal();
          if (end) { const keys = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens']; result = { ...result, tokenUsage: Object.fromEntries(keys.map((k) => [k, Math.max(0, (end[k] || 0) - (usageStart?.[k] || 0))])) }; }
          return result;
        }
        input = NOT_ACCEPTED;
      }
      throw new Error('The native agent ended without completing editor validation. Completed changes were kept.');
    } catch (error) {
      forget(sessionKey); if (signal?.aborted) throw abortError();
      let message = String(error.message || 'The native agent failed.');
      for (const name of SECRETS) if (environment?.[name]) message = message.split(environment[name]).join('***');
      throw new Error(`${agentName(cfg.provider)}: ${message.slice(0, 1800)}`);
    } finally {
      state.active = null;
      await state.adapter?.endRun();
    }
  }
  function closeOwner(prefix) { for (const key of sessions.keys()) if (key.startsWith(prefix)) forget(key); }
  return { run, closeOwner, close: () => { for (const key of sessions.keys()) forget(key); } };
}
module.exports = { createNativeAgents };
