// External agents get the native contract (docs/design/external-agent-mcp.md): the native tool list
// with the same wire names and schemas plus the project tools, the native instructions, the shared
// call budget, and refusals on Home or while CraftAI runs. Plain Node, no Electron.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { wireTools, LIMITS } = require('../../../electron/agents/contract.cjs');
const { nativeTools, nativeSystemPrompt } = await import('../../../src/features/agent/runNativeAgent.js');
const { externalTools, externalInstructions, createExternalHost, PROJECT_TOOLS, TOOL_CALLS_PER_EDIT } = await import('../../../src/features/agent/externalHost.js');

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const names = (tools) => tools.map((t) => t.name);
const PROJECT = names(PROJECT_TOOLS);

await check('the external list excludes CraftAI-only plugin commands', () => {
  assert.deepEqual(PROJECT, ['get_status', 'list_projects', 'create_project', 'duplicate_project', 'open_project', 'save_project', 'close_project']);
  assert.deepEqual(names(externalTools('gemini').tools), [...PROJECT, ...names(nativeTools('claude-agent-sdk', [], { pluginCommands:false }).tools)]);
  assert.deepEqual(names(externalTools('codex-sdk').tools), [...PROJECT, ...names(nativeTools('codex-sdk', [], { pluginCommands:false }).tools)]);
});
await check('image generation only with a Codex sign-in; no re-exported MCP tools', () => {
  assert.ok(!names(externalTools('claude-agent-sdk').tools).some((n) => /generate_image/.test(n)));
  assert.ok(names(externalTools('codex-sdk').tools).includes('generate_images'));
  assert.ok(!names(externalTools('gemini').tools).some((n) => n.startsWith('mcp_')));
});
await check('every shared tool reaches the agent with the native wire schema and description', () => {
  const external = new Map(wireTools(externalTools('gemini').tools).tools.map((t) => [t.name, t]));
  for (const tool of wireTools(nativeTools('claude-agent-sdk', [], { pluginCommands:false }).tools).tools) assert.deepEqual(external.get(tool.name), tool, tool.name);
  for (const name of PROJECT) assert.equal(external.get(name).parameters.type, 'object', name);
});
await check('the instructions are the native ones plus how projects work in the app', () => {
  assert.ok(externalInstructions().startsWith(nativeSystemPrompt()));
  assert.match(externalInstructions(), /Call get_status first/);
});
await check('the per-edit call budget is the contract limit', () => assert.equal(TOOL_CALLS_PER_EDIT, LIMITS.toolCallsPerRequest));

await check('on Home editor tools are refused; while CraftAI runs every change is refused', async () => {
  globalThis.window = { api: {} };
  let screen = 'home', busy = false;
  const calls = [];
  const host = createExternalHost({
    screen: () => screen, project: () => ({ id: 'p1', name: 'Demo', ratio: '9:16', fps: 30 }), loadVersion: () => 1,
    dispatch: () => {}, settle: async () => {}, pilotApp: {}, provider: () => 'gemini', craftBusy: () => busy,
    projects: { status: () => ({ file: null, save_state: 'new' }), list: async () => [{ id: 'p1' }], create: async (a) => { calls.push(['create', a]); screen = 'editor'; return { created: 'p1' }; },
      open: async () => ({ opened: 'p1' }), save: async () => ({ saved: true }), close: async () => ({ screen: 'home' }) },
  });
  assert.match((await host.call({ callId: 'a', name: 'add_text', args: { text: 'x' } })).error, /No project is open/);
  assert.match((await host.call({ callId: 'a-copy', name: 'duplicate_project' })).error, /No project is open/);
  const status = await host.call({ callId: 'b', name: 'get_status', args: {}, client: { name: 'Agent' } });
  assert.equal(status.screen, 'home'); assert.equal(status.connected_as, 'Agent'); assert.equal(status.project, null);
  assert.deepEqual((await host.call({ callId: 'c', name: 'list_projects', args: {} })).projects, [{ id: 'p1' }]);
  busy = true;
  assert.match((await host.call({ callId: 'd', name: 'create_project', args: { format: '9:16' } })).error, /CraftAI is editing/);
  screen = 'editor';
  assert.match((await host.call({ callId: 'e-copy', name: 'duplicate_project' })).error, /CraftAI is editing/);
  assert.match((await host.call({ callId: 'e', name: 'add_text', args: { text: 'x' } })).error, /CraftAI is editing/);
  assert.equal((await host.call({ callId: 'f', name: 'get_status', args: {} })).craftai_busy, true, 'reads still answer');
  busy = false; screen = 'home';
  const created = await host.call({ callId: 'g', name: 'create_project', args: { format: '9:16' } });
  assert.equal(created.created, 'p1'); assert.equal(created.status.screen, 'editor');
  assert.equal(created.status.project.name, 'Demo');
  assert.deepEqual(calls, [['create', { format: '9:16' }]]);
});

console.log(`${checks.length} external contract checks passed`);
