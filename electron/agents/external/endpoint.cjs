// The app side of external agents (docs/design/external-agent-mcp.md): a user-only local socket the
// stdio bridge connects to, one token per app run, and the one-agent lock. No Electron imports, so
// tests drive it in plain Node (tests/unit/agents/test-external-bridge.mjs).
//
// Bridge -> app: hello { token, client: { name, version } }, call { id, name, args, progress },
// cancel { id }. App -> bridge: welcome { tools, instructions, version } | refused { error },
// tools { tools, instructions }, result { id, result }, progress { id, progress, message }.
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ENDPOINT_FILE, MANIFEST_FILE, socketPath, lineReader, frame, textResult } = require('./protocol.cjs');

const HELLO_MS = 5000;

// onCall(call, owner) -> MCP result, call: { id, name, args, signal, progress(value, message) }.
// approve(client) -> true | false: may ask the user. limits: { toolCallTimeoutMs, idleMs }.
class ExternalEndpoint extends EventEmitter {
  constructor({ dir, version, onCall, approve = async () => true, limits }) {
    super();
    Object.assign(this, { dir, version, onCall, approve, limits });
    this.server = null; this.token = null; this.socket = null;
    this.connections = new Set();
    this.owner = null; // { connection, client, since }
    this.manifest = { tools: [], instructions: '' };
    this.idleTimer = null;
  }

  get running() { return !!this.server; }

  async start() {
    if (this.server) return;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.dir, 0o700); } catch { /* Windows */ }
    this.token = crypto.randomBytes(32).toString('hex');
    this.socket = socketPath(this.dir);
    if (process.platform !== 'win32') {
      // A socket left by a crashed run: in use means another ClipCraft is serving it.
      if (fs.existsSync(this.socket)) {
        const alive = await new Promise((resolve) => { const c = net.connect(this.socket); c.once('connect', () => { c.destroy(); resolve(true); }); c.once('error', () => resolve(false)); });
        if (alive) throw new Error('Another ClipCraft window already serves external agents.');
        fs.rmSync(this.socket, { force: true });
      }
    }
    const server = net.createServer((socket) => this.accept(socket));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.socket, () => { server.off('error', reject); resolve(); }); });
    if (process.platform !== 'win32') { try { fs.chmodSync(this.socket, 0o600); } catch { /* best effort: the folder is 0700 */ } }
    this.server = server;
    this.writeFile(ENDPOINT_FILE, { socket: this.socket, token: this.token, version: this.version, pid: process.pid });
    this.writeFile(MANIFEST_FILE, this.manifest);
    this.emit('status');
  }

  async stop() {
    const server = this.server;
    this.server = null;
    for (const connection of this.connections) connection.socket.destroy();
    this.connections.clear();
    this.release();
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    fs.rmSync(path.join(this.dir, ENDPOINT_FILE), { force: true });
    if (this.socket && process.platform !== 'win32') fs.rmSync(this.socket, { force: true });
    this.emit('status');
  }

  writeFile(name, value) {
    const file = path.join(this.dir, name), tmp = `${file}.${process.pid}.part`;
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // The tool list and instructions the renderer offers; bridges hear about changes.
  setManifest({ tools, instructions }) {
    const next = { tools: Array.isArray(tools) ? tools : [], instructions: String(instructions || '') };
    if (JSON.stringify(next) === JSON.stringify(this.manifest)) return;
    this.manifest = next;
    if (this.server) this.writeFile(MANIFEST_FILE, next);
    for (const connection of this.connections) if (connection.ready) this.send(connection, { type: 'tools', ...next });
  }

  status() {
    return { running: this.running, connections: [...this.connections].filter((c) => c.ready).length,
      owner: this.owner ? { client: this.owner.client, since: this.owner.since } : null };
  }

  send(connection, message) { if (!connection.socket.destroyed) connection.socket.write(frame(message)); }

  accept(socket) {
    socket.setEncoding('utf8');
    const connection = { id: crypto.randomUUID(), socket, ready: false, client: null, calls: new Map() };
    this.connections.add(connection);
    const hello = setTimeout(() => socket.destroy(), HELLO_MS);
    socket.on('data', lineReader((message) => this.receive(connection, message, hello)));
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(hello);
      this.connections.delete(connection);
      for (const call of connection.calls.values()) call.controller.abort();
      if (this.owner?.connection === connection) this.release();
      this.emit('status');
    });
  }

  receive(connection, message, hello) {
    if (!connection.ready) {
      const token = Buffer.from(String(message.token || '')), expected = Buffer.from(this.token || '');
      if (message.type !== 'hello' || token.length !== expected.length || !crypto.timingSafeEqual(token, expected)) {
        this.send(connection, { type: 'refused', error: 'ClipCraft refused the connection (wrong or old token). Restart the MCP server.' });
        connection.socket.end(); return;
      }
      clearTimeout(hello);
      const name = String(message.client?.name || 'MCP client').replace(/[\u0000-\u001f]/g, '').slice(0, 60).trim() || 'MCP client';
      connection.client = { name, version: String(message.client?.version || '').slice(0, 30) };
      connection.ready = true;
      this.send(connection, { type: 'welcome', version: this.version, ...this.manifest });
      this.emit('status');
      return;
    }
    if (message.type === 'call' && message.id !== undefined) this.call(connection, message);
    else if (message.type === 'cancel') connection.calls.get(message.id)?.controller.abort();
  }

  async call(connection, message) {
    const { id } = message;
    const reply = (result) => { connection.calls.delete(id); this.send(connection, { type: 'result', id, result }); };
    if (connection.calls.has(id)) return;
    const controller = new AbortController();
    connection.calls.set(id, { controller });
    try {
      const refusal = await this.claim(connection);
      if (refusal) return reply(textResult(refusal, true));
      this.touch();
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(textResult(JSON.stringify({ error: `${message.name} did not finish within ${this.limits.toolCallTimeoutMs / 60000} minutes.` }), true)); }, this.limits.toolCallTimeoutMs); });
      const progress = message.progress ? (value, text) => this.send(connection, { type: 'progress', id, progress: value, ...(text ? { message: String(text).slice(0, 300) } : {}) }) : () => {};
      const run = Promise.resolve().then(() => this.onCall({ id: `${connection.id}:${id}`, name: String(message.name || ''), args: message.args && typeof message.args === 'object' ? message.args : {}, signal: controller.signal, progress }, this.owner));
      const result = await Promise.race([run, timeout]).finally(() => clearTimeout(timer));
      reply(result || textResult(JSON.stringify({ error: 'The tool returned no result.' }), true));
    } catch (error) {
      reply(textResult(JSON.stringify({ error: error.message || 'The call failed.' }), true));
    } finally { this.touch(); }
  }

  // One agent at a time: the first connection that makes a call (and is approved) holds the editor
  // until it disconnects, the user disconnects it, or it is idle for limits.idleMs.
  async claim(connection) {
    if (this.owner?.connection === connection) return null;
    if (this.owner) return `ClipCraft is connected to ${this.owner.client.name}. Disconnect it in ClipCraft first, then retry.`;
    if (connection.approving) return 'Waiting for the user to allow this agent in ClipCraft. Retry in a moment.';
    connection.approving = true;
    let allowed;
    try { allowed = await this.approve(connection.client); } finally { connection.approving = false; }
    if (!allowed) return `The user did not allow ${connection.client.name} to edit in ClipCraft.`;
    if (connection.socket.destroyed) return 'The connection closed.';
    if (this.owner && this.owner.connection !== connection) return `ClipCraft is connected to ${this.owner.client.name}. Disconnect it in ClipCraft first, then retry.`;
    this.owner = { connection, client: connection.client, since: Date.now() };
    this.emit('claimed', this.owner);
    this.emit('status');
    return null;
  }

  touch() {
    clearTimeout(this.idleTimer);
    if (!this.owner) return;
    this.idleTimer = setTimeout(() => {
      if (this.owner && !this.owner.connection.calls.size) this.release('idle'); else this.touch();
    }, this.limits.idleMs);
  }

  // Frees the editor. The connection stays open; its next call claims again.
  release(reason = 'released') {
    clearTimeout(this.idleTimer);
    if (!this.owner) return;
    const owner = this.owner;
    this.owner = null;
    for (const call of owner.connection.calls.values()) call.controller.abort();
    this.emit('released', { client: owner.client, reason });
    this.emit('status');
  }

  // The user pressed Disconnect: free the editor and close that agent's connection.
  disconnect() {
    const owner = this.owner;
    this.release('disconnected');
    owner?.connection.socket.end();
  }
}

module.exports = { ExternalEndpoint };
