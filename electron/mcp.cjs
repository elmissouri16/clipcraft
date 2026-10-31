// Minimal MCP (Model Context Protocol) client over stdio: spawns a server process, speaks
// newline-delimited JSON-RPC, and exposes initialize / tools/list / tools/call. Deliberately
// free of Electron imports so it can be unit-tested in plain node (scripts/test-mcp.mjs).
const { spawn } = require('child_process');

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'ClipCraft', version: '2.0.0' };

class McpError extends Error {}

class McpClient {
  constructor(server, { timeoutMs = 20000 } = {}) {
    this.server = server; // { name, command, args }
    this.timeoutMs = timeoutMs;
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
      this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => this.onData(chunk));
      this.proc.stderr.setEncoding('utf8');
      this.proc.stderr.on('data', () => {}); // server logs: drained, not shown
      this.proc.on('error', (e) => this.failAll(new McpError(`Could not start the MCP server "${this.server.name}": ${e.message}`)));
      this.proc.on('exit', (code) => {
        if (this.pending.size) this.failAll(new McpError(`The MCP server "${this.server.name}" exited (code ${code}).`));
        this.proc = null;
      });
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      this.notify('notifications/initialized', {});
      return init;
    })();
    // A failed start must not poison later retries.
    this.started.catch(() => { this.started = null; });
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

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`The MCP server "${this.server.name}" did not answer "${method}" in time.`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  notify(method, params) {
    try { this.send({ jsonrpc: '2.0', method, params }); } catch { /* a dead server surfaces on the next request */ }
  }

  async listTools() {
    await this.start();
    const res = await this.request('tools/list', {});
    return (res?.tools || []).map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object' } }));
  }

  async callTool(name, args) {
    await this.start();
    const res = await this.request('tools/call', { name, arguments: args || {} });
    if (res?.isError) {
      const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
      throw new McpError(text || `The MCP tool ${name} reported an error.`);
    }
    return res;
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch { /* already gone */ } this.proc = null; }
    this.started = null;
    this.failAll(new McpError('The MCP client was stopped.'));
  }
}

// Keeps one client per configured server (keyed by name + command + args), so agent runs
// reuse the spawned processes. getServers() returns the current settings list.
function createRegistry(getServers) {
  const clients = new Map();
  const keyOf = (s) => `${s.name}\n${s.command}\n${(s.args || []).join(' ')}`;
  const clientFor = (server) => {
    const key = keyOf(server);
    if (!clients.has(key)) clients.set(key, new McpClient(server));
    return clients.get(key);
  };
  const sanitize = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';

  return {
    // Gemini-format tool declarations for every configured server, named mcp_<server>_<tool>.
    async declarations() {
      const decls = [];
      const problems = [];
      for (const server of getServers()) {
        try {
          const tools = await clientFor(server).listTools();
          for (const tool of tools) {
            decls.push({
              name: `mcp_${sanitize(server.name)}_${tool.name}`,
              description: `[MCP: ${server.name}] ${tool.description}`.trim(),
              parameters: tool.inputSchema,
              _mcp: { server: server.name, tool: tool.name },
            });
          }
        } catch (e) {
          problems.push({ server: server.name, error: e.message });
        }
      }
      return { decls, problems };
    },
    // Routes an mcp_<server>_<tool> call to its server.
    async call(prefixedName, args) {
      const servers = getServers().slice().sort((a, b) => sanitize(b.name).length - sanitize(a.name).length);
      for (const server of servers) {
        const prefix = `mcp_${sanitize(server.name)}_`;
        if (prefixedName.startsWith(prefix)) {
          const tool = prefixedName.slice(prefix.length);
          const res = await clientFor(server).callTool(tool, args);
          const text = (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          return { result: text || res };
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
    stopAll() { for (const c of clients.values()) c.stop(); clients.clear(); },
  };
}

module.exports = { McpClient, McpError, createRegistry, PROTOCOL_VERSION };
