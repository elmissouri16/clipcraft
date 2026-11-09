// External agents over MCP (docs/design/external-agent-mcp.md), in plain Node: the stdio bridge as an
// agent starts it, against the app-side endpoint with a stub editor. App closed, then open, then
// restarted; wrong token; one agent at a time; approval; cancel; progress; timeouts; idle release;
// protocol version negotiation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { McpClient } = require('../../../electron/agents/mcp.cjs');
const { ExternalEndpoint } = require('../../../electron/agents/external/endpoint.cjs');
const { NOT_OPEN } = require('../../../electron/agents/external/bridge.cjs');
const bridge = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../electron/agents/external/bridge.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ext-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(20); } throw new Error('Timed out'); };
const server = { name: 'clipcraft', command: process.execPath, args: [bridge, '--dir', dir] };
const text = (result) => (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// A raw JSON-RPC client, for what McpClient does not do (notifications, chosen protocol versions).
function raw() {
  const child = spawn(process.execPath, [bridge, '--dir', dir], { stdio: ['pipe', 'pipe', 'ignore'] });
  const messages = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { buffer += chunk; let at; while ((at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (line.trim()) messages.push(JSON.parse(line)); } });
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const reply = async (id) => { await until(() => messages.some((m) => m.id === id), 8000); return messages.find((m) => m.id === id); };
  return { child, messages, send, reply, stop: () => child.kill() };
}

const MANIFEST = { instructions: 'Stub ClipCraft instructions.', tools: [
  { name: 'get_status', description: 'status', inputSchema: { type: 'object', properties: {} } },
  { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'slow', description: 'waits', inputSchema: { type: 'object', properties: {} } },
] };
let approveAnswer = true, approvals = 0, lastSignal = null;
function makeEndpoint(limits = { toolCallTimeoutMs: 60000, idleMs: 60000 }) {
  const endpoint = new ExternalEndpoint({ dir, version: '9.9.9', limits,
    approve: async () => { approvals++; return approveAnswer; },
    onCall: async (call, owner) => {
      if (call.name === 'echo') return { content: [{ type: 'text', text: `echo:${call.args.text}:${owner.client.name}` }] };
      if (call.name === 'slow') {
        lastSignal = call.signal;
        call.progress(1, 'Rendering');
        await new Promise((resolve) => { call.signal.addEventListener('abort', resolve, { once: true }); setTimeout(resolve, 3000); });
        return { content: [{ type: 'text', text: call.signal.aborted ? 'stopped' : 'slow done' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ screen: 'home' }) }] };
    } });
  endpoint.setManifest(MANIFEST);
  return endpoint;
}

let endpoint;
try {
  await check('app closed: the bridge starts, lists a status tool and every call says to open ClipCraft', async () => {
    const client = new McpClient(server, { timeoutMs: 8000 });
    const init = await client.start();
    assert.equal(init.serverInfo.name, 'clipcraft');
    assert.match(init.instructions, /ClipCraft desktop app must be open/);
    assert.deepEqual((await client.listTools()).map((t) => t.name), ['get_status']);
    await assert.rejects(() => client.callTool('get_status', {}), (e) => e.message.includes(NOT_OPEN));
    // The same session works once the app opens, without restarting the agent.
    endpoint = makeEndpoint();
    await endpoint.start();
    const result = await client.callTool('echo', { text: 'hi' });
    assert.equal(text(result), 'echo:hi:ClipCraft');
    assert.deepEqual((await client.listTools()).map((t) => t.name), ['get_status', 'echo', 'slow']);
    client.stop();
    await until(() => !endpoint.owner);
  });

  await check('the endpoint folder and files are private to the user', async () => {
    if (process.platform === 'win32') return;
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(dir, 'endpoint.json')).mode & 0o777, 0o600);
    const { socket, token } = JSON.parse(fs.readFileSync(path.join(dir, 'endpoint.json'), 'utf8'));
    assert.equal(token.length, 64); assert.ok(fs.existsSync(socket));
  });

  await check('with the app closed the bridge lists the tools the app last offered', async () => {
    await endpoint.stop();
    assert.ok(!fs.existsSync(path.join(dir, 'endpoint.json')), 'stop removes the endpoint file');
    const client = new McpClient(server, { timeoutMs: 8000 });
    const init = await client.start();
    assert.equal(init.instructions, MANIFEST.instructions);
    assert.deepEqual((await client.listTools()).map((t) => t.name), ['get_status', 'echo', 'slow']);
    client.stop();
  });

  await check('a wrong token is refused', async () => {
    endpoint = makeEndpoint();
    await endpoint.start();
    const file = path.join(dir, 'endpoint.json'), good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(good), token: 'f'.repeat(64) }));
    const client = new McpClient(server, { timeoutMs: 8000 });
    await assert.rejects(() => client.callTool('echo', { text: 'x' }), (e) => e.message.includes(NOT_OPEN));
    assert.equal(endpoint.owner, null);
    fs.writeFileSync(file, good);
    assert.equal(text(await client.callTool('echo', { text: 'ok' })), 'echo:ok:ClipCraft');
    client.stop();
    await until(() => !endpoint.owner);
  });

  await check('one agent at a time: a second agent is refused until the first leaves', async () => {
    const first = new McpClient(server, { timeoutMs: 8000 }), second = new McpClient(server, { timeoutMs: 8000 });
    assert.equal(text(await first.callTool('echo', { text: 'a' })), 'echo:a:ClipCraft');
    await assert.rejects(() => second.callTool('echo', { text: 'b' }), /connected to ClipCraft\. Disconnect it in ClipCraft first/);
    first.stop();
    await until(() => !endpoint.owner);
    assert.equal(text(await second.callTool('echo', { text: 'b' })), 'echo:b:ClipCraft');
    second.stop();
    await until(() => !endpoint.owner);
  });

  await check('an app restart mid-session is picked up by the next call', async () => {
    const client = new McpClient(server, { timeoutMs: 8000 });
    assert.equal(text(await client.callTool('echo', { text: '1' })), 'echo:1:ClipCraft');
    await endpoint.stop();
    await assert.rejects(() => client.callTool('echo', { text: '2' }), (e) => e.message.includes(NOT_OPEN));
    endpoint = makeEndpoint();
    await endpoint.start(); // new socket token
    assert.equal(text(await client.callTool('echo', { text: '3' })), 'echo:3:ClipCraft');
    client.stop();
    await until(() => !endpoint.owner);
  });

  await check('an agent the user does not allow cannot edit, and is asked again next time', async () => {
    approveAnswer = false; const before = approvals;
    const client = new McpClient(server, { timeoutMs: 8000 });
    await assert.rejects(() => client.callTool('echo', { text: 'x' }), /did not allow ClipCraft/);
    assert.equal(endpoint.owner, null);
    approveAnswer = true;
    assert.equal(text(await client.callTool('echo', { text: 'y' })), 'echo:y:ClipCraft');
    assert.equal(approvals - before, 2);
    client.stop();
    await until(() => !endpoint.owner);
  });

  await check('cancel reaches the running call, and progress reaches the agent', async () => {
    const agent = raw();
    agent.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Raw agent', version: '1' } } });
    assert.equal((await agent.reply(1)).result.protocolVersion, '2025-06-18');
    agent.send({ method: 'notifications/initialized' });
    agent.send({ id: 2, method: 'tools/call', params: { name: 'slow', arguments: {}, _meta: { progressToken: 'p1' } } });
    await until(() => agent.messages.some((m) => m.method === 'notifications/progress'));
    const progress = agent.messages.find((m) => m.method === 'notifications/progress');
    assert.deepEqual(progress.params, { progressToken: 'p1', progress: 1, message: 'Rendering' });
    assert.equal(endpoint.owner.client.name, 'Raw agent', 'the agent is named by its MCP client info');
    agent.send({ method: 'notifications/cancelled', params: { requestId: 2, reason: 'user' } });
    await until(() => lastSignal?.aborted);
    await wait(150);
    assert.ok(!agent.messages.some((m) => m.id === 2), 'a canceled request gets no response');
    agent.send({ id: 3, method: 'ping' });
    assert.deepEqual((await agent.reply(3)).result, {});
    agent.send({ id: 4, method: 'resources/list' });
    assert.equal((await agent.reply(4)).error.code, -32601);
    agent.send({ id: 5, method: 'initialize', params: { protocolVersion: '1999-01-01', clientInfo: { name: 'Raw agent' } } });
    assert.equal((await agent.reply(5)).result.protocolVersion, '2025-06-18', 'an unknown version gets the newest');
    agent.stop();
    await until(() => !endpoint.owner);
  });

  await check('the tool list change is announced to a connected agent', async () => {
    const agent = raw();
    agent.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'Raw agent' } } });
    await agent.reply(1);
    agent.send({ id: 2, method: 'tools/list' });
    assert.equal((await agent.reply(2)).result.tools.length, 3);
    endpoint.setManifest({ ...MANIFEST, tools: MANIFEST.tools.slice(0, 2) });
    await until(() => agent.messages.some((m) => m.method === 'notifications/tools/list_changed'));
    agent.send({ id: 3, method: 'tools/list' });
    assert.equal((await agent.reply(3)).result.tools.length, 2);
    endpoint.setManifest(MANIFEST);
    agent.stop();
    await until(() => !endpoint.connections.size);
  });

  await check('a call past the tool timeout fails, and an idle agent frees the editor', async () => {
    await endpoint.stop();
    endpoint = makeEndpoint({ toolCallTimeoutMs: 200, idleMs: 400 });
    const released = [];
    endpoint.on('released', (info) => released.push(info.reason));
    await endpoint.start();
    const client = new McpClient(server, { timeoutMs: 8000 });
    await assert.rejects(() => client.callTool('slow', {}), /did not finish within/);
    assert.ok(endpoint.owner, 'the agent still holds the editor right after a call');
    await until(() => released.includes('idle'), 3000);
    assert.equal(endpoint.owner, null);
    // The connection stays open and claims the editor again on its next call.
    assert.equal(text(await client.callTool('echo', { text: 'back' })), 'echo:back:ClipCraft');
    endpoint.disconnect();
    assert.equal(endpoint.owner, null);
    client.stop();
  });

  console.log(`${checks.length} external bridge checks passed`);
} finally {
  await endpoint?.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
