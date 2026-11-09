// One-click setup of ClipCraft in Claude Code, Codex and OpenCode (docs/design/external-agent-mcp.md),
// with the real CLIs when they are installed, each pointed at a temporary home (never the user's own
// settings). Checks each agent reads what was written, other servers in the files stay untouched,
// Remove works, and a real Claude Code reaches a running ClipCraft endpoint with the installed setup.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { createInstaller, codexSection } = require('../../../electron/agents/external/install.cjs');
const { searchDirectories } = require('../../../electron/agents/localAgents.cjs');
const { ExternalEndpoint } = require('../../../electron/agents/external/endpoint.cjs');

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-agent-home-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const childEnv = { ...env, HOME: home };
  const checks = [], skipped = [];
  const check = async (name, fn) => { await fn(); checks.push(name); };
  const port = 39000 + Math.floor(Math.random() * 900), token = 'f'.repeat(64), url = `http://127.0.0.1:${port}/mcp`;
  const installer = createInstaller({ home, env, searchDirectories });
  let endpoint;
  try {
    const agents = await installer.list({ url, token });
    const found = Object.fromEntries(agents.map((a) => [a.id, a.found]));
    console.log('Agents found:', JSON.stringify(found));

    await check('the three agents are listed, none set up in a fresh home, each with its config file', () => {
      assert.deepEqual(agents.map((a) => a.id), ['claude', 'codex', 'opencode']);
      assert.ok(agents.every((a) => !a.installed && !a.current));
      assert.equal(agents.find((a) => a.id === 'claude').configFile, path.join(home, '.claude', '.claude.json'));
      assert.equal(agents.find((a) => a.id === 'codex').configFile, path.join(home, '.codex', 'config.toml'));
      assert.equal(agents.find((a) => a.id === 'opencode').configFile, path.join(home, '.config', 'opencode', 'opencode.json'));
    });

    await check('an agent that is not installed cannot be set up', async () => {
      const none = createInstaller({ home, env, searchDirectories: () => [] });
      assert.ok((await none.list({ url, token })).every((a) => !a.found));
      await assert.rejects(() => none.install('claude', { url, token }), /was not found on this computer/);
    });

    await check('Codex: other settings stay, the table is replaced on update and removed cleanly', async () => {
      const file = installer.files.codex;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const before = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other-mcp"\n\n[mcp_servers.clipcraft]\nurl = "http://old"\n[mcp_servers.clipcraft.env]\nX = "1"\n\n[profiles.fast]\nmodel = "mini"\n';
      fs.writeFileSync(file, before);
      if (!found.codex) { skipped.push('codex install (not installed)'); return; }
      await installer.install('codex', { url, token });
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /model = "gpt-5"/); assert.match(text, /\[mcp_servers\.other\]\ncommand = "other-mcp"/); assert.match(text, /\[profiles\.fast\]\nmodel = "mini"/);
      assert.equal((text.match(/\[mcp_servers\.clipcraft/g) || []).length, 1, 'one ClipCraft table, the old one and its sub-table gone');
      // The real Codex reads it as a streamable HTTP server with the header.
      const codex = (await installer.list({ url, token })).find((a) => a.id === 'codex');
      assert.ok(codex.installed && codex.current);
      const exe = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], { env: { ...env, PATH: searchDirectories(env, home).join(path.delimiter) } }).toString().trim().split('\n')[0];
      const parsed = JSON.parse(execFileSync(exe, ['mcp', 'get', 'clipcraft', '--json'], { env: childEnv }).toString());
      assert.equal(parsed.transport.type, 'streamable_http'); assert.equal(parsed.transport.url, url);
      assert.equal(parsed.transport.http_headers.Authorization, `Bearer ${token}`); assert.equal(parsed.tool_timeout_sec, 900);
      await installer.remove('codex');
      const after = fs.readFileSync(file, 'utf8');
      assert.ok(!/clipcraft/.test(after)); assert.match(after, /\[mcp_servers\.other\]/); assert.match(after, /\[profiles\.fast\]/);
      assert.equal(codexSection(after).section, '');
    });

    await check('OpenCode: set up through its CLI, other servers stay, Remove deletes only ClipCraft', async () => {
      if (!found.opencode) { skipped.push('opencode (not installed)'); return; }
      const file = installer.files.opencode;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ theme: 'dark', mcp: { servers: { other: { type: 'local', command: ['other'] } } } }, null, 2));
      await installer.install('opencode', { url, token });
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(config.theme, 'dark'); assert.ok(config.mcp.servers.other);
      assert.equal(config.mcp.servers.clipcraft.url, url); assert.equal(config.mcp.servers.clipcraft.headers.Authorization, `Bearer ${token}`);
      // Installing again (an update) leaves one entry.
      await installer.install('opencode', { url, token });
      assert.ok((await installer.list({ url, token })).find((a) => a.id === 'opencode').current);
      await installer.remove('opencode');
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.ok(!after.mcp.servers.clipcraft); assert.ok(after.mcp.servers.other); assert.equal(after.theme, 'dark');
    });

    await check('Claude Code: set up through its CLI, and the real Claude Code connects to a running ClipCraft', async () => {
      if (!found.claude) { skipped.push('claude (not installed)'); return; }
      await installer.install('claude', { url, token });
      const config = JSON.parse(fs.readFileSync(installer.files.claude, 'utf8')).mcpServers.clipcraft;
      assert.deepEqual(config, { type: 'http', url, headers: { Authorization: `Bearer ${token}` } });
      assert.ok((await installer.list({ url, token })).find((a) => a.id === 'claude').current);
      assert.ok(!(await installer.list({ url, token: 'a'.repeat(64) })).find((a) => a.id === 'claude').current, 'a different key needs an update');
      endpoint = new ExternalEndpoint({ port, token, version: '1.0.0', limits: { toolCallTimeoutMs: 60000, takeoverMs: 120000, sessionIdleMs: 3600000 }, onCall: async () => ({ content: [] }) });
      endpoint.setManifest({ instructions: 'test', tools: [{ name: 'get_status', description: 'status', inputSchema: { type: 'object', properties: {} } }] });
      await endpoint.start();
      const exe = execFileSync('which', ['claude'], { env: { ...env, PATH: searchDirectories(env, home).join(path.delimiter) } }).toString().trim();
      // Async: the endpoint answers from this same process.
      const health = await new Promise((resolve, reject) => execFile(exe, ['mcp', 'list'], { env: childEnv, timeout: 60000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
      assert.match(health, /clipcraft: http:\/\/127\.0\.0\.1:\d+\/mcp \(HTTP\) - ✔ Connected/, health);
      await installer.remove('claude');
      assert.ok(!JSON.parse(fs.readFileSync(installer.files.claude, 'utf8')).mcpServers?.clipcraft);
    });

    console.log(`${checks.length} external install checks passed${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`);
  } finally {
    await endpoint?.stop().catch(() => {});
    fs.rmSync(home, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
