// Installed agent backends for CraftAI. Credentials remain owned by each CLI.
// Both SDKs return editor tool requests; the existing renderer executes them and
// owns history/Undo. No shell or filesystem tools are needed by these sessions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createRequire } = require('node:module');

const PROVIDERS = {
  'codex-sdk': { name: 'Codex SDK', cli: 'codex', module: '@openai/codex-sdk', login: 'codex login' },
  'claude-agent-sdk': { name: 'Claude Agent SDK', cli: 'claude', module: '@anthropic-ai/claude-agent-sdk', login: 'claude auth login' },
};
const isProvider = (id) => Object.hasOwn(PROVIDERS, id);
const abortError = () => Object.assign(new Error('Stopped.'), { name: 'AbortError' });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function searchDirectories(env = process.env, home = os.homedir(), platform = process.platform) {
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const inherited = env.PATH || env.Path || '';
  const dirs = [...inherited.split(delimiter), path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin')];
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Programs', 'Claude'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
    const nvm = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node');
    try {
      for (const version of fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))) {
        dirs.push(path.join(nvm, version, 'bin'));
      }
    } catch { /* NVM is optional. */ }
  }
  return [...new Set(dirs.filter(Boolean))];
}

function executableFile(file, platform = process.platform) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch { return false; }
}

// npm's Windows .cmd shims cannot be spawned directly by either SDK. Locate
// their actual package entry point without running a shell or parsing a shim.
function unwrapShim(file, provider, platform = process.platform, arch = process.arch) {
  const windowsCodexJs = platform === 'win32' && provider === 'codex-sdk' && /\.[cm]?js$/i.test(file);
  if (!/\.(cmd|bat)$/i.test(file) && !windowsCodexJs) return fs.realpathSync(file);
  const packages = path.join(path.dirname(file), 'node_modules');
  if (provider === 'claude-agent-sdk') {
    for (const entry of [path.join(packages, '@anthropic-ai', `claude-code-${platform}-${arch}`, 'claude.exe'),
      path.join(packages, '@anthropic-ai', 'claude-code', 'cli.js')]) {
      if (fs.existsSync(entry)) return entry;
    }
  } else {
    const vendors = [path.join(packages, '@openai', 'codex', 'vendor'), path.join(path.dirname(file), '..', 'vendor')];
    try {
      const nativeManifest = createRequire(file).resolve(`@openai/codex-${platform}-${arch}/package.json`);
      vendors.unshift(path.join(path.dirname(nativeManifest), 'vendor'));
    } catch { /* Older npm releases bundled their binaries under codex/vendor. */ }
    for (const vendor of vendors) {
      try {
        for (const target of fs.readdirSync(vendor)) {
          if (!target.includes('windows') || !target.startsWith(arch === 'arm64' ? 'aarch64' : 'x86_64')) continue;
          for (const subdir of ['bin', 'codex']) {
            const entry = path.join(vendor, target, subdir, 'codex.exe');
            if (fs.existsSync(entry)) return entry;
          }
        }
      } catch { /* Try the next installation. */ }
    }
  }
  throw new Error('Select the installed native executable instead of its .cmd or .bat launcher.');
}

function findExecutable(provider, configured = '', { env = process.env, home = os.homedir(), platform = process.platform, arch = process.arch } = {}) {
  if (!isProvider(provider)) throw new Error('Unknown installed agent provider.');
  const info = PROVIDERS[provider];
  const explicit = String(configured || '').trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error('The executable path must be an absolute file path, without command arguments.');
    if (!executableFile(explicit, platform)) throw new Error(`${info.name} executable not found or not executable: ${explicit}`);
    return unwrapShim(explicit, provider, platform, arch);
  }
  const names = platform === 'win32' ? [`${info.cli}.exe`, `${info.cli}.cmd`, info.cli] : [info.cli];
  for (const dir of searchDirectories(env, home, platform)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!executableFile(candidate, platform)) continue;
      try { return unwrapShim(candidate, provider, platform, arch); } catch { /* Keep searching. */ }
    }
  }
  throw new Error(`${info.name} could not find an installed ${info.cli} CLI. Install it, or choose its executable in Settings, then run ${info.login}.`);
}

const STEP_INSTRUCTIONS = `You are the decision engine for CraftAI inside ClipCraft, a video editor.
Use only the editor tools described in available_tools by returning tool calls in your JSON response.
Do not use your own shell, files, web, or other built-in tools. Do not edit any files directly.
The host executes calls and gives their results back in conversation. Read those results before deciding what to do next.
Return {"text":"...","calls":[{"name":"tool_name","arguments":"JSON object encoded as a string"}]}.
When you need tools, request the next useful calls. When finished, return a concise answer with calls: [].
Never claim a change was applied before its successful tool result appears in conversation.`;

function stepSchema(tools) {
  return {
    type: 'object', additionalProperties: false, required: ['text', 'calls'],
    properties: {
      text: { type: 'string' },
      calls: { type: 'array', ...(tools.length ? {} : { maxItems: 0 }), items: {
        type: 'object', additionalProperties: false, required: ['name', 'arguments'],
        properties: { name: { type: 'string', ...(tools.length ? { enum: tools.map((t) => t.name) } : {}) }, arguments: { type: 'string' } },
      } },
    },
  };
}

function parseStep(value, tools) {
  const output = typeof value === 'string' ? JSON.parse(value) : value;
  if (!isRecord(output) || typeof output.text !== 'string' || !Array.isArray(output.calls)) throw new Error('The installed agent returned an invalid editor response.');
  const allowed = new Set(tools.map((t) => t.name));
  const calls = output.calls.map((call) => {
    if (!isRecord(call) || !allowed.has(call.name) || typeof call.arguments !== 'string') throw new Error('The installed agent requested an unknown or invalid editor tool.');
    const args = JSON.parse(call.arguments);
    if (!isRecord(args)) throw new Error('The installed agent returned invalid tool arguments.');
    return { name: call.name, args };
  });
  const text = output.text;
  const parts = [...(text ? [{ text }] : []), ...calls.map((call) => ({ functionCall: call }))];
  if (!parts.length) parts.push({ text: '' });
  return { content: { role: 'model', parts }, text, calls };
}

function createLocalAgents({ loadSdk = (provider) => import(PROVIDERS[provider].module),
  resolveExecutable = findExecutable, execFileImpl = execFile, env = process.env, home = os.homedir() } = {}) {
  const imports = new Map();
  const sdkFor = (provider) => {
    if (!imports.has(provider)) imports.set(provider, Promise.resolve().then(() => loadSdk(provider)).catch((error) => { imports.delete(provider); throw error; }));
    return imports.get(provider);
  };
  const childEnv = () => {
    const result = { ...env, PATH: searchDirectories(env, home).join(path.delimiter) };
    // Native CLIs must not inherit Electron's Node-mode switch.
    delete result.ELECTRON_RUN_AS_NODE;
    return result;
  };
  const runCli = (file, args) => new Promise((resolve, reject) => {
    const js = /\.[cm]?js$/i.test(file);
    execFileImpl(js ? 'node' : file, js ? [file, ...args] : args,
      { env: childEnv(), windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 },
      (error, stdout, stderr) => error ? reject(Object.assign(error, { cliOutput: String(stdout || '') + String(stderr || '') })) : resolve(String(stdout || '')));
  });

  async function status(cfg) {
    const info = PROVIDERS[cfg.provider];
    if (!info) return { ok: false, installed: false, error: 'Unknown installed agent provider.' };
    try {
      const executablePath = resolveExecutable(cfg.provider, cfg.executablePath, { env, home });
      await sdkFor(cfg.provider);
      const version = (await runCli(executablePath, ['--version'])).trim().slice(0, 100);
      let authenticated = null;
      try {
        const auth = await runCli(executablePath, cfg.provider === 'codex-sdk' ? ['login', 'status'] : ['auth', 'status', '--json']);
        authenticated = cfg.provider === 'codex-sdk' ? true : JSON.parse(auth).loggedIn === true;
      } catch (error) {
        // Older CLIs may not expose an auth-status command. A real connection
        // test remains available; never return the CLI's credential/account JSON.
        if (/not logged in|not authenticated|login required/i.test(error.cliOutput || '')) authenticated = false;
      }
      return { ok: true, installed: true, executablePath, version, authenticated, loginCommand: info.login };
    } catch (error) {
      return { ok: false, installed: false, error: error.message, loginCommand: info.login };
    }
  }

  async function withSession(cfg, options, run) {
    const executablePath = resolveExecutable(cfg.provider, cfg.executablePath, { env, home });
    const sdk = await sdkFor(cfg.provider);
    const controller = new AbortController();
    let timedOut = false;
    const stop = () => controller.abort();
    if (options.signal?.aborted) throw abortError();
    options.signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs || 120000);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-agent-'));
    try {
      return await run({ sdk, executablePath, controller, cwd, env: childEnv() });
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (timedOut) throw new Error(`${PROVIDERS[cfg.provider].name} timed out. Try again or choose a different model.`);
      // SDK errors may include full subprocess diagnostics. Retain the useful
      // reason while masking any explicitly configured key, if one was inherited.
      let message = String(error.message || 'The installed agent failed.');
      for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
        if (env[key]) message = message.split(env[key]).join('***');
      }
      throw new Error(`${PROVIDERS[cfg.provider].name}: ${message.slice(0, 1800)}`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stop);
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }

  const claudeOptions = (session, cfg, system) => ({
    pathToClaudeCodeExecutable: session.executablePath, cwd: session.cwd,
    env: { ...session.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    abortController: session.controller, systemPrompt: system,
    ...(cfg.model ? { model: cfg.model } : {}),
    tools: [], allowedTools: [], mcpServers: {}, strictMcpConfig: true,
    settingSources: [], permissionMode: 'dontAsk', persistSession: false,
    canUseTool: async () => ({ behavior: 'deny', message: 'Use CraftAI editor tools in the structured response.' }),
    maxTurns: 4,
  });

  async function complete(cfg, { system = '', prompt, schema, ...options }) {
    return withSession(cfg, options, async (session) => {
      if (cfg.provider === 'codex-sdk') {
        const codex = new session.sdk.Codex({ codexPathOverride: session.executablePath, env: session.env,
          config: { features: { shell_tool: false, unified_exec: false, apps: false, plugins: false, skip_host_skill_discovery: true },
            skills: { include_instructions: false }, mcp_servers: {},
          },
        });
        const thread = codex.startThread({
          ...(cfg.model ? { model: cfg.model } : {}), workingDirectory: session.cwd,
          skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', webSearchMode: 'disabled',
        });
        const result = await thread.run(`${system}\n\n${prompt}`, { outputSchema: schema, signal: session.controller.signal });
        return result.finalResponse;
      }
      const query = session.sdk.query({ prompt, options: {
        ...claudeOptions(session, cfg, system), ...(schema ? { outputFormat: { type: 'json_schema', schema } } : {}),
      } });
      try {
        for await (const message of query) {
          if (message.type !== 'result') continue;
          if (message.subtype !== 'success' || message.is_error) throw new Error((message.errors || []).join('\n') || message.result || `Agent stopped: ${message.subtype}`);
          if (schema) {
            if (message.structured_output === undefined) throw new Error('The installed Claude CLI returned no structured output. Update Claude and try again.');
            return message.structured_output;
          }
          return message.result || '';
        }
        throw new Error('The installed agent ended without a response.');
      } finally { query.close(); }
    });
  }

  async function chat(cfg, options) {
    const result = await complete(cfg, { ...options, prompt: JSON.stringify({ messages: options.messages }) });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  async function agentStep(cfg, { system = '', contents, tools = [], ...options }) {
    const result = await complete(cfg, {
      ...options, system: `${STEP_INSTRUCTIONS}\n\n${system}`, schema: stepSchema(tools),
      prompt: JSON.stringify({ available_tools: tools, conversation: contents }),
    });
    return parseStep(result, tools);
  }

  async function listModels(cfg) {
    if (cfg.provider === 'codex-sdk') {
      // Codex has no SDK model-list method. Reuse its own cached catalog when
      // present, and always allow the CLI default or a manually entered model.
      try {
        const cached = JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'models_cache.json'), 'utf8'));
        const models = (cached.models || []).map((m) => m.slug).filter((id) => typeof id === 'string');
        if (models.length) return { ok: true, models: [...new Set(models)].sort(), fromCache: true };
      } catch { /* A fresh installation may not have a catalog yet. */ }
      return { ok: true, models: [], useCliDefault: true };
    }
    try {
      const models = await withSession(cfg, { timeoutMs: 20000 }, async (session) => {
        const query = session.sdk.query({ prompt: (async function* () {})(), options: claudeOptions(session, cfg, '') });
        try { return (await query.supportedModels()).map((model) => model.value); }
        finally { query.close(); }
      });
      return { ok: true, models };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  return { status, chat, agentStep, listModels };
}

module.exports = { ...createLocalAgents(), createLocalAgents, findExecutable, searchDirectories, unwrapShim,
  isProvider, PROVIDERS, stepSchema, parseStep };
