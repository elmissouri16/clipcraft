// MCP client: real handshake, tools/list and tools/call round-trip against the stub server,
// plus registry declaration naming and call routing — all in plain node, no Electron.
import assert from 'assert/strict';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { McpClient, createRegistry } = require('../electron/mcp.cjs');
const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-stub.mjs');
const server = { name: 'Stub Server', command: process.execPath, args: [stub] };

const client = new McpClient(server, { timeoutMs: 10000 });
const init = await client.start();
assert.equal(init.serverInfo.name, 'stub', 'initialize handshake returned the stub identity');
const tools = await client.listTools();
assert.deepEqual(tools.map((t) => t.name), ['echo']);
const res = await client.callTool('echo', { text: 'hello mcp' });
assert.equal(res.content[0].text, 'echo: hello mcp', 'tools/call round-trip');
await assert.rejects(() => client.callTool('missing', {}), /Unknown tool/, 'unknown tools surface the server error');
client.stop();

// Registry: names are prefixed mcp_<server>_<tool> and calls route back.
const registry = createRegistry(() => [server]);
const { decls, problems } = await registry.declarations();
assert.deepEqual(problems, []);
assert.equal(decls.length, 1);
assert.equal(decls[0].name, 'mcp_stub-server_echo');
assert.deepEqual(decls[0].parameters.required, ['text']);
const routed = await registry.call('mcp_stub-server_echo', { text: 'routed' });
assert.equal(routed.result, 'echo: routed');
const tested = await registry.test(server);
assert.deepEqual(tested, { ok: true, tools: ['echo'] });
const badTest = await registry.test({ name: 'nope', command: '/nonexistent/mcp-binary-xyz', args: [] });
assert.equal(badTest.ok, false, 'a missing binary reports failure honestly');
registry.stopAll();
console.log('mcp OK: handshake, list, call, routing, test pass');
process.exit(0);
