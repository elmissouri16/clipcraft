// What each native agent actually sends its model (docs/design/agent-adapters.md, phase 0).
// Runs the installed Codex and Claude through ClipCraft's own launch code, pointed at a local fake
// model API (tests/fixtures/fake-model-server.cjs) with temporary config folders: no account, token
// or network. Reports, per agent and web research setting: the tools the model is offered
// (ClipCraft's and any provider built-ins), where ClipCraft's instructions appear, and request
// options. Usage: node scripts/agent-inventory.mjs [--json out.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { startFakeModelServer } = require('../tests/fixtures/fake-model-server.cjs');
const { createLocalAgents } = require('../electron/agents/localAgents.cjs');
const { wireTools } = require('../electron/agents/contract.cjs');
const { nativeTools, nativeSystemPrompt } = await import('../src/features/agent/runNativeAgent.js');

const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
const server = await startFakeModelServer();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-inventory-'));
const codexHome = path.join(root, 'codex-home'), claudeHome = path.join(root, 'claude-home');
fs.mkdirSync(codexHome); fs.mkdirSync(claudeHome);
fs.writeFileSync(path.join(codexHome, 'config.toml'), `model_provider = "probe"\n[model_providers.probe]\nname = "Probe"\nbase_url = "${server.url}/v1"\nwire_api = "responses"\nenv_key = "PROBE_API_KEY"\n`);
const env = { ...process.env, CODEX_HOME: codexHome, PROBE_API_KEY: 'probe', ANTHROPIC_BASE_URL: server.url, ANTHROPIC_API_KEY: 'probe',
  CLAUDE_CONFIG_DIR: claudeHome, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1' };
for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
const agents = createLocalAgents({ env, home: os.homedir() });

const system = nativeSystemPrompt('inventory');
const report = { generated: new Date().toISOString(), runs: [] };
try {
  for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
    const { tools: declarations } = nativeTools(provider);
    const { tools } = wireTools(declarations);
    const offered = new Set(tools.map((t) => t.name));
    for (const webResearch of [false, true]) {
      const from = server.requests.length;
      let error = null;
      try {
        await agents.runEditorNative({ provider, model: provider === 'codex-sdk' ? 'probe-model' : 'claude-probe', webResearch }, {
          sessionKey: `${provider}-${webResearch}`, tools, system, prompt: 'Inventory request: reply with one word.', history: [],
          onTool: async () => ({ content: [{ type: 'text', text: '{"ready":true}' }] }), isComplete: async () => true,
          signal: AbortSignal.timeout(90000) });
      } catch (e) { error = e.message.slice(0, 300); }
      agents.closeNativeSessions();
      const calls = server.requests.slice(from).filter((r) => r.method === 'POST' && /\/(responses|messages)$/.test(r.path) && Array.isArray(r.body?.tools));
      const main = calls.find((r) => r.body.tools.length) || calls[0];
      const run = { provider, webResearch, error, modelRequests: calls.length };
      if (main) {
        const b = main.body;
        const toolName = (t) => t.name || t.type;
        const names = b.tools.map(toolName);
        const bare = (n) => n.replace(/^mcp__clipcraft__/, '');
        run.clipcraftTools = names.filter((n) => offered.has(bare(n))).length;
        run.otherTools = names.filter((n) => !offered.has(bare(n)));
        run.otherToolTypes = b.tools.filter((t) => !offered.has(bare(toolName(t)))).map((t) => ({ name: toolName(t), type: t.type || 'custom' }));
        run.toolNamePrefix = names.some((n) => n.startsWith('mcp__clipcraft__')) ? 'mcp__clipcraft__' : '';
        const systemText = typeof b.instructions === 'string' ? b.instructions
          : Array.isArray(b.system) ? b.system.map((s) => s.text || '').join('\n') : String(b.system || '');
        const messagesText = JSON.stringify(b.input || b.messages || []);
        const marker = 'Live editor revision: inventory';
        run.instructions = { systemChars: systemText.length, systemHash: hash(systemText),
          clipcraftInSystem: systemText.includes(marker), clipcraftInFirstMessage: messagesText.includes(marker),
          providerPreambleChars: systemText.includes(marker) ? systemText.indexOf(system.slice(0, 60)) : systemText.length };
        run.options = Object.fromEntries(Object.entries(b).filter(([k]) => !['tools', 'input', 'messages', 'instructions', 'system', 'metadata'].includes(k))
          .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : v]));
      }
      report.runs.push(run);
    }
  }
} finally {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
const out = process.argv.indexOf('--json');
if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(report, null, 2));
for (const r of report.runs) {
  console.log(`\n== ${r.provider}  web research ${r.webResearch ? 'on' : 'off'}${r.error ? `  ERROR: ${r.error}` : ''}`);
  if (!r.instructions) { console.log('   no model request captured'); continue; }
  console.log(`   ClipCraft tools: ${r.clipcraftTools}  other tools: ${r.otherTools.length ? r.otherTools.join(', ') : 'none'}`);
  console.log(`   instructions: system ${r.instructions.systemChars} chars (ClipCraft in system: ${r.instructions.clipcraftInSystem}, in first message: ${r.instructions.clipcraftInFirstMessage}, provider text before ClipCraft's: ${r.instructions.providerPreambleChars} chars)`);
  console.log(`   options: ${JSON.stringify(r.options)}`);
}
