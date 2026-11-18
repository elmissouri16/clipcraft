// Minimal MCP (Model Context Protocol) client over stdio: spawns a server process, speaks
// newline-delimited JSON-RPC, and exposes initialize / tools/list / tools/call. Deliberately
// free of Electron imports so it can be unit-tested in plain node (tests/unit/agents/test-mcp.mjs).
const { spawn } = require('child_process');
const { abortable, checkAbort, abortError } = require("../system/cancel.cjs");
const { launchSpec, stopProcessTree } = require('../system/windowsCommands.cjs');

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'ClipCraft', version: require('../../package.json').version };

class McpError extends Error {}

class McpClient {
  // platform: for tests only (how a Windows launch is built).
  constructor(server, { timeoutMs = 20000, platform = process.platform } = {}) {
    this.server = server; // { name, command, args }
    this.timeoutMs = timeoutMs;
    this.platform = platform;
    this.proc = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject }
    this.started = null; // promise of the initialize handshake
  }

  start() {
    if (this.started) return this.started;
    this.started = (async () => {
      const { command, args = [] } = this.server;
      if (!command) throw new McpError('This MCP server has no command.');
      // On Windows npx and other .cmd launchers need cmd.exe: the line is built with every argument quoted
      // (system/windowsCommands.cjs), and no console window opens.
      const launch = launchSpec(command, args, { platform: this.platform });
      const proc = this.proc = spawn(launch.command, launch.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...launch.options });
      this.buffer = '';
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => { if (this.proc === proc) this.onData(chunk); });
      this.proc.stderr.setEncoding('utf8');
      this.proc.stderr.on('data', () => {}); // server logs: drained, not shown
      const ended = error => {
        if (this.proc !== proc) return;
        this.proc = null; this.started = null; this.buffer = '';
        this.failAll(error);
      };
      proc.stdin.on('error', error => ended(new McpError(error.message)));
      proc.on('error', error => ended(new McpError(`Could not start the MCP server "${this.server.name}": ${error.message}`)));
      proc.on('exit', code => ended(new McpError(`The MCP server "${this.server.name}" exited (code ${code}).`)));
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      this.notify('notifications/initialized', {});
      return init;
    })();
    // A failed start must not poison later retries.
    const startup = this.started;
    startup.catch(() => { if (this.started === startup) { this.stop(); } });
    return this.started;
  }

  onData(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new McpError(msg.error.message || `MCP error ${msg.error.code}`));
        else resolve(msg.result);
      }
      // Server->client requests/notifications are not answered by this minimal client.
    }
  }

  failAll(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  send(obj) {
    if (!this.proc || !this.proc.stdin.writable) throw new McpError(`The MCP server "${this.server.name}" is not running.`);
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  request(method, params, { signal } = {}) {
    checkAbort(signal);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); };
      const cancel = error => {
        // Initialization is shared by callers and cannot be canceled by MCP.
        if (method !== 'initialize') this.notify('notifications/cancelled', { requestId: id, reason: error.message });
        cleanup(); reject(error);
      };
      const abort = () => cancel(abortError());
      const timer = setTimeout(() => cancel(new McpError(`The MCP server "${this.server.name}" did not answer "${method}" in time.`)), this.timeoutMs);
      this.pending.set(id, {
        resolve: value => { cleanup(); resolve(value); },
        reject: error => { cleanup(); reject(error); },
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  notify(method, params) {
    try { this.send({ jsonrpc: '2.0', method, params }); } catch { /* a dead server surfaces on the next request */ }
  }

  async listTools({ signal } = {}) {
    checkAbort(signal); await abortable(this.start(), signal);
    const res = await this.request('tools/list', {}, { signal });
    return (res?.tools || []).map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object' } }));
  }

  async callTool(name, args, { signal } = {}) {
    checkAbort(signal); await abortable(this.start(), signal);
    const res = await this.request('tools/call', { name, arguments: args || {} }, { signal });
    if (res?.isError) {
      const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
      throw new McpError(text || `The MCP tool ${name} reported an error.`);
    }
    return res;
  }

  stop() {
    // The whole tree: on Windows the direct child is cmd.exe or an npx shim, the server runs below it.
    if (this.proc) { stopProcessTree(this.proc, { platform: this.platform }); this.proc = null; }
    this.started = null;
    this.failAll(new McpError('The MCP client was stopped.'));
  }
}

// Keeps one client per configured server (keyed by name + command + args), so agent runs
// reuse the spawned processes. getServers() returns the current settings list.
function createRegistry(getServers) {
  const clients = new Map();
  const keyOf = (s) => JSON.stringify([s.name, s.command, s.args || []]);
  // A server removed or changed in Settings stops now, not at quit: only the current list keeps a process.
  const prune = (servers = getServers()) => {
    const current = new Set(servers.map(keyOf));
    for (const [key, client] of clients) if (!current.has(key)) { client.stop(); clients.delete(key); }
    return servers;
  };
  const clientFor = (server) => {
    const key = keyOf(server);
    if (!clients.has(key)) clients.set(key, new McpClient(server));
    return clients.get(key);
  };
  const sanitize = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';

  return {
    // Gemini-format tool declarations for every configured server, named mcp_<server>_<tool>.
    async declarations({ signal } = {}) {
      const decls = [];
      const problems = [];
      for (const server of prune()) {
        try {
          checkAbort(signal);
          const tools = await clientFor(server).listTools({ signal });
          for (const tool of tools) {
            decls.push({
              name: `mcp_${sanitize(server.name)}_${tool.name}`,
              description: `[MCP: ${server.name}] ${tool.description}`.trim(),
              parameters: tool.inputSchema,
              _mcp: { server: server.name, tool: tool.name },
            });
          }
        } catch (e) {
          if (signal?.aborted) throw abortError();
          problems.push({ server: server.name, error: e.message });
        }
      }
      return { decls, problems };
    },
    // Routes an mcp_<server>_<tool> call to its server.
    async call(prefixedName, args, { signal } = {}) {
      checkAbort(signal);
      const servers = prune().slice().sort((a, b) => sanitize(b.name).length - sanitize(a.name).length);
      for (const server of servers) {
        const prefix = `mcp_${sanitize(server.name)}_`;
        if (prefixedName.startsWith(prefix)) {
          const tool = prefixedName.slice(prefix.length);
          const res = await clientFor(server).callTool(tool, args, { signal });
          const text = (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          const typed = res?.structuredContent !== undefined || (res?.content || []).some(block => block.type !== 'text');
          return { result: typed ? res : text || res || {} };
        }
      }
      throw new McpError(`No MCP server matches the tool "${prefixedName}".`);
    },
    async test(server) {
      const client = new McpClient(server, { timeoutMs: 15000 });
      try {
        const tools = await client.listTools();
        return { ok: true, tools: tools.map((t) => t.name) };
      } catch (e) {
        return { ok: false, error: e.message };
      } finally {
        client.stop();
      }
    },
    prune: () => { prune(); },
    stopAll() { for (const c of clients.values()) c.stop(); clients.clear(); },
  };
}

module.exports = { McpClient, McpError, createRegistry, PROTOCOL_VERSION };
