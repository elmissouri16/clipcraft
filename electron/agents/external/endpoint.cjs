// The MCP server outside agents connect to (docs/design/external-agent-mcp.md): Streamable HTTP on
// 127.0.0.1 inside the app, so an agent is configured with a URL and a token and nothing else.
// No Electron imports: tests drive it in plain Node (tests/unit/agents/test-external-endpoint.mjs).
//
// One agent holds the editor at a time. HTTP sessions have no connection that ends when an agent
// quits, so the holder keeps the editor while it works and can be replaced (by another agent or by
// CraftAI) once it has been idle for limits.takeoverMs with no call running.
const crypto = require('node:crypto');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');

const PATH = '/mcp';
const MAX_BODY = 4 * 1024 * 1024;
const textResult = (text, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] });
const errorResult = (error) => textResult(JSON.stringify({ error }), true);

// onCall(call, owner) -> MCP result, call: { id, name, args, signal, progress(value, message) }.
// approve(client) -> boolean (may ask the user). isCraftBusy() -> boolean.
// limits: { toolCallTimeoutMs, takeoverMs, sessionIdleMs }.
class ExternalEndpoint extends EventEmitter {
  constructor({ port, token, version, onCall, approve = async () => true, isCraftBusy = () => false, limits }) {
    super();
    Object.assign(this, { port, token, version, onCall, approve, isCraftBusy, limits });
    this.server = null;
    this.sessions = new Map(); // session id -> session
    this.owner = null; // a session
    this.manifest = { tools: [], instructions: '' };
    this.idleTimer = null; this.pruneTimer = null;
    this.error = null;
  }

  get running() { return !!this.server; }
  get url() { return `http://127.0.0.1:${this.port}${PATH}`; }

  async start() {
    if (this.server) return;
    const server = http.createServer((req, res) => { this.handle(req, res).catch((error) => this.fail(res, 500, error.message)); });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    } catch (error) {
      this.error = error.code === 'EADDRINUSE' ? `Port ${this.port} is already in use (another ClipCraft, or another program).` : error.message;
      this.emit('status');
      throw new Error(this.error);
    }
    this.error = null;
    this.server = server;
    this.pruneTimer = setInterval(() => this.prune(), 5 * 60 * 1000); this.pruneTimer.unref?.();
    this.emit('status');
  }

  async stop() {
    const server = this.server;
    this.server = null;
    clearInterval(this.pruneTimer);
    this.release('stopped');
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    if (server) await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
    this.emit('status');
  }

  // The tool list and instructions the renderer offers; open sessions hear about list changes.
  setManifest({ tools, instructions }) {
    const next = { tools: Array.isArray(tools) ? tools : [], instructions: String(instructions || '') };
    if (JSON.stringify(next) === JSON.stringify(this.manifest)) return;
    const toolsChanged = JSON.stringify(next.tools) !== JSON.stringify(this.manifest.tools);
    this.manifest = next;
    if (toolsChanged) for (const session of this.sessions.values()) session.server.sendToolListChanged().catch(() => {});
  }

  active(session) { return !!session && (session.calls.size > 0 || Date.now() - session.lastCall < this.limits.takeoverMs); }

  status() {
    const owner = this.owner;
    return { running: this.running, url: this.url, error: this.error, sessions: [...this.sessions.values()].filter((s) => s.client).length,
      owner: owner ? { client: owner.client, since: owner.since, active: this.active(owner) } : null };
  }

  fail(res, code, message) {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== PATH) return this.fail(res, 404, 'Not found. ClipCraft serves MCP at /mcp.');
    // Only local MCP clients: the Host must be this server (no DNS rebinding) and browsers, which
    // always send Origin on these requests, are refused. Then the token.
    if (![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(req.headers.host)) return this.fail(res, 403, 'Forbidden host.');
    if (req.headers.origin) return this.fail(res, 403, 'Browser requests are not accepted.');
    const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')), expected = Buffer.from(this.token);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return this.fail(res, 401, 'ClipCraft refused the token. Reinstall ClipCraft for this agent in ClipCraft Settings > External agents.');
    const id = req.headers['mcp-session-id'];
    if (id) {
      const session = this.sessions.get(id);
      if (!session) return this.fail(res, 404, 'Session not found (ClipCraft restarted). Start a new session.');
      session.lastSeen = Date.now();
      return session.transport.handleRequest(req, res);
    }
    if (req.method !== 'POST') return this.fail(res, 400, 'Start a session with an initialize request.');
    const body = await readJson(req);
    if (body === undefined) return this.fail(res, 400, 'The request body is not JSON.');
    if (!isInitializeRequest(body)) return this.fail(res, 400, 'Start a session with an initialize request.');
    const session = await this.openSession();
    return session.transport.handleRequest(req, res, body);
  }

  async openSession() {
    const session = { id: null, client: null, calls: new Map(), lastCall: 0, lastSeen: Date.now(), since: 0 };
    const server = new Server({ name: 'clipcraft', title: 'ClipCraft', version: this.version },
      { capabilities: { tools: { listChanged: true } }, instructions: this.manifest.instructions });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.manifest.tools }));
    server.setRequestHandler(CallToolRequestSchema, (request, extra) => this.call(session, request, extra));
    server.oninitialized = () => {
      const info = server.getClientVersion() || {};
      const name = String(info.title || info.name || 'MCP client').replace(/[\u0000-\u001f]/g, '').slice(0, 60).trim() || 'MCP client';
      session.client = { name, version: String(info.version || '').slice(0, 30) };
      this.emit('status');
    };
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
    for (const controller of session.calls.values()) controller.abort();
    if (this.owner === session) this.release('disconnected');
    await session.transport.close().catch(() => {});
    this.emit('status');
  }

  // Sessions an agent left without closing (it quit): dropped after limits.sessionIdleMs.
  prune() {
    for (const [id, session] of this.sessions) if (!session.calls.size && Date.now() - session.lastSeen > this.limits.sessionIdleMs) this.closeSession(id);
  }

  async call(session, request, extra) {
    session.lastSeen = Date.now();
    const refusal = await this.claim(session);
    if (refusal) return textResult(refusal, true);
    const id = crypto.randomUUID(), controller = new AbortController();
    const abort = () => controller.abort();
    extra.signal?.addEventListener('abort', abort, { once: true });
    session.calls.set(id, controller);
    this.emit('status');
    const token = request.params?._meta?.progressToken;
    const progress = token === undefined ? () => {} : (value, message) => extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: value, ...(message ? { message: String(message).slice(0, 300) } : {}) } }).catch(() => {});
    let timer;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(errorResult(`${request.params.name} did not finish within ${this.limits.toolCallTimeoutMs / 60000} minutes.`)); }, this.limits.toolCallTimeoutMs); });
      const run = Promise.resolve().then(() => this.onCall({ id, name: String(request.params.name || ''), args: request.params.arguments || {}, signal: controller.signal, progress }, session));
      return (await Promise.race([run, timeout])) || errorResult('The tool returned no result.');
    } catch (error) {
      return errorResult(error.message || 'The call failed.');
    } finally {
      clearTimeout(timer);
      extra.signal?.removeEventListener('abort', abort);
      session.calls.delete(id);
      session.lastCall = Date.now();
      this.scheduleIdle();
      this.emit('status');
    }
  }

  async claim(session) {
    if (this.owner === session) return null;
    if (this.isCraftBusy()) return 'CraftAI is editing in ClipCraft. Retry when it finishes.';
    if (this.owner) {
      if (this.active(this.owner)) return `ClipCraft is being used by ${this.owner.client.name}. Retry when it has been idle for ${Math.round(this.limits.takeoverMs / 60000)} minutes, or ask the user to disconnect it in ClipCraft.`;
      this.release('replaced');
    }
    if (session.approving) return 'Waiting for the user to allow this agent in ClipCraft. Retry in a moment.';
    session.approving = true;
    let allowed;
    try { allowed = await this.approve(session.client || { name: 'MCP client', version: '' }); } finally { session.approving = false; }
    if (!allowed) return `The user did not allow ${session.client?.name || 'this agent'} to edit in ClipCraft.`;
    if (!this.sessions.has(session.id)) return 'The session closed.';
    if (this.owner && this.owner !== session) return this.claim(session);
    this.owner = session;
    session.since = Date.now();
    this.emit('claimed', { client: session.client });
    this.emit('status');
    return null;
  }

  // Status changes when the holder turns idle (CraftAI and other agents may then take over).
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.owner) return;
    this.idleTimer = setTimeout(() => this.emit('status'), Math.max(0, this.owner.lastCall + this.limits.takeoverMs - Date.now()) + 50);
    this.idleTimer.unref?.();
  }

  release(reason) {
    clearTimeout(this.idleTimer);
    const owner = this.owner;
    if (!owner) return;
    this.owner = null;
    for (const controller of owner.calls.values()) controller.abort();
    this.emit('released', { client: owner.client, reason });
    this.emit('status');
  }

  // CraftAI wants to start: refuses while the holder works, otherwise frees the editor.
  yieldToCraft() {
    if (this.active(this.owner)) return this.owner.client.name;
    this.release('craftai');
    return null;
  }

  // The user pressed Disconnect: the holder's session ends; its next call starts over.
  async disconnect() {
    const owner = this.owner;
    this.release('disconnected');
    if (owner?.id) await this.closeSession(owner.id);
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) { req.destroy(); resolve(undefined); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(undefined); } });
    req.on('error', () => resolve(undefined));
  });
}

module.exports = { ExternalEndpoint, textResult, errorResult };
