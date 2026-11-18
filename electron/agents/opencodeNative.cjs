// OpenCode (v2) native runtime for CraftAI (docs/agents/native-agent-tools.md): a private `opencode serve`
// per chat on 127.0.0.1 with a random password and an isolated config directory, the editor tools served
// to it over MCP (Streamable HTTP on 127.0.0.1, bearer token; OpenCode has no in-process tool callbacks),
// and @opencode/client as the API client. The session runs as a ClipCraft agent defined in the session
// directory's opencode.json: its instructions are the system prompt, and its permissions deny every
// action but the ClipCraft tools (and OpenCode's web tools under Web research). No shell, npm or Node is
// involved; the binary is the installed OpenCode CLI or the managed download (agentRuntime.cjs).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { abortError, checkAbort, abortable } = require('../system/cancel.cjs');
const { LIMITS } = require('./contract.cjs');

const AGENT = 'clipcraft'; // the agent every session runs as
const MCP_SERVER = 'clipcraft'; // OpenCode names its tools clipcraft_<tool>
const WEB_TOOLS = ['websearch', 'webfetch'];
const EVENT_TYPES = ['permission.asked', 'session.execution.started', 'session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted',
  'session.idle', 'session.text.ended', 'session.tool.input.started', 'session.tool.called', 'session.tool.success', 'session.tool.failed', 'session.usage.updated', 'session.step.failed'];
const textResult = (text, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] });
const errorResult = (error) => textResult(JSON.stringify({ error }), true);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realPath = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
// The server's port no longer answers (its process is gone): fetch reports ECONNREFUSED on the cause.
const refused = (error) => [error?.code, error?.cause?.code, error?.cause?.cause?.code].includes('ECONNREFUSED');
const REFUSED_LIMIT = 3; // consecutive refused reconnects before the server counts as gone

// Last matching rule wins: nothing but the ClipCraft tools, plus OpenCode's own web tools under Web research.
function permissionRules(webResearch) {
  return [{ action: '*', resource: '*', effect: 'deny' }, { action: `${MCP_SERVER}_*`, resource: '*', effect: 'allow' },
    ...(webResearch ? WEB_TOOLS.map((action) => ({ action, resource: '*', effect: 'allow' })) : [])];
}
// The session directory's opencode.json (project config; the global config is not loaded, see startServer).
// The MCP server is not in it: OpenCode 2.2 does not activate MCP servers from a project file, so the
// endpoint is registered through the server's MCP API once it runs (OpenCodeSession.ready).
function projectConfig({ system, webResearch = false }) {
  return {
    $schema: 'https://opencode.ai/config.json', default_agent: AGENT, share: 'disabled', snapshots: false, update: 'disable', instructions: [],
    ...(webResearch ? {} : { websearch: false }),
    agents: { [AGENT]: { mode: 'primary', description: 'ClipCraft video editor', system, permissions: permissionRules(webResearch) } },
    permissions: permissionRules(webResearch),
    mcp: { servers: {} },
  };
}
// The editor endpoint as an OpenCode remote MCP server: bearer token, no OAuth, tools exposed directly (no code mode).
const mcpConfig = (endpoint) => ({ type: 'remote', url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` }, oauth: false, codemode: false,
  timeout: { startup: 20000, catalog: 20000, execution: LIMITS.toolCallTimeoutMs + 60000 } });
// cfg.model is "provider/model" (OpenCode's own ids); the reasoning effort is the model variant.
function modelRef(cfg) {
  const m = /^([^/#\s]+)\/([^#\s]+)$/.exec(String(cfg?.model || '').trim());
  if (!m) return null;
  return { providerID: m[1], id: m[2], ...(cfg.reasoningEffort ? { variant: cfg.reasoningEffort } : {}) };
}
const authHeaders = (password) => ({ Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` });
const usageOf = (tokens) => tokens ? { inputTokens: tokens.input || 0, cachedInputTokens: tokens.cache?.read || 0, outputTokens: tokens.output || 0, reasoningOutputTokens: tokens.reasoning || 0,
  totalTokens: (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0) } : null;

// `opencode serve` on a random port. The config directory is a fresh one inside the session directory, so the
// user's global opencode.json (their MCP servers, agents) never reaches an editor session; credentials live in
// OpenCode's data directory and stay available. Resolves { url, password, close } once the server listens.
function startServer({ executablePath, cwd, env, spawnImpl = spawn, timeoutMs = 30000 }) {
  const password = crypto.randomBytes(24).toString('base64url');
  const configHome = path.join(cwd, 'config');
  fs.mkdirSync(path.join(configHome, 'opencode'), { recursive: true });
  const proc = spawnImpl(executablePath, ['serve', '--hostname=127.0.0.1', '--port=0'], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, OPENCODE_SERVER_PASSWORD: password, XDG_CONFIG_HOME: configHome } });
  proc.stderr?.on('data', () => {}); // never surface credential-bearing diagnostics
  const lines = readline.createInterface({ input: proc.stdout });
  const close = () => { try { lines.close(); } catch { /* closed */ } try { proc.kill(); } catch { /* gone */ } };
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { close(); finish(reject, new Error('OpenCode did not start its server in time.')); }, timeoutMs);
    lines.on('line', (line) => {
      const m = /server listening on\s+(https?:\/\/\S+)/i.exec(line);
      if (m) finish(resolve, { url: m[1].replace(/\/+$/, ''), password, close, process: proc });
    });
    proc.on('error', (error) => finish(reject, new Error(`OpenCode could not start: ${error.message}`)));
    proc.on('exit', (code) => finish(reject, new Error(`OpenCode exited before its server started (code ${code}). Check the installed OpenCode version (2.x) and sign-in.`)));
  });
}

// The editor tools for one session, as an MCP server on 127.0.0.1 (Streamable HTTP) that only this
// session's OpenCode knows the token of. onCall({ name, args, callId, signal }) returns the MCP result.
class NativeMcpEndpoint {
  constructor({ tools = [], instructions = '', onCall, version = '1.0.0' }) {
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
    this.instructions = instructions; this.onCall = onCall; this.version = version;
    this.token = crypto.randomBytes(32).toString('hex'); this.sessions = new Map(); this.server = null; this.port = 0;
  }
  get url() { return `http://127.0.0.1:${this.port}/mcp`; }
  async start() {
    const server = http.createServer((req, res) => { this.handle(req, res).catch((error) => this.fail(res, 500, error.message)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    this.server = server; this.port = server.address().port;
    return this;
  }
  fail(res, code, message) {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  }
  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/mcp') return this.fail(res, 404, 'Not found.');
    if (![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(req.headers.host)) return this.fail(res, 403, 'Forbidden host.');
    if (req.headers.origin) return this.fail(res, 403, 'Browser requests are not accepted.');
    const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')), expected = Buffer.from(this.token);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return this.fail(res, 401, 'Refused token.');
    const id = req.headers['mcp-session-id'];
    if (id) {
      const session = this.sessions.get(id);
      if (!session) return this.fail(res, 404, 'Session not found.');
      return session.transport.handleRequest(req, res);
    }
    if (req.method !== 'POST') return this.fail(res, 400, 'Start a session with an initialize request.');
    const body = await readJson(req);
    if (!isInitializeRequest(body)) return this.fail(res, 400, 'Start a session with an initialize request.');
    const session = await this.openSession();
    return session.transport.handleRequest(req, res, body);
  }
  async openSession() {
    const session = { id: null, calls: new Set() };
    const server = new Server({ name: 'clipcraft', title: 'ClipCraft', version: this.version }, { capabilities: { tools: {} }, instructions: this.instructions });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.tools }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const controller = new AbortController(), abort = () => controller.abort();
      extra.signal?.addEventListener('abort', abort, { once: true }); session.calls.add(controller);
      try {
        const result = await this.onCall({ name: String(request.params.name || ''), args: request.params.arguments || {}, callId: crypto.randomUUID(), signal: controller.signal });
        return result && typeof result === 'object' ? result : errorResult('The tool returned no result.');
      } catch (error) { return errorResult(error.message || 'The call failed.'); }
      finally { extra.signal?.removeEventListener('abort', abort); session.calls.delete(controller); }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => { session.id = id; this.sessions.set(id, session); },
      onsessionclosed: (id) => this.closeSession(id),
    });
    transport.onclose = () => { if (session.id) this.closeSession(session.id); };
    Object.assign(session, { server, transport });
    await server.connect(transport);
    return session;
  }
  async closeSession(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    for (const controller of session.calls) controller.abort();
    await session.transport.close().catch(() => {});
  }
  async close() {
    const server = this.server; this.server = null;
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    if (server) await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  }
}
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size <= 4 * 1024 * 1024) chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(undefined); } });
    req.on('error', () => resolve(undefined));
  });
}

// One OpenCode session: server + MCP endpoint + session + event stream. run() is one turn.
// opts: { sdk, executablePath, cwd, env, cfg, system, tools, webResearch, spawnImpl, Endpoint }
class OpenCodeSession {
  constructor({ sdk, executablePath, cwd, env, cfg = {}, system = '', tools = [], webResearch = false, spawnImpl = spawn, Endpoint = NativeMcpEndpoint }) {
    // OpenCode keys locations by real path (macOS temp dirs live behind the /var symlink).
    Object.assign(this, { sdk, executablePath, cwd: realPath(cwd), env, cfg, system, tools, webResearch, spawnImpl, Endpoint });
    this.active = null; this.closed = false; this.gone = null; this.tokenUsage = null; this.started = null; this.endpoint = null; this.server = null; this.client = null; this.sessionID = null;
    this.events = new AbortController();
  }
  // Lazily: the endpoint, the project config, the server, the client, the session, then the event stream.
  ready() {
    return this.started ||= (async () => {
      if (this.tools.length) {
        this.endpoint = await new this.Endpoint({ tools: this.tools, onCall: (call) => this.callTool(call) }).start();
      }
      fs.writeFileSync(path.join(this.cwd, 'opencode.json'), `${JSON.stringify(projectConfig({ system: this.system, webResearch: this.webResearch }), null, 2)}\n`);
      this.server = await startServer({ executablePath: this.executablePath, cwd: this.cwd, env: this.env, spawnImpl: this.spawnImpl });
      if (this.closed) { this.server.close(); throw new Error('OpenCode session closed.'); }
      // Nothing else would notice the server dying: the event stream reconnects and the turn waits.
      const proc = this.server.process;
      proc?.on?.('exit', (code, signal) => this.serverGone(`OpenCode exited during the request (${signal || `code ${code}`}). Completed edits were kept; send the request again to restart it.`));
      if (proc && (proc.exitCode != null || proc.signalCode != null)) this.serverGone(`OpenCode exited during the request (${proc.signalCode || `code ${proc.exitCode}`}). Completed edits were kept; send the request again to restart it.`);
      this.client = this.sdk.OpenCode.make({ baseUrl: this.server.url, headers: authHeaders(this.server.password) });
      if (this.endpoint) await this.attachEndpoint();
      const ref = modelRef(this.cfg);
      const session = await this.client.session.create({ title: 'ClipCraft', agent: AGENT, location: { directory: this.cwd },
        ...(ref ? { model: ref } : {}), permissions: permissionRules(this.webResearch) });
      this.sessionID = session?.id || session?.data?.id;
      if (!this.sessionID) throw new Error('OpenCode did not create a session.');
      if (this.gone) throw this.gone;
      this.listen();
    })();
  }
  // The server process exited (or stopped answering): the session cannot continue. The active turn
  // fails with the reason; the session manager then drops this session and a new request starts afresh.
  serverGone(message) {
    if (this.closed || this.gone) return;
    this.gone = new Error(message);
    this.events.abort();
    this.active?.reject(this.gone);
  }
  // Register the editor endpoint with this server (in memory only) and wait until OpenCode has connected
  // and read the tool list; a session that cannot reach its tools is refused rather than run blind.
  async attachEndpoint(timeoutMs = 25000) {
    const location = { directory: this.cwd };
    await this.client.experimental.mcp.add({ server: MCP_SERVER, location, config: mcpConfig(this.endpoint) });
    await this.client.experimental.mcp.connect({ server: MCP_SERVER, location }).catch(() => {});
    const until = Date.now() + timeoutMs;
    for (;;) {
      const list = await this.client.mcp.list({ location });
      const entry = (list?.data || []).find((s) => s.name === MCP_SERVER);
      const status = entry?.status?.status;
      if (status === 'connected') return;
      if (status === 'failed' || status === 'disabled') throw new Error(`OpenCode could not connect to the ClipCraft tools (${entry.status.error || status}).`);
      if (Date.now() > until) throw new Error('OpenCode did not connect to the ClipCraft tools in time.');
      await sleep(250);
    }
  }
  callTool({ name, args, callId }) {
    const active = this.active;
    if (!active) return errorResult('No active editor request.');
    return Promise.resolve().then(() => active.onTool(name, args, { nativeCallId: callId, turnId: active.turnId }));
  }
  // The server's event stream, reconnected until the session closes.
  listen() {
    (async () => {
      let refusals = 0;
      while (!this.closed && !this.gone) {
        try {
          for await (const event of this.client.event.subscribe({ types: EVENT_TYPES, signal: this.events.signal })) { refusals = 0; this.receive(event); }
        } catch (error) {
          // stream ended; a server that keeps refusing the connection is gone even if no exit was seen
          if (refused(error) && ++refusals >= REFUSED_LIMIT) this.serverGone('OpenCode stopped answering during the request. Completed edits were kept; send the request again to restart it.');
        }
        if (!this.closed && !this.gone) await sleep(250);
      }
    })();
  }
  receive(event) {
    const data = event?.data || {};
    if (data.sessionID !== this.sessionID) return;
    const active = this.active;
    if (event.type === 'permission.asked') {
      // Our tools are allowed by rule; anything else that still asks is refused.
      const ok = typeof data.action === 'string' && data.action.startsWith(`${MCP_SERVER}_`);
      this.client.permission.reply({ sessionID: this.sessionID, requestID: data.id, decision: ok ? 'once' : 'reject', ...(ok ? {} : { message: 'Only ClipCraft editor tools are available.' }) }).catch(() => {});
      return;
    }
    if (event.type === 'session.usage.updated') { this.tokenUsage = data.tokens; return; }
    if (!active) return;
    if (event.type === 'session.execution.started') active.started = true;
    else if (event.type === 'session.text.ended') { active.texts.set(`${data.assistantMessageID}|${data.ordinal}`, data.text); active.lastMessage = data.assistantMessageID; }
    else if (event.type === 'session.tool.input.started') { if (WEB_TOOLS.includes(data.name)) { active.searches.set(data.id, { id: data.id, name: data.name, query: '' }); active.onSearch?.({ id: data.id, query: '', status: 'running' }); } }
    else if (event.type === 'session.tool.called') { const s = active.searches.get(data.id); if (s) { s.query = String(data.input?.query || data.input?.url || '').slice(0, 1000); active.onSearch?.({ id: s.id, query: s.query, status: 'running' }); } }
    else if (event.type === 'session.tool.success' || event.type === 'session.tool.failed') { const s = active.searches.get(data.id); if (s) { active.searches.delete(data.id); active.onSearch?.({ id: s.id, query: s.query, status: event.type.endsWith('success') ? 'done' : 'error' }); } }
    else if (event.type === 'session.step.failed') active.stepError = data.error?.message;
    else if (event.type === 'session.execution.failed') active.reject(new Error(data.error?.message || 'OpenCode failed to run the turn.'));
    else if (event.type === 'session.execution.interrupted') active.reject(active.aborted ? abortError() : new Error(`OpenCode interrupted the turn (${data.reason || 'unknown'}).`));
    else if (event.type === 'session.execution.succeeded' || (event.type === 'session.idle' && active.started)) active.resolve();
  }
  // Fallback when an event was missed: the session's own idle/busy clock.
  async settled(since) {
    try {
      const info = await this.client.session.get({ sessionID: this.sessionID });
      const time = info?.time || info?.data?.time || {};
      return !!time.idle && time.idle >= since && (!time.busy || time.busy <= time.idle);
    } catch { return false; }
  }
  async finalText(active) {
    if (active.texts.size) {
      const texts = [...active.texts.entries()].filter(([key]) => key.startsWith(`${active.lastMessage}|`)).sort(([a], [b]) => Number(a.split('|')[1]) - Number(b.split('|')[1]));
      return texts.map(([, text]) => text).join('');
    }
    const page = await this.client.message.list({ sessionID: this.sessionID, order: 'desc', limit: 20 });
    const messages = page?.data || page || [];
    const idle = messages.find((m) => m.type === 'idle');
    if (idle?.outcome === 'failed') throw new Error(idle.error?.message || 'OpenCode failed to run the turn.');
    const assistant = messages.find((m) => m.type === 'assistant');
    if (assistant?.error?.message) throw new Error(assistant.error.message);
    return (assistant?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  // One turn: { prompt, images, signal, onTool, onSearch, turnId } -> { text }
  async run({ prompt, images = [], signal, onTool, onSearch, turnId }) {
    checkAbort(signal); await abortable(this.ready(), signal); checkAbort(signal);
    if (this.gone) throw this.gone;
    if (this.active) throw new Error('This OpenCode conversation is already running.');
    const { readImages } = require('./agentImages.cjs');
    const files = readImages(images).map((image) => ({ uri: `data:image/jpeg;base64,${image.data}`, name: String(image.label || 'frame.jpg').slice(0, 200) }));
    let abort;
    try {
      const text = await new Promise((resolve, reject) => {
        const active = this.active = { onTool, onSearch, turnId, texts: new Map(), searches: new Map(), started: false, aborted: false, resolve, reject };
        abort = () => { active.aborted = true; this.client?.session.interrupt({ sessionID: this.sessionID }).catch(() => {}); reject(abortError()); };
        signal?.addEventListener('abort', abort, { once: true });
        const since = Date.now();
        this.client.session.prompt({ sessionID: this.sessionID, text: prompt, ...(files.length ? { files } : {}) }).then(() => {
          // Poll as a safety net; events are the normal path.
          const poll = async () => { while (this.active === active) { await sleep(3000); if (this.active !== active) return; if (active.started && await this.settled(since)) { await sleep(500); if (this.active === active) resolve(); return; } } };
          poll().catch(() => {});
        }, reject);
        if (signal?.aborted) abort();
      }).then(() => this.finalText(this.active));
      return { text: text || '', ...(this.tokenUsage ? { tokenUsage: usageOf(this.tokenUsage) } : {}) };
    } finally { signal?.removeEventListener('abort', abort); this.active = null; }
  }
  close() {
    this.closed = true; this.events.abort();
    const active = this.active; this.active = null; active?.reject(new Error('OpenCode session closed.'));
    this.server?.close(); this.endpoint?.close().catch(() => {});
    this.started?.catch(() => {});
  }
}

// Models the installed OpenCode can use (its connected providers): "provider/model" ids, their names, and the
// variants a model offers as reasoning efforts. A short-lived server with the isolated config.
async function listModels({ sdk, executablePath, cwd, env, spawnImpl = spawn, signal }) {
  fs.writeFileSync(path.join(cwd, 'opencode.json'), `${JSON.stringify(projectConfig({ system: 'Model catalog.' }))}\n`);
  const server = await abortable(startServer({ executablePath, cwd, env, spawnImpl, timeoutMs: 20000 }), signal);
  try {
    const client = sdk.OpenCode.make({ baseUrl: server.url, headers: authHeaders(server.password) });
    const [list, fallback] = await abortable(Promise.all([client.model.list({ types: ['chat'] }), client.model.default().catch(() => null)]), signal);
    const entries = (list?.data || []).filter((m) => m.enabled !== false && m.status !== 'deprecated' && typeof m.providerID === 'string' && typeof m.modelID === 'string');
    const id = (m) => `${m.providerID}/${m.modelID}`;
    const models = [...new Set(entries.map(id))].sort();
    const modelLabels = Object.fromEntries(entries.map((m) => [id(m), m.name ? `${m.name} (${m.providerID})` : id(m)]));
    const modelCapabilities = Object.fromEntries(entries.map((m) => [id(m), { reasoningEfforts: (m.variants || []).map((v) => v.id).filter((v) => typeof v === 'string') }]));
    const defaultModel = fallback?.data ? id(fallback.data) : (fallback?.providerID ? id(fallback) : undefined);
    return { ok: true, models, modelLabels, modelCapabilities, ...(defaultModel ? { defaultModel } : {}), ...(models.length ? {} : { useCliDefault: true, notice: 'OpenCode reports no models. Connect a provider with `opencode auth login`.' }) };
  } finally { server.close(); }
}

// One request without a retained session (chat / structured steps / connection test): a session with no
// editor tools, the instructions as the agent's system prompt; with a schema the answer is parsed as JSON.
async function runOnce({ sdk, executablePath, cwd, env, cfg, system = '', prompt, schema = null, images = [], signal, webResearch = false, onSearch, spawnImpl = spawn }) {
  const instructions = schema ? `${system}\n\nRespond with a single JSON object only — no prose, no code fences — matching this JSON Schema:\n${JSON.stringify(schema)}` : system;
  const session = new OpenCodeSession({ sdk, executablePath, cwd, env, cfg, system: instructions, tools: [], webResearch, spawnImpl });
  try {
    const { text } = await session.run({ prompt, images, signal, onSearch, onTool: () => errorResult('No editor tools in this request.'), turnId: 0 });
    if (!schema) return text;
    const raw = String(text || '').trim();
    const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(body); } catch { const i = body.indexOf('{'), j = body.lastIndexOf('}'); if (i >= 0 && j > i) return JSON.parse(body.slice(i, j + 1)); throw new Error('OpenCode returned no JSON object.'); }
  } finally { session.close(); }
}

module.exports = { OpenCodeSession, NativeMcpEndpoint, startServer, listModels, runOnce, projectConfig, mcpConfig, permissionRules, modelRef, authHeaders, usageOf, AGENT, MCP_SERVER, WEB_TOOLS, EVENT_TYPES };
