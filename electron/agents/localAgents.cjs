// Installed agent backends for CraftAI. Credentials remain owned by each CLI.
// Editor tasks use native tool callbacks through Codex app-server and the
// Claude in-process SDK. The renderer owns validated mutations and Undo. Image generation runs separately with the installed skill;
// web research (Codex live search, Claude WebSearch/WebFetch) follows Settings > AI assistant > Web research.
const fs = require('node:fs');
const research = require('./research.cjs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createRequire } = require('node:module');
const { filterLevels } = require('./thinking.cjs');
const { readImages } = require('./agentImages.cjs');
const { abortable } = require('../system/cancel.cjs');
const { runtimePath } = require('./agentRuntime.cjs');
let runtimeDirectory = null;
const setRuntimeDirectory = directory => { runtimeDirectory = directory; };

const PROVIDERS = {
  'codex-sdk': { name: 'Codex SDK', cli: 'codex', module: '@openai/codex-sdk', login: 'codex login' },
  'claude-agent-sdk': { name: 'Claude Agent SDK', cli: 'claude', module: '@anthropic-ai/claude-agent-sdk', login: 'claude auth login' },
  // OpenCode 2.x: the binary serves a private API the @opencode/client package talks to (opencodeNative.cjs).
  'opencode-sdk': { name: 'OpenCode SDK', cli: 'opencode', module: '@opencode/client', login: 'opencode auth login' },
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
  const real = fs.realpathSync(file);
  const windowsCodexJs = provider === 'codex-sdk' && /\.[cm]?js$/i.test(real);
  if (!/\.(cmd|bat)$/i.test(file) && !windowsCodexJs) return fs.realpathSync(file);
  const packages = path.join(path.dirname(file), 'node_modules');
  if (provider === 'claude-agent-sdk') {
    for (const entry of [path.join(packages, '@anthropic-ai', `claude-code-${platform}-${arch}`, 'claude.exe'),
      path.join(packages, '@anthropic-ai', 'claude-code', 'cli.js')]) {
      if (fs.existsSync(entry)) return entry;
    }
  } else if (provider === 'opencode-sdk') {
    // npm's @opencode/cli puts the platform binary in @opencode/cli-<platform>-<arch>/bin.
    const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[platform] || platform;
    for (const entry of [path.join(packages, '@opencode', `cli-${os}-${arch}`, 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode'),
      path.join(packages, '@opencode', 'cli', 'bin', 'opencode.exe')]) {
      if (fs.existsSync(entry)) return entry;
    }
  } else {
    const vendors = [path.join(path.dirname(real), '..', 'vendor'), path.join(packages, '@openai', 'codex', 'vendor'), path.join(path.dirname(file), "../..", 'vendor')];
    try {
      const nativeManifest = createRequire(real).resolve(`@openai/codex-${platform}-${arch}/package.json`);
      vendors.unshift(path.join(path.dirname(nativeManifest), 'vendor'));
    } catch { /* Older npm releases bundled their binaries under codex/vendor. */ }
    for (const vendor of vendors) {
      try {
        for (const target of fs.readdirSync(vendor)) {
          const suffix = { win32:'windows', darwin:'apple-darwin', linux:'linux' }[platform];
          if (!target.includes(suffix) || !target.startsWith(arch === 'arm64' ? 'aarch64' : 'x86_64')) continue;
          for (const subdir of ['bin', 'codex']) {
            const entry = path.join(vendor, target, subdir, platform === 'win32' ? 'codex.exe' : 'codex');
            if (fs.existsSync(entry)) return entry;
          }
        }
      } catch { /* Try the next installation. */ }
    }
  }
  throw new Error('Select the installed native executable instead of its .cmd or .bat launcher.');
}

function findExecutable(provider, configured = '', { env = process.env, home = os.homedir(), platform = process.platform, arch = process.arch, runtimeRoot = runtimeDirectory } = {}) {
  if (!isProvider(provider)) throw new Error('Unknown installed agent provider.');
  const info = PROVIDERS[provider];
  const explicit = String(configured || '').trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error('The executable path must be an absolute file path, without command arguments.');
    if (!executableFile(explicit, platform)) throw new Error(`${info.name} executable not found or not executable: ${explicit}`);
    return unwrapShim(explicit, provider, platform, arch);
  }
  // An explicitly downloaded, verified runtime takes precedence over stale PATH installs.
  const managed = runtimePath(runtimeRoot, provider, { platform, arch });
  if (managed && executableFile(managed, platform)) return managed;
  const names = platform === 'win32' ? [`${info.cli}.exe`, `${info.cli}.cmd`, info.cli] : [info.cli];
  for (const dir of searchDirectories(env, home, platform)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!executableFile(candidate, platform)) continue;
      try { return unwrapShim(candidate, provider, platform, arch); } catch { /* Keep searching. */ }
    }
  }
  throw new Error(`${info.name} could not find an installed ${info.cli} CLI. Download the native agent in Settings, or choose an existing executable. No Node or npm installation is needed.`);
}

const STEP_INSTRUCTIONS = `You are the decision engine for CraftAI inside ClipCraft, a video editor.
Use only the editor tools described in available_tools by returning tool calls in your JSON response.
Do not use your own shell or file tools. Do not edit any files directly.
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
  resolveExecutable = findExecutable, execFileImpl = execFile, env = process.env, home = os.homedir(), CodexCatalog = require('./codexNative.cjs').CodexNative } = {}) {
  const imports = new Map();
  const catalogs = new Map();
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
      const minimum = require('./runtimeManifest.json')[cfg.provider].cliVersion;
      const found = /\b(\d+\.\d+\.\d+)\b/.exec(version)?.[1];
      if (found) {
        const a=found.split('.').map(Number),b=minimum.split('.').map(Number);
        const different=a.findIndex((v,i)=>v!==b[i]);
        if (different>=0 && a[different]<b[different]) return { ok:false, installed:true, compatible:false, executablePath, version,
          error:`This ${info.cli} installation is too old for the agent SDK. Download the supported native engine in Settings (${minimum}), or choose a newer executable.` };
      }
      let authenticated = null;
      try {
        const auth = await runCli(executablePath, cfg.provider === 'codex-sdk' ? ['login', 'status'] : cfg.provider === 'opencode-sdk' ? ['auth', 'list'] : ['auth', 'status', '--json']);
        // OpenCode lists its stored provider credentials; an empty list means no provider is connected yet.
        authenticated = cfg.provider === 'codex-sdk' ? true : cfg.provider === 'opencode-sdk' ? /\bstored\b/i.test(auth) ? true : /no credentials|not logged in|nothing/i.test(auth) ? false : null : JSON.parse(auth).loggedIn === true;
      } catch (error) {
        // Older CLIs may not expose an auth-status command. A real connection
        // test remains available; never return the CLI's credential/account JSON.
        if (/not logged in|not authenticated|login required/i.test(error.cliOutput || '')) authenticated = false;
      }
      const quoted=process.platform==='win32'?`"${executablePath}"`:`'${executablePath.replace(/'/g,"'\\''")}'`;
      return { ok: true, installed: true, executablePath, version, authenticated, loginCommand:`${quoted} ${cfg.provider === 'codex-sdk' ? 'login' : 'auth login'}` };
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

  const claudeOptions = (session, cfg, system, web = false) => ({
    pathToClaudeCodeExecutable: session.executablePath, cwd: session.cwd,
    env: { ...session.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    abortController: session.controller, systemPrompt: system,
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(cfg.reasoningEffort ? { effort: cfg.reasoningEffort } : {}),
    // Only Claude's web tools, and only with Web research on for an editing step.
    tools: web ? research.CLAUDE_WEB_TOOLS : [], allowedTools: web ? research.CLAUDE_WEB_TOOLS : [], mcpServers: {}, strictMcpConfig: true,
    settingSources: [], permissionMode: 'dontAsk', persistSession: false,
    canUseTool: async (name) => web && research.CLAUDE_WEB_TOOLS.includes(name) ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Use CraftAI editor tools in the structured response.' },
    maxTurns: web ? 12 : 4,
  });

  async function complete(cfg, { system = '', prompt, schema, images = [], onSearch, webResearch = false, ...options }) {
    return withSession(cfg, options, async (session) => {
      if (cfg.provider === 'opencode-sdk') {
        return require('./opencodeNative.cjs').runOnce({ sdk: session.sdk, executablePath: session.executablePath, cwd: session.cwd, env: session.env, cfg,
          system, prompt, schema, images, signal: session.controller.signal, webResearch: webResearch && research.enabled(cfg), onSearch });
      }
      if (cfg.provider === 'codex-sdk') {
        if(!Array.isArray(images)||images.length>6)throw new Error('Use at most six inspected frames.');
        const attachments=images.map((image,index)=>{
          const bytes=fs.readFileSync(image.path);
          if(bytes.length>8*1024*1024||bytes[0]!==255||bytes[1]!==216)throw new Error('The inspected frame is not a readable JPEG.');
          const file=path.join(session.cwd,`frame-${index+1}.jpg`);fs.writeFileSync(file,bytes,{flag:'wx'});
          return {file,label:String(image.label||`Frame ${index+1}`).slice(0,600)};
        });
        const codex = new session.sdk.Codex({ codexPathOverride: session.executablePath, env: session.env,
          config: { features: { ...require('./codexNative.cjs').CODEX_FEATURES_OFF, skip_host_skill_discovery: true },
            skills: { include_instructions: false }, mcp_servers: {},
          },
        });
        const thread = codex.startThread({
          ...(cfg.model ? { model: cfg.model } : {}), workingDirectory: session.cwd,
          ...(cfg.reasoningEffort ? { modelReasoningEffort: cfg.reasoningEffort } : {}),
          skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', webSearchMode: research.enabled(cfg) ? 'live' : 'disabled',
        });
        const text=`${system}\n\n${prompt}${attachments.length?'\n\nAttached images are actual video frame captures, in this order:\n'+attachments.map((image,i)=>`${i+1}. ${image.label}`).join('\n'):''}`;
        const input=attachments.length?[{type:'text',text},...attachments.map(image=>({type:'local_image',path:image.file}))]:text;
        const { events } = await thread.runStreamed(input, { outputSchema: schema, signal: session.controller.signal });
        let finalResponse, completed = false;
        const searches = new Map();
        try {
          for await (const event of events) {
            if (event.type === 'error') throw new Error(event.message);
            if (event.type === 'turn.failed') throw new Error(event.error?.message || 'Codex turn failed.');
            if (event.type === 'turn.completed') completed = true;
            const item = event.item;
            if (item?.type === 'web_search') {
              const query = String(item.query || item.action?.query || item.action?.queries?.join('; ') || item.action?.url || '').slice(0, 1000);
              const search = { id: String(item.id).slice(0, 100), query, status: event.type === 'item.completed' ? (item.status === 'failed' ? 'error' : 'done') : 'running' };
              searches.set(search.id, search); onSearch?.(search);
            }
            if (event.type === 'item.completed' && item?.type === 'agent_message') finalResponse = item.text;
          }
          if (!completed || typeof finalResponse !== 'string') throw new Error('Codex ended without a completed response.');
          return finalResponse;
        } finally {
          for (const search of searches.values()) if (search.status === 'running') onSearch?.({ ...search, status: 'error', detail: session.controller.signal.aborted ? 'Stopped.' : 'Search did not complete.' });
        }
      }
      const imageData = readImages(images);
      const streamedPrompt = imageData.length ? (async function* () {
        yield { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: [
          { type: 'text', text: prompt }, ...imageData.flatMap(image => [{ type: 'text', text: image.label }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.data } }]),
        ] } };
      })() : prompt;
      const query = session.sdk.query({ prompt: streamedPrompt, options: {
        ...claudeOptions(session, cfg, system, webResearch && research.enabled(cfg)), ...(schema ? { outputFormat: { type: 'json_schema', schema } } : {}),
      } });
      const searches = new Map();
      try {
        for await (const message of query) {
          if (onSearch && webResearch && research.enabled(cfg)) for (const search of research.claudeSearchEvents(message)) {
            if (search.status === 'running') searches.set(search.id, search.query);
            else if (searches.has(search.id)) search.query = searches.get(search.id); else continue;
            onSearch(search);
          }
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
    const researchNote = research.researchInstructions(cfg);
    const result = await complete(cfg, {
      ...options, system: `${STEP_INSTRUCTIONS}\n\n${system}\n\n${researchNote}`, schema: stepSchema(tools), webResearch: true,
      prompt: JSON.stringify({ available_tools: tools, conversation: contents.map(({ role, parts }) => ({ role, parts })) }),
    });
    return parseStep(result, tools);
  }

  async function generateImage(cfg, { prompt, outputDir, referencePaths = [], ratio = '16:9', width, height, transparentBackground = false, ...options }) {
    if (cfg.provider !== 'codex-sdk') throw new Error('Image generation with the installed imagegen skill requires Codex SDK in Settings.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('Provide an image prompt of 1–16000 characters.');
    if (!Array.isArray(referencePaths) || referencePaths.length > 3) throw new Error('Use at most three reference images.');
    if (width !== undefined || height !== undefined) require("../media/imageFrame.cjs").validateImageFrame(width, height);
    const codexHome = path.resolve(env.CODEX_HOME || path.join(home, '.codex'));
    const skillPath = path.join(codexHome, 'skills', '.system', 'imagegen', 'SKILL.md');
    let skill;
    try { skill = fs.readFileSync(skillPath, 'utf8'); }
    catch { throw new Error('The installed Codex imagegen skill was not found. Update Codex to install its bundled imagegen skill.'); }
    return withSession(cfg, { timeoutMs: 600000, ...options }, async (session) => {
      const references = referencePaths.map((source, i) => {
        const ext = path.extname(source).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Character references must be PNG, JPEG or WebP images.');
        const stat = fs.statSync(source);
        if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('Reference images must be files under 50 MB.');
        const dest = path.join(session.cwd, `reference-${i + 1}${ext}`);
        fs.copyFileSync(source, dest);
        return dest;
      });
      const codex = new session.sdk.Codex({ codexPathOverride: session.executablePath, env: session.env,
        config: { features: { image_generation: true, code_mode_host: true, shell_tool: false, unified_exec: false, apps: false, plugins: false,
          multi_agent: false, memories: false, skip_host_skill_discovery: true },
          skills: { include_instructions: false }, mcp_servers: {},
        },
      });
      const thread = codex.startThread({ ...(cfg.model ? { model: cfg.model } : {}),
        ...(cfg.reasoningEffort ? { modelReasoningEffort: cfg.reasoningEffort } : {}),
        workingDirectory: session.cwd, skipGitRepoCheck: true, sandboxMode: 'workspace-write',
        approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled',
      });
      const instruction = `You are generating one original image for a ClipCraft video scene. Use the installed $imagegen skill supplied below and its native image_gen tool.
Generate exactly one still PNG image from the scene request. Use native image generation only; do not use shell commands, code, SVG placeholders, other providers, API-key fallbacks, or copy a reference as the output.
References, when attached, are existing project images. Preserve the requested character identity, construction and visual style across scenes. Reference file paths: ${JSON.stringify(references)}.
Compose for project aspect ratio ${String(ratio).slice(0, 16)}. Transparent background requested: ${transparentBackground === true}.
${width && height ? `The video template canvas is ${width}x${height} pixels. Generate at these dimensions when supported; otherwise use the nearest supported dimensions with the same ${String(ratio).slice(0, 16)} aspect ratio. Compose edge to edge in this orientation, without borders or letterboxing. Keep the subject inside the canvas; ClipCraft will proportionally crop and resize the imported copy to the exact template dimensions if necessary.` : ''}
The host will copy the native artifact into persistent project media storage. Leave the generated native file in its original location; do not move or rename it. If native image generation is unavailable, say so honestly and generate nothing.
Installed imagegen skill (${skillPath}):
${skill}

Scene request:
${prompt.trim()}`;
      const result = await thread.run([{ type: 'text', text: instruction }, ...references.map((file) => ({ type: 'local_image', path: file }))],
        { signal: session.controller.signal });
      if (session.controller.signal.aborted) throw abortError();
      // codex exec/SDK does not expose the app-server savedPath event. Its native
      // outputs live under this new thread's generated_images folder instead.
      const id = thread.id;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Codex did not return an image-generation thread.');
      const roots = [path.join(codexHome, 'generated_images', id), path.join(session.cwd, 'generated_images', id)];
      const files = [];
      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== path.join(fs.realpathSync(path.dirname(root)), id)) throw new Error('Codex returned an unsafe image artifact directory.');
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!/\.png$/i.test(entry.name)) continue;
          const file = path.join(root, entry.name), stat = fs.lstatSync(file);
          if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('Codex returned an invalid image artifact.');
          files.push(file);
        }
      }
      if (files.length !== 1) throw new Error(files.length
        ? 'Codex generated multiple images for one scene. Request one image per scene and try again.'
        : `Codex produced no native image. No image was added. ${String(result.finalResponse || 'Check that your installed Codex version, account and selected model support image generation.').slice(0, 600)}`);
      const bytes = fs.readFileSync(files[0]);
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Codex returned an invalid PNG image.');
      if (session.controller.signal.aborted) throw abortError();
      fs.mkdirSync(outputDir, { recursive: true });
      const dest = path.join(outputDir, `codex-${require('node:crypto').randomUUID()}.png`);
      fs.writeFileSync(dest, bytes, { flag: 'wx' });
      return { path: dest, source: 'codex-imagegen', prompt: prompt.trim() };
    });
  }

  async function listModels(cfg, { signal, refresh=false } = {}) {
    if (cfg.provider === 'codex-sdk' || cfg.provider === 'opencode-sdk') {
      if(signal?.aborted)throw abortError();
      const key=JSON.stringify([cfg.provider,cfg.executablePath||'',env.CODEX_HOME||home]);
      const cached=catalogs.get(key);
      if(cached&&(cached.pending||(!refresh&&Date.now()-cached.time<30000)))return abortable(cached.promise,signal);
      const entry={pending:true,time:Date.now()};
      const load=cfg.provider==='codex-sdk'?loadCodexModels(cfg):loadOpenCodeModels(cfg);
      entry.promise=load.then(result=>{entry.pending=false;entry.time=Date.now();if(!result.models?.length||result.fromCache)catalogs.delete(key);return result;},error=>{catalogs.delete(key);throw error;});
      catalogs.set(key,entry);
      if(catalogs.size>16){const oldest=[...catalogs].find(([id,value])=>id!==key&&!value.pending);if(oldest)catalogs.delete(oldest[0]);}
      return abortable(entry.promise,signal);
    }
    try {
      const entries = await withSession(cfg, { timeoutMs: 20000, signal }, async (session) => {
        const query = session.sdk.query({ prompt: (async function* () {})(), options: claudeOptions(session, { ...cfg, model: '', reasoningEffort: '' }, '') });
        try { return await query.supportedModels(); }
        finally { query.close(); }
      });
      const modelCapabilities = Object.create(null);
      for (const model of entries) {
        const capability = { reasoningEfforts: model.supportsEffort === false ? [] : filterLevels(cfg.provider, model.supportedEffortLevels) };
        modelCapabilities[model.value] = capability;
        if (model.resolvedModel) modelCapabilities[model.resolvedModel] = capability;
      }
      return { ok: true, models: entries.map((model) => model.value), modelCapabilities };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  // OpenCode's catalog comes from a short-lived private server (opencodeNative.cjs listModels).
  async function loadOpenCodeModels(cfg) {
    const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-opencode-models-'));
    try {
      const sdk=await sdkFor(cfg.provider);
      return await require('./opencodeNative.cjs').listModels({ sdk, executablePath:resolveExecutable(cfg.provider,cfg.executablePath,{env,home}), cwd, env:childEnv() });
    } catch(error) {
      return { ok:true, models:[], useCliDefault:true, notice:`The live model list is unavailable (${String(error.message||error).slice(0,200)}). The OpenCode default and custom provider/model IDs are still supported.` };
    } finally { fs.rmSync(cwd,{recursive:true,force:true}); }
  }
  async function loadCodexModels(cfg) {
      let liveError;
      const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-codex-models-'));
      let client;
      try {
        client=new CodexCatalog({executablePath:resolveExecutable(cfg.provider,cfg.executablePath,{env,home}),cwd,env:childEnv(),catalogOnly:true});
        const entries=await client.listModels();
        if(entries.length)return {ok:true,models:entries.map(m=>m.model),modelLabels:Object.fromEntries(entries.map(m=>[m.model,m.displayName||m.model])),
          modelCapabilities:Object.fromEntries(entries.map(m=>[m.model,{reasoningEfforts:filterLevels(cfg.provider,(m.supportedReasoningEfforts||[]).map(level=>level.reasoningEffort)),defaultReasoningEffort:m.defaultReasoningEffort,inputModalities:m.inputModalities||['text','image']}]))};
      } catch(error){liveError=error.message;}
      finally {client?.close();fs.rmSync(cwd,{recursive:true,force:true});}
      // Older/offline CLIs can still use their cached catalog, a manually
      // entered model, or the recommended model selected by the installed CLI.
      try {
        const cached = JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'models_cache.json'), 'utf8'));
        const visible=(cached.models||[]).filter(m=>!m.hidden&&m.visibility!=='hide');
        const models = visible.map((m) => m.slug).filter((id) => typeof id === 'string');
        const modelCapabilities = Object.fromEntries((cached.models || []).filter((m) => typeof m.slug === 'string').map((m) => [m.slug, {
          reasoningEfforts: filterLevels(cfg.provider, (m.supported_reasoning_levels || []).map((level) => level.effort)),
        }]));
        if (models.length) return { ok: true, models: [...new Set(models)].sort(), modelCapabilities, fromCache: true };
      } catch { /* A fresh installation may not have a catalog yet. */ }
      return { ok: true, models: [], useCliDefault: true, notice:liveError?'The live model list is unavailable. The CLI default and custom model IDs are still supported.':undefined };
  }
  const native = require('./nativeAgents.cjs').createNativeAgents({ loadSdk:sdkFor, childEnv, resolveExecutable:cfg=>resolveExecutable(cfg.provider,cfg.executablePath,{env,home}) });
  return { status, chat, agentStep, listModels, generateImage, runEditorNative:native.run, closeNativeOwner:native.closeOwner, closeNativeSessions:native.close };
}

module.exports = { ...createLocalAgents(), setRuntimeDirectory, createLocalAgents, findExecutable, searchDirectories, unwrapShim,
  isProvider, PROVIDERS, stepSchema, parseStep };
