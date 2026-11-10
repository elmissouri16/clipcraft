// Opt-in live check of the OpenCode runtime against the installed OpenCode CLI (2.x): starts the private
// server from the session directory, creates the ClipCraft session and proves OpenCode connected to the
// in-app MCP endpoint and lists the editor tools. With FVE_OPENCODE_MODEL=provider/model it also runs one
// real turn that must call the tools (uses that model on your OpenCode account; pick a free one).
// Usage: FVE_OPENCODE_LIVE=1 [FVE_OPENCODE_MODEL=opencode/some-free-model] node tests/unit/agents/test-opencode-live.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
if (!process.env.FVE_OPENCODE_LIVE) { console.log('OpenCode live check skipped (set FVE_OPENCODE_LIVE=1 with OpenCode 2.x installed).'); process.exit(0); }
const { findExecutable, searchDirectories } = require('../../../electron/agents/localAgents.cjs');
const { OpenCodeSession, MCP_SERVER } = require('../../../electron/agents/opencodeNative.cjs');
(async () => {
  const executablePath = findExecutable('opencode-sdk', process.env.FVE_OPENCODE_EXECUTABLE || '');
  const sdk = await import('@opencode/client');
  const env = { ...process.env, PATH: searchDirectories().join(path.delimiter) }; delete env.ELECTRON_RUN_AS_NODE;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-opencode-live-'));
  const calls = [];
  const tools = [
    { name: 'get_project', description: 'Read the ClipCraft project: its name and the clips on the timeline.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'set_project_name', description: 'Rename the ClipCraft project.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'The new project name.' } }, required: ['name'], additionalProperties: false } },
  ];
  const session = new OpenCodeSession({ sdk, executablePath, cwd, env, cfg: { provider: 'opencode-sdk', model: process.env.FVE_OPENCODE_MODEL || '' }, tools, webResearch: false,
    system: 'You are the ClipCraft editor agent. You can only act through the clipcraft_* tools. When asked to rename the project, first call clipcraft_get_project, then clipcraft_set_project_name with the requested name, then answer with the single word DONE.' });
  try {
    await session.ready();
    const client = session.client;
    const servers = (await client.mcp.list({ location: { directory: session.cwd } })).data;
    const ours = servers.find((s) => s.name === MCP_SERVER);
    assert.ok(ours, `OpenCode lists the ${MCP_SERVER} MCP server (got ${servers.map((s) => s.name).join(', ') || 'none'})`);
    for (let n = 0; n < 40 && ours.status?.status !== 'connected'; n++) { await new Promise((r) => setTimeout(r, 500)); Object.assign(ours, (await client.mcp.list({ location: { directory: session.cwd } })).data.find((s) => s.name === MCP_SERVER)); }
    assert.equal(ours.status?.status, 'connected', `OpenCode connected to the in-app endpoint (status ${JSON.stringify(ours.status)})`);
    assert.equal(servers.length, 1, 'the user’s global MCP servers are not loaded into the editor session');
    const agents = (await client.agent.list({ location: { directory: session.cwd } })).data;
    const agent = agents.find((a) => a.id === 'clipcraft');
    assert.ok(agent && /ClipCraft editor agent/.test(agent.system), 'the session agent carries the instructions');
    assert.ok(agent.permissions.some((r) => r.action === 'clipcraft_*' && r.effect === 'allow'), 'the ClipCraft tools are allowed');
    const info = await client.session.get({ sessionID: session.sessionID });
    assert.equal((info.data || info).agent, 'clipcraft');
    console.log(`server ${session.server.url}: MCP ${MCP_SERVER} connected, agent clipcraft present, session ${session.sessionID}`);
    if (!process.env.FVE_OPENCODE_MODEL) { console.log('OpenCode live check OK (no model run: set FVE_OPENCODE_MODEL=provider/model to run one real turn).'); return; }
    const onTool = async (name, args, meta) => { calls.push({ name, args, meta }); return { content: [{ type: 'text', text: JSON.stringify(name === 'get_project' ? { name: 'Untitled', clips: 2 } : { ok: true, name: args.name }) }] }; };
    const t0 = Date.now();
    const result = await session.run({ prompt: 'Rename the project to "Sunset Reel".', images: [], onTool, onSearch: () => {}, turnId: 0, signal: AbortSignal.timeout(180000) });
    console.log(`turn in ${Date.now() - t0} ms: text=${JSON.stringify(result.text).slice(0, 200)} calls=${JSON.stringify(calls.map((c) => [c.name, c.args]))} usage=${JSON.stringify(result.tokenUsage)}`);
    assert.ok(calls.some((c) => c.name === 'set_project_name' && /Sunset Reel/i.test(c.args.name || '')), 'the model renamed the project through the MCP tool');
    assert.ok(calls.every((c) => typeof c.meta.nativeCallId === 'string'), 'calls carry native ids');
    console.log('OpenCode live check OK: real server, real session, real tool calls through the in-app MCP endpoint.');
  } finally { session.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
