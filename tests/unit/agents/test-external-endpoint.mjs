// ClipCraft's MCP server for outside agents (docs/design/external-agent-mcp.md), in plain Node with
// the MCP SDK's own HTTP client: the token, host and browser checks; one agent at a time with
// takeover after idle; CraftAI first; approval; cancel; progress; timeouts; tool list changes;
// Disconnect; a restart; a port already in use.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ExternalEndpoint } = require('../../../electron/agents/external/endpoint.cjs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ToolListChangedNotificationSchema } = require('@modelcontextprotocol/sdk/types.js');

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); if (process.env.VERBOSE) console.log("ok", name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(20); } throw new Error('Timed out'); };
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const TOKEN = 'c'.repeat(64);
const MANIFEST = { instructions: 'Stub ClipCraft instructions.', tools: [
  { name: 'get_status', description: 'status', inputSchema: { type: 'object', properties: {} } },
  { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'slow', description: 'waits', inputSchema: { type: 'object', properties: {} } },
] };
let approveAnswer = true, approvals = 0, craftBusy = false, lastSignal = null;
function makeEndpoint(limits = {}) {
  const endpoint = new ExternalEndpoint({ port, token: TOKEN, version: '9.9.9', isCraftBusy: () => craftBusy,
    limits: { toolCallTimeoutMs: 60000, takeoverMs: 60000, sessionIdleMs: 3600000, ...limits },
    approve: async () => { approvals++; return approveAnswer; },
    onCall: async (call, owner) => {
      if (call.name === 'echo') return { content: [{ type: 'text', text: `echo:${call.args.text}:${owner.client.name}` }] };
      if (call.name === 'slow') {
        lastSignal = call.signal;
        call.progress(1, 'Rendering');
        await new Promise((resolve) => { call.signal.addEventListener('abort', resolve, { once: true }); setTimeout(resolve, 1500); });
        return { content: [{ type: 'text', text: call.signal.aborted ? 'stopped' : 'slow done' }] };
      }
      return { content: [{ type: 'text', text: '{"screen":"home"}' }] };
    } });
  endpoint.setManifest(MANIFEST);
  return endpoint;
}
const clients = [];
// After a server restart fetch may first reuse a pooled socket of the old server (reset): retry once.
async function agent(name, token = TOKEN, retry = true) {
  const client = new Client({ name, version: '1.0' });
  try { await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); }
  catch (error) { if (retry && /fetch failed/.test(error.message)) return agent(name, token, false); throw error; }
  clients.push(client);
  return client;
}
const text = (r) => r.content.map((c) => c.text).join('\n');
const raw = (headers) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent:false, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
  req.once('error',reject);
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }));
});

let endpoint = makeEndpoint();
try {
  await endpoint.start();
  await check('only local MCP clients with the token get in: no token, a wrong one, a browser or a foreign Host are refused', async () => {
    assert.equal(await raw({}), 401);
    assert.equal(await raw({ authorization: `Bearer ${'d'.repeat(64)}` }), 401);
    assert.equal(await raw({ authorization: `Bearer ${TOKEN}`, origin: 'https://example.com' }), 403);
    assert.equal(await raw({ authorization: `Bearer ${TOKEN}`, host: `evil.example:${port}` }), 403);
    await assert.rejects(() => agent('Wrong', 'e'.repeat(64)));
  });

  await check('an agent initializes, lists the tools and calls them under its own name', async () => {
    const a = await agent('Claude Code');
    assert.equal(a.getServerVersion().name, 'clipcraft');
    assert.equal(a.getInstructions(), MANIFEST.instructions);
    assert.deepEqual((await a.listTools()).tools.map((t) => t.name), ['get_status', 'echo', 'slow']);
    assert.equal(text(await a.callTool({ name: 'echo', arguments: { text: 'hi' } })), 'echo:hi:Claude Code');
    assert.equal(endpoint.status().owner.client.name, 'Claude Code');
    assert.equal(endpoint.status().owner.active, true);
  });

  await check('a second agent is refused while the first works', async () => {
    const b = await agent('Codex');
    const r = await b.callTool({ name: 'echo', arguments: { text: 'b' } });
    assert.equal(r.isError, true);
    assert.match(text(r), /being used by Claude Code/);
    assert.equal(endpoint.yieldToCraft(), 'Claude Code', 'CraftAI may not start while the agent works');
  });

  await check('CraftAI comes first: agents cannot take the editor while it runs', async () => {
    await endpoint.disconnect();
    craftBusy = true;
    const c = await agent('Codex');
    assert.match(text(await c.callTool({ name: 'echo', arguments: { text: 'x' } })), /CraftAI is editing/);
    craftBusy = false;
    assert.equal(endpoint.owner, null);
  });

  await check('cancel reaches the running call, and progress reaches the agent', async () => {
    const a = await agent('Progress agent');
    const seen = [];
    const controller = new AbortController();
    const running = a.callTool({ name: 'slow', arguments: {} }, undefined, { signal: controller.signal, onprogress: (p) => seen.push(p) });
    await until(() => seen.length > 0);
    assert.deepEqual(seen[0], { progress: 1, message: 'Rendering' });
    controller.abort();
    await assert.rejects(running);
    await until(() => lastSignal?.aborted);
    await endpoint.disconnect();
  });

  await check('a denied agent cannot edit and is asked again next time', async () => {
    approveAnswer = false; const before = approvals;
    const a = await agent('Denied agent');
    assert.match(text(await a.callTool({ name: 'echo', arguments: { text: 'x' } })), /did not allow Denied agent/);
    approveAnswer = true;
    assert.equal(text(await a.callTool({ name: 'echo', arguments: { text: 'y' } })), 'echo:y:Denied agent');
    assert.equal(approvals - before, 2);
    await endpoint.disconnect();
  });

  await check('tool list changes reach connected agents', async () => {
    const a = await agent('Listener');
    let changed = 0;
    a.setNotificationHandler(ToolListChangedNotificationSchema, () => { changed++; });
    await wait(300); // the client opens its notification stream (GET) after initializing
    endpoint.setManifest({ ...MANIFEST, tools: MANIFEST.tools.slice(0, 2) });
    await until(() => changed > 0);
    assert.equal((await a.listTools()).tools.length, 2);
    endpoint.setManifest(MANIFEST);
  });

  await check('a call past the timeout fails; an idle holder is replaced by another agent or by CraftAI', async () => {
    for (const c of clients.splice(0)) await c.close().catch(() => {});
    await endpoint.stop();
    endpoint = makeEndpoint({ toolCallTimeoutMs: 200, takeoverMs: 300 });
    const released = [];
    endpoint.on('released', (info) => released.push(info.reason));
    await endpoint.start();
    const a = await agent('First');
    const slow = await a.callTool({ name: 'slow', arguments: {} });
    assert.equal(slow.isError, true); assert.match(text(slow), /did not finish within/);
    const b = await agent('Second');
    assert.match(text(await b.callTool({ name: 'echo', arguments: { text: 'early' } })), /being used by First/);
    await until(() => !endpoint.status().owner.active, 2000);
    assert.equal(text(await b.callTool({ name: 'echo', arguments: { text: 'late' } })), 'echo:late:Second');
    assert.deepEqual(released, ['replaced']);
    await until(() => !endpoint.status().owner.active, 2000);
    assert.equal(endpoint.yieldToCraft(), null, 'CraftAI takes over an idle agent');
    assert.equal(endpoint.owner, null);
    assert.deepEqual(released, ['replaced', 'craftai']);
    // The idle agent's next call claims the editor again.
    assert.equal(text(await a.callTool({ name: 'echo', arguments: { text: 'back' } })), 'echo:back:First');
  });

  await check('Disconnect ends the holder\'s session', async () => {
    const id = endpoint.owner.id;
    await endpoint.disconnect();
    assert.equal(endpoint.owner, null);
    assert.ok(!endpoint.sessions.has(id));
  });

  // The SDK client's background notification stream rejects unhandled when its server goes away
  // (test clients only; agents run their own clients).
  process.on('unhandledRejection', (error) => { if (!/fetch failed/.test(error?.message || '')) throw error; });
  await check('after a restart old sessions are gone and a new session works', async () => {
    const previous = new Set(endpoint.sessions.keys());
    const a = await agent('Restarted');
    const staleId = [...endpoint.sessions.keys()].find(id => !previous.has(id));
    assert.ok(staleId, 'capture the real initialized session');
    await endpoint.stop();
    await assert.rejects(() => a.callTool({ name: 'echo', arguments: { text: 'x' } }));
    endpoint = makeEndpoint();
    await endpoint.start();
    // Assert routing on a fresh connection. The old client's fetch pool can
    // still contain closed sockets; that transport error does not exercise 404.
    assert.equal(await raw({ authorization: `Bearer ${TOKEN}`, 'mcp-session-id':staleId }),404);
    const fresh = await agent('Restarted');
    assert.equal(text(await fresh.callTool({ name: 'echo', arguments: { text: 'ok' } })), 'echo:ok:Restarted');
  });

  await check('a port already in use is reported clearly', async () => {
    const other = makeEndpoint();
    await assert.rejects(() => other.start(), /Port \d+ is already in use/);
    assert.match(other.status().error, /already in use/);
  });

  console.log(`${checks.length} external endpoint checks passed`);
} finally {
  for (const c of clients) await c.close().catch(() => {});
  await endpoint.stop().catch(() => {});
}
process.exit(0);
