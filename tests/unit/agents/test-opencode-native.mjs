// OpenCode native runtime with an injected client and server process: no OpenCode binary, network or
// credentials. Proves the wire: the session directory's opencode.json (agent, permissions, MCP server),
// the private server's launch (random password, isolated config dir), the session (agent, model ref,
// per-session rules), the editor tools reached over the real MCP HTTP endpoint with a bearer token,
// permission handling, text/usage/terminal events, interrupt on abort, and the one-shot JSON path.
// Usage: node tests/unit/agents/test-opencode-native.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OpenCodeSession, runOnce, projectConfig, permissionRules, modelRef, usageOf, versionMatches: _unused } = require('../../../electron/agents/opencodeNative.cjs');
const { createOpenCodeAdapter } = require('../../../electron/agents/adapters/opencode.cjs');
const { distribution, versionMatches } = require('../../../electron/agents/agentRuntime.cjs');
const { PROVIDERS, unwrapShim } = require('../../../electron/agents/localAgents.cjs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const checks = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const tools = [
  { name: 'get_project', description: 'Read the project.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'add_text', description: 'Add a title.', parameters: { type: 'object', properties: { text: { type: 'string' }, start_sec: { type: 'number' } }, required: ['text'] } },
  { name: 'complete_edit', description: 'Finish.', parameters: { type: 'object', properties: {} } },
];

// A fake `opencode serve`: records how it was launched and announces a URL.
const launches = [];
function fakeSpawn(file, args, options) {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.killed = false;
  proc.kill = () => { proc.killed = true; proc.emit('exit', 0); };
  launches.push({ file, args, options, proc });
  setTimeout(() => proc.stdout.write(`opencode ready\nserver listening on http://127.0.0.1:65530\nserver password ${options.env.OPENCODE_SERVER_PASSWORD}\n`), 10);
  return proc;
}

// A fake @opencode/client: the subset the runtime uses. On prompt it behaves like the model: asks one
// forbidden permission, calls the editor tools over the real MCP endpoint, streams text, reports usage, ends.
function fakeSdk(behaviour) {
  const log = { creates: [], prompts: [], replies: [], interrupts: [], clients: [], mcpAdds: [], mcpConnects: 0 };
  const queue = []; let wake = null;
  const emit = (type, data) => { queue.push({ type, data }); wake?.(); };
  const client = {
    session: {
      create: async (input) => { log.creates.push(input); return { id: 'ses_test1', agent: input.agent }; },
      prompt: async (input) => { log.prompts.push(input); setTimeout(() => behaviour({ input, emit, log }).catch((e) => emit('session.execution.failed', { sessionID: 'ses_test1', error: { message: e.message } })), 5); return { id: 'msg_u1' }; },
      interrupt: async (input) => { log.interrupts.push(input); emit('session.execution.interrupted', { sessionID: 'ses_test1', reason: 'user' }); return { interrupted: true }; },
      get: async () => ({ id: 'ses_test1', time: { created: 1, updated: 1 } }),
    },
    permission: { reply: async (input) => { log.replies.push(input); } },
    experimental: { mcp: { add: async (input) => { log.mcpAdds.push(input); }, connect: async () => { log.mcpConnects++; } } },
    mcp: { list: async () => ({ data: log.mcpAdds.map((a) => ({ name: a.server, status: { status: log.mcpConnects ? 'connected' : 'pending' } })) }) },
    message: { list: async () => ({ data: [{ type: 'idle', outcome: 'succeeded' }, { type: 'assistant', content: [{ type: 'text', text: 'from message list' }] }], cursor: {} }) },
    event: { subscribe: ({ types, signal }) => ({ async *[Symbol.asyncIterator]() {
      log.subscribed = types;
      while (!signal?.aborted) {
        if (queue.length) { yield queue.shift(); continue; }
        await new Promise((resolve) => { wake = resolve; signal?.addEventListener('abort', resolve, { once: true }); });
        wake = null;
      }
    } }) },
  };
  return { sdk: { OpenCode: { make: (options) => { log.clients.push(options); return client; } } }, log, emit };
}
const fileOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
async function mcpClientFor(log) {
  const server = log.mcpAdds[0].config;
  const client = new Client({ name: 'opencode-fake', version: '2.2.6' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: server.headers.Authorization } } }));
  return client;
}

// ---- pure helpers ----
assert.equal(PROVIDERS['opencode-sdk'].cli, 'opencode');
assert.deepEqual(modelRef({ model: 'opencode/claude-fable-5-2', reasoningEffort: 'high' }), { providerID: 'opencode', id: 'claude-fable-5-2', variant: 'high' });
assert.equal(modelRef({ model: '' }), null); assert.equal(modelRef({ model: 'just-a-name' }), null, 'a bare name is not an OpenCode model ref');
const rules = permissionRules(false);
assert.deepEqual(rules[0], { action: '*', resource: '*', effect: 'deny' }); assert.deepEqual(rules[1], { action: 'clipcraft_*', resource: '*', effect: 'allow' });
assert.ok(permissionRules(true).some((r) => r.action === 'websearch' && r.effect === 'allow'), 'web research allows OpenCode web tools');
assert.deepEqual(usageOf({ input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } }), { inputTokens: 10, cachedInputTokens: 3, outputTokens: 5, reasoningOutputTokens: 2, totalTokens: 21 });
assert.equal(distribution('opencode-sdk', 'darwin', 'arm64').executable, 'bin/opencode');
assert.equal(distribution('opencode-sdk', 'win32', 'x64').executable, 'bin/opencode.exe');
assert.equal(distribution('opencode-sdk', 'linux', 'x64', true).key, 'linux-x64-musl');
assert.match(distribution('opencode-sdk', 'linux', 'arm64', false).url, /^https:\/\/registry\.npmjs\.org\/@opencode\/cli-linux-arm64\//);
assert.equal(versionMatches('opencode v2.2.6', '2.2.6'), true); assert.equal(versionMatches('opencode v2.2.60', '2.2.6'), false);
check('helpers: provider entry, model refs, permission rules, usage mapping, downloads and version check', true);

// ---- a retained session through the adapter ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-test-'));
const calls = [];
const { sdk, log } = fakeSdk(async ({ input, emit }) => {
  const sid = 'ses_test1';
  emit('session.execution.started', { sessionID: sid });
  if (input.text.includes('never finishes')) return; // stays busy until interrupted
  emit('permission.asked', { sessionID: sid, id: 'per_1', action: 'read', resources: ['/etc/passwd'] });
  const mcp = await mcpClientFor(log);
  const offered = (await mcp.listTools()).tools.map((t) => t.name);
  check('OpenCode receives the editor tools over the MCP endpoint', offered.join(',') === 'get_project,add_text,complete_edit');
  const first = await mcp.callTool({ name: 'get_project', arguments: {} });
  check('a tool result travels back as MCP content', JSON.parse(first.content[0].text).name === 'Demo');
  await mcp.callTool({ name: 'add_text', arguments: { text: 'Hello', start_sec: 1 } });
  await mcp.callTool({ name: 'complete_edit', arguments: {} });
  await mcp.close();
  emit('session.tool.input.started', { sessionID: sid, assistantMessageID: 'msg_a1', id: 'call_w', name: 'websearch' });
  emit('session.tool.called', { sessionID: sid, assistantMessageID: 'msg_a1', id: 'call_w', input: { query: 'clipcraft' }, executed: true });
  emit('session.tool.success', { sessionID: sid, assistantMessageID: 'msg_a1', id: 'call_w', content: [{ type: 'text', text: 'ok' }], executed: true });
  emit('session.text.ended', { sessionID: sid, assistantMessageID: 'msg_a1', ordinal: 0, text: 'Added ' });
  emit('session.text.ended', { sessionID: sid, assistantMessageID: 'msg_a1', ordinal: 1, text: `the title (${input.text.includes('Add a title') ? 'prompt seen' : 'no prompt'}).` });
  emit('session.usage.updated', { sessionID: sid, cost: 0, tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 50, write: 0 } } });
  emit('session.execution.succeeded', { sessionID: sid });
});
const Session = class extends OpenCodeSession { constructor(o) { super({ ...o, spawnImpl: fakeSpawn }); } };
const adapter = createOpenCodeAdapter({ sdk, executablePath: '/fake/opencode', cwd: dir, env: { PATH: '/usr/bin', OPENAI_API_KEY: 'secret' }, cfg: { provider: 'opencode-sdk', model: 'opencode/claude-fable-5-2', reasoningEffort: 'high' },
  system: 'You edit videos in ClipCraft.', tools, webResearch: true, Session });
const searches = [];
const onTool = async (name, args, meta) => { calls.push({ name, args, meta }); return { content: [{ type: 'text', text: JSON.stringify(name === 'get_project' ? { name: 'Demo' } : name === 'complete_edit' ? { ready: true } : { ok: true }) }] }; };
const result = await adapter.turn({ prompt: 'Add a title saying Hello.', images: [], attempt: 0, signal: new AbortController().signal, onTool, onSearch: (s) => searches.push(s) });
check('the turn resolves with the assistant text in order', result.text === 'Added the title (prompt seen).');
check('token usage is the session total', result.tokenUsage.totalTokens === 175 && adapter.usageTotal().cachedInputTokens === 50);
check('editor callbacks ran once each with native call ids', calls.map((c) => c.name).join(',') === 'get_project,add_text,complete_edit' && calls.every((c) => typeof c.meta.nativeCallId === 'string' && c.meta.turnId === 0) && calls[1].args.text === 'Hello');
check('a forbidden permission request is rejected', log.replies.length === 1 && log.replies[0].decision === 'reject' && log.replies[0].requestID === 'per_1');
check('web research shows as search rows', searches.some((s) => s.status === 'running' && s.query === 'clipcraft') && searches.some((s) => s.status === 'done'));
const config = fileOf(dir);
check('opencode.json defines the ClipCraft agent with the instructions and deny-all permissions', config.default_agent === 'clipcraft' && config.agents.clipcraft.system === 'You edit videos in ClipCraft.' && config.agents.clipcraft.mode === 'primary' && config.agents.clipcraft.permissions[0].effect === 'deny' && config.share === 'disabled');
const added = log.mcpAdds[0];
check('the endpoint is registered with the server as the clipcraft MCP server (bearer token, no OAuth, code mode off) and connected', added.server === 'clipcraft' && added.location.directory === fs.realpathSync(dir) && /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(added.config.url) && /^Bearer [0-9a-f]{64}$/.test(added.config.headers.Authorization) && added.config.codemode === false && added.config.oauth === false && log.mcpConnects === 1 && !Object.keys(config.mcp.servers).length);
const launch = launches[0];
check('the server runs from the session directory with a random password and an isolated config directory', launch.file === '/fake/opencode' && launch.args.join(' ') === 'serve --hostname=127.0.0.1 --port=0' && launch.options.cwd === fs.realpathSync(dir) && launch.options.env.OPENCODE_SERVER_PASSWORD.length >= 24 && launch.options.env.XDG_CONFIG_HOME === path.join(fs.realpathSync(dir), 'config') && fs.existsSync(path.join(dir, 'config', 'opencode')));
check('the client is made for the announced URL with basic auth', log.clients[0].baseUrl === 'http://127.0.0.1:65530' && log.clients[0].headers.Authorization === `Basic ${Buffer.from(`opencode:${launch.options.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`);
check('the session runs as the clipcraft agent in the session directory with the model, variant and rules', log.creates[0].agent === 'clipcraft' && log.creates[0].location.directory === fs.realpathSync(dir) && log.creates[0].model.providerID === 'opencode' && log.creates[0].model.id === 'claude-fable-5-2' && log.creates[0].model.variant === 'high' && log.creates[0].permissions[1].action === 'clipcraft_*');
check('the event stream subscribes to the session events', Array.isArray(log.subscribed) && log.subscribed.includes('permission.asked') && log.subscribed.includes('session.execution.succeeded'));
check('the prompt carries the text', log.prompts[0].sessionID === 'ses_test1' && log.prompts[0].text === 'Add a title saying Hello.');
// A second turn reuses the session (no new server, no new session).
const again = await adapter.turn({ prompt: 'Add a title saying Hello again.', images: [], attempt: 1, signal: new AbortController().signal, onTool, onSearch: () => {} });
check('the next request reuses the server and session', again.text.startsWith('Added') && launches.length === 1 && log.creates.length === 1 && log.prompts.length === 2 && calls.at(-1).meta.turnId === 1);
// Abort interrupts the session.
const stopper = new AbortController();
const pending = adapter.turn({ prompt: 'never finishes', images: [], attempt: 2, signal: stopper.signal, onTool, onSearch: () => {} });
log.prompts.length = 0; await new Promise((r) => setTimeout(r, 20)); stopper.abort();
const stopped = await pending.catch((e) => e);
check('Stop interrupts the OpenCode session and the turn ends as aborted', stopped.name === 'AbortError' && log.interrupts.length === 1);
adapter.close();
check('closing the adapter stops the server process', launch.proc.killed === true);

// ---- one-shot JSON (chat / structured step / connection test) ----
const once = fakeSdk(async ({ emit }) => { emit('session.execution.started', { sessionID: 'ses_test1' }); emit('session.text.ended', { sessionID: 'ses_test1', assistantMessageID: 'm', ordinal: 0, text: '```json\n{"text":"hi","calls":[]}\n```' }); emit('session.execution.succeeded', { sessionID: 'ses_test1' }); });
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-test-'));
const parsed = await runOnce({ sdk: once.sdk, executablePath: '/fake/opencode', cwd: dir2, env: {}, cfg: { provider: 'opencode-sdk' }, system: 'Be brief.', prompt: 'hello', schema: { type: 'object' }, spawnImpl: fakeSpawn });
check('a structured one-shot request returns the parsed JSON object', parsed.text === 'hi' && Array.isArray(parsed.calls));
check('a one-shot request registers no MCP server and tells the agent the schema', once.log.mcpAdds.length === 0 && /JSON Schema/.test(fileOf(dir2).agents.clipcraft.system) && once.log.creates[0].agent === 'clipcraft');
check('a failed turn surfaces OpenCode’s error', await (async () => { const bad = fakeSdk(async ({ emit }) => { emit('session.execution.failed', { sessionID: 'ses_test1', error: { message: 'Provider refused.' } }); }); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-test-')); try { await runOnce({ sdk: bad.sdk, executablePath: '/fake/opencode', cwd: d, env: {}, cfg: {}, prompt: 'x', spawnImpl: fakeSpawn }); return false; } catch (e) { return /Provider refused/.test(e.message); } })());
// The server dying mid-turn fails the turn at once (it used to wait for Stop or the 30-minute timeout).
const within = (promise, ms) => Promise.race([promise.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(new Error('still waiting')), ms))]);
const stuck = async ({ emit }) => { emit('session.execution.started', { sessionID: 'ses_test1' }); }; // busy until something ends it
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-test-'));
  const session = new OpenCodeSession({ sdk: fakeSdk(stuck).sdk, executablePath: '/fake/opencode', cwd: d, env: {}, spawnImpl: fakeSpawn });
  const turn = session.run({ prompt: 'x', signal: new AbortController().signal, onTool, turnId: 0 });
  setTimeout(() => launches.at(-1).proc.emit('exit', null, 'SIGKILL'), 100);
  const error = await within(turn, 3000);
  check('an OpenCode server that exits mid-turn fails the turn with that reason', /OpenCode exited during the request \(SIGKILL\)/.test(error?.message));
  check('the dead session refuses the next turn instead of waiting', /OpenCode exited/.test((await within(session.run({ prompt: 'y', onTool, turnId: 1 }), 1000))?.message));
  session.close(); fs.rmSync(d, { recursive: true, force: true });
}
{
  // No exit seen (the process is not ours to watch, or the event was lost), but the port refuses every reconnect.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-test-'));
  const fake = fakeSdk(stuck), make = fake.sdk.OpenCode.make;
  fake.sdk.OpenCode.make = (options) => ({ ...make(options), event: { subscribe: () => ({ async *[Symbol.asyncIterator]() { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:65530'), { code: 'ECONNREFUSED' }) }); } }) } });
  const session = new OpenCodeSession({ sdk: fake.sdk, executablePath: '/fake/opencode', cwd: d, env: {}, spawnImpl: fakeSpawn });
  const error = await within(session.run({ prompt: 'x', signal: new AbortController().signal, onTool, turnId: 0 }), 5000);
  check('a server that keeps refusing connections fails the turn', /OpenCode stopped answering/.test(error?.message));
  session.close(); fs.rmSync(d, { recursive: true, force: true });
}
// Windows npm shim resolution.
const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-shim-'));
fs.mkdirSync(path.join(shimDir, 'node_modules', '@opencode', 'cli-windows-x64', 'bin'), { recursive: true });
fs.writeFileSync(path.join(shimDir, 'opencode.cmd'), 'shim'); fs.writeFileSync(path.join(shimDir, 'node_modules', '@opencode', 'cli-windows-x64', 'bin', 'opencode.exe'), 'bin');
check('a Windows .cmd shim resolves to the platform package binary', unwrapShim(path.join(shimDir, 'opencode.cmd'), 'opencode-sdk', 'win32', 'x64').endsWith(path.join('cli-windows-x64', 'bin', 'opencode.exe')));
for (const d of [dir, dir2, shimDir]) fs.rmSync(d, { recursive: true, force: true });
console.log(`OpenCode native OK: ${checks.length} checks`);
process.exit(0);
