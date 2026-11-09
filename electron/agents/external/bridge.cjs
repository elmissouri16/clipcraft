#!/usr/bin/env node
// clipcraft-mcp (docs/design/external-agent-mcp.md): the stdio MCP server an outside agent starts.
// It owns the MCP session and forwards tool calls to the open ClipCraft app over its local socket,
// so it starts and lists tools while the app is closed and reconnects after an app restart.
//
// Run: node bridge.cjs, or the ClipCraft binary with ELECTRON_RUN_AS_NODE=1.
// The endpoint folder is <userData>/mcp, or --dir <folder> / CLIPCRAFT_MCP_DIR.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { PROTOCOL_VERSIONS, ENDPOINT_FILE, MANIFEST_FILE, defaultUserData, endpointDir, lineReader, frame, textResult } = require('./protocol.cjs');

const NOT_OPEN = 'ClipCraft is not open. Open the ClipCraft desktop app (and turn on Settings > External agents), then retry.';
const FALLBACK_INSTRUCTIONS = 'ClipCraft video editor tools. The ClipCraft desktop app must be open with External agents turned on in Settings. Call get_status first.';
const STATUS_TOOL = { name: 'get_status', description: 'ClipCraft status: whether the app is open, the open project and its revision.', inputSchema: { type: 'object', properties: {} } };

function createBridge({ dir, input = process.stdin, output = process.stdout, connectTimeoutMs = 1500 } = {}) {
  let socket = null, connecting = null, appInfo = null, client = { name: 'MCP client', version: '' };
  let nextId = 1, closed = false;
  const pending = new Map(); // app call id -> { resolve, rpcId, progressToken }
  const byRpc = new Map(); // MCP request id -> app call id
  let listed = null; // the tool list last given to the agent (JSON), to send list_changed

  const write = (message) => { if (!closed) output.write(frame(message)); };
  const readJson = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; } };
  const manifest = () => appInfo || readJson(MANIFEST_FILE);
  const tools = () => {
    const list = manifest()?.tools;
    return Array.isArray(list) && list.length ? list : [STATUS_TOOL];
  };

  const disconnect = (reason) => {
    socket?.destroy(); socket = null; appInfo = null; connecting = null;
    for (const [id, call] of pending) { pending.delete(id); call.resolve(textResult(JSON.stringify({ error: reason }), true)); }
  };

  // Connects with the endpoint the running app wrote; resolves null when the app is not reachable.
  function connect() {
    if (socket && appInfo) return Promise.resolve(appInfo);
    if (connecting) return connecting;
    const attempt = new Promise((resolve) => {
      const endpoint = readJson(ENDPOINT_FILE);
      if (!endpoint?.socket || !endpoint.token) return resolve(null);
      const s = net.connect(endpoint.socket);
      s.setEncoding('utf8');
      let settled = false;
      const done = (value) => { if (settled) return; settled = true; clearTimeout(timer); if (!value) { s.destroy(); if (socket === s) socket = null; } resolve(value); };
      const timer = setTimeout(() => done(null), connectTimeoutMs);
      s.on('connect', () => s.write(frame({ type: 'hello', token: endpoint.token, client })));
      s.on('data', lineReader((message) => {
        if (message.type === 'welcome') { socket = s; appInfo = { tools: message.tools || [], instructions: message.instructions || '', version: message.version }; done(appInfo); announceTools(); }
        else if (message.type === 'refused') { done(null); }
        else if (message.type === 'tools') { appInfo = { ...appInfo, tools: message.tools || [], instructions: message.instructions || '' }; announceTools(); }
        else if (message.type === 'result') { const call = pending.get(message.id); if (call) { pending.delete(message.id); byRpc.delete(call.rpcId); call.resolve(message.result); } }
        else if (message.type === 'progress') {
          const call = pending.get(message.id);
          if (call?.progressToken !== undefined) write({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: call.progressToken, progress: message.progress, ...(message.message ? { message: message.message } : {}) } });
        }
      }));
      s.on('error', () => done(null));
      s.on('close', () => { done(null); if (socket === s) disconnect('ClipCraft closed during the call. Open it again, check the project with get_status, then retry.'); });
    });
    connecting = attempt;
    attempt.finally(() => { if (connecting === attempt) connecting = null; });
    return attempt;
  }

  function announceTools() {
    if (listed === null) return; // the agent has not listed tools yet
    const now = JSON.stringify(tools());
    if (now !== listed) { listed = now; write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); }
  }

  async function callTool(rpcId, params) {
    const app = await connect();
    if (!app) return textResult(JSON.stringify({ error: NOT_OPEN }), true);
    const id = nextId++;
    const progressToken = params?._meta?.progressToken;
    return new Promise((resolve) => {
      pending.set(id, { resolve, rpcId, progressToken });
      byRpc.set(rpcId, id);
      socket.write(frame({ type: 'call', id, name: String(params?.name || ''), args: params?.arguments || {}, progress: progressToken !== undefined }));
    });
  }

  async function handle(message) {
    const { id, method, params } = message;
    const reply = (result) => write({ jsonrpc: '2.0', id, result });
    const fail = (code, text) => write({ jsonrpc: '2.0', id, error: { code, message: text } });
    if (method === 'initialize') {
      client = { name: String(params?.clientInfo?.name || 'MCP client').slice(0, 60), version: String(params?.clientInfo?.version || '').slice(0, 30) };
      const app = await connect();
      const requested = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'clipcraft', title: 'ClipCraft', version: app?.version || readJson(ENDPOINT_FILE)?.version || '0' },
        instructions: manifest()?.instructions || FALLBACK_INSTRUCTIONS,
      });
    }
    if (method === 'notifications/initialized') return;
    if (method === 'notifications/cancelled') {
      const callId = byRpc.get(params?.requestId);
      if (callId !== undefined) {
        const call = pending.get(callId);
        pending.delete(callId); byRpc.delete(params.requestId);
        socket?.write(frame({ type: 'cancel', id: callId }));
        call?.resolve(null); // canceled requests get no response
      }
      return;
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') { await connect(); const list = tools(); listed = JSON.stringify(list); return reply({ tools: list }); }
    if (method === 'tools/call') {
      const result = await callTool(id, params);
      if (result) reply(result);
      return;
    }
    if (id !== undefined) fail(-32601, `Method not found: ${method}`);
  }

  input.setEncoding?.('utf8');
  input.on('data', lineReader((message) => {
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
    handle(message).catch((error) => { if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }); });
  }));
  input.on('end', () => close());
  function close() { closed = true; disconnect('The MCP client closed.'); }
  return { close, connect };
}

if (require.main === module) {
  const at = process.argv.indexOf('--dir');
  const dir = at > 0 ? process.argv[at + 1] : process.env.CLIPCRAFT_MCP_DIR || endpointDir(defaultUserData());
  createBridge({ dir });
}

module.exports = { createBridge, NOT_OPEN };
