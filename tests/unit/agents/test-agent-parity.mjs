// Agent parity at the wire (docs/design/agent-adapters.md): the installed Codex and Claude, started by
// ClipCraft's own launch code against a local fake model API (no account, token or network), must
// send their models the same ClipCraft tools with the same schemas and descriptions, the same
// instruction text once through the system channel, the request context in the request, and no
// provider built-ins beyond the allowed ones. Image generation is the one intended tool difference.
// Skips when an agent is not installed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { startFakeModelServer } = require('../../fixtures/fake-model-server.cjs');
const { createLocalAgents, findExecutable } = require('../../../electron/agents/localAgents.cjs');
const { wireTools } = require('../../../electron/agents/contract.cjs');
const { nativeTools, nativeSystemPrompt, nativeRequestContext } = await import('../../../src/features/agent/runNativeAgent.js');

const PROVIDERS = ['codex-sdk', 'claude-agent-sdk'];
const IMAGE_TOOLS = ['generate_image', 'generate_images'];
// Built-ins each agent may still carry (Codex 0.167 cannot switch request_user_input off; it is
// inert outside Plan mode and ClipCraft refuses it). Anything else fails the test.
const ALLOWED = { 'codex-sdk': { always: ['request_user_input'], web: ['web_search'] }, 'claude-agent-sdk': { always: ['DeferredToolPlaceholder'], web: ['WebSearch', 'WebFetch'] } };

const missing = PROVIDERS.filter((p) => { try { findExecutable(p, '', { env: process.env, home: os.homedir() }); return false; } catch { return true; } });
if (missing.length) { console.log(`AGENT PARITY SKIPPED (not installed: ${missing.join(', ')})`); process.exit(0); }

const server = await startFakeModelServer();
// HTTP chunks may split a multibyte tool description. Preserve the original text.
const unicodeBody = Buffer.from(JSON.stringify({ description: 'Source range 0–1' }));
const unicodeSplit = unicodeBody.indexOf(Buffer.from('–')) + 1;
await new Promise((resolve, reject) => {
  const request = http.request(`${server.url}/unicode-probe`, { method: 'POST' }, (response) => {
    response.resume();
    response.on('end', resolve);
  });
  request.on('error', reject);
  request.write(unicodeBody.subarray(0, unicodeSplit));
  setTimeout(() => request.end(unicodeBody.subarray(unicodeSplit)), 10);
});
assert.equal(server.requests.at(-1).body.description, 'Source range 0–1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-parity-'));
const codexHome = path.join(root, 'codex'), claudeHome = path.join(root, 'claude');
fs.mkdirSync(codexHome); fs.mkdirSync(claudeHome);
fs.writeFileSync(path.join(codexHome, 'config.toml'), `model_provider = "probe"\n[model_providers.probe]\nname = "Probe"\nbase_url = "${server.url}/v1"\nwire_api = "responses"\nenv_key = "PROBE_API_KEY"\n`);
const env = { ...process.env, CODEX_HOME: codexHome, PROBE_API_KEY: 'probe', ANTHROPIC_BASE_URL: server.url, ANTHROPIC_API_KEY: 'probe',
  CLAUDE_CONFIG_DIR: claudeHome, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1' };
for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
const agents = createLocalAgents({ env, home: os.homedir() });
const system = nativeSystemPrompt(), context = nativeRequestContext('parity-check');

// What one agent sent its model for one request.
async function capture(provider, webResearch, subagents = false) {
  const from = server.requests.length;
  const declarations = nativeTools(provider, [], { subagents }).tools;
  const { tools: offered } = wireTools(declarations);
  await agents.runEditorNative({ provider, model: 'probe', webResearch }, { sessionKey: `${provider}-${webResearch}`, tools: offered, system, context,
    prompt: 'Parity check request.', history: [], onTool: async () => ({ content: [{ type: 'text', text: '{}' }] }), isComplete: async () => true, signal: AbortSignal.timeout(120000) });
  agents.closeNativeSessions();
  const request = server.requests.slice(from).find((r) => r.method === 'POST' && Array.isArray(r.body?.tools) && r.body.tools.length);
  assert.ok(request, `${provider} sent its model a request with tools`);
  const b = request.body, turns = b.input || b.messages || [];
  const text = (c) => typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('\n');
  const tools = new Map(), other = [];
  for (const t of b.tools) {
    const name = String(t.name || t.type).replace(/^mcp__clipcraft__/, '');
    if (t.name?.startsWith('mcp__clipcraft__') || (provider === 'codex-sdk' && t.type === 'function' && declarations.some((d) => d.name === name))) tools.set(name, { description: t.description, schema: t.parameters || t.input_schema });
    else other.push(t.name || t.type);
  }
  return { tools, other,
    systemText: [b.instructions || '', Array.isArray(b.system) ? b.system.map((x) => x.text || '').join('\n') : '', ...turns.filter((m) => ['developer', 'system'].includes(m.role)).map((m) => text(m.content))].join('\n'),
    userText: turns.filter((m) => m.role === 'user').map((m) => text(m.content)).join('\n') };
}

// Schema as the model reads it: transport-only keys removed, and an empty properties or required
// (which each transport writes differently) treated as absent.
const empty = (v) => (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const clean = (s) => Array.isArray(s) ? s.map(clean) : s && typeof s === 'object'
  ? Object.fromEntries(Object.entries(s).filter(([k, v]) => !['$schema', 'additionalProperties'].includes(k) && !(['properties', 'required'].includes(k) && empty(v))).map(([k, v]) => [k, clean(v)])) : s;
const count = (haystack, needle) => haystack.split(needle).length - 1;

const checks = [];
try {
  for (const webResearch of [false, true]) for (const subagents of [false, true]) {
    const [codex, claude] = [await capture('codex-sdk', webResearch, subagents), await capture('claude-agent-sdk', webResearch, subagents)];
    const label = `web research ${webResearch ? 'on' : 'off'}, subagents ${subagents ? 'on' : 'off'}`;
    assert.equal(codex.tools.has('delegate_video_analysis'), subagents);
    assert.equal(claude.tools.has('delegate_video_analysis'), subagents);
    // Same tools, apart from image generation.
    const codexNames = [...codex.tools.keys()].filter((n) => !IMAGE_TOOLS.includes(n)).sort(), claudeNames = [...claude.tools.keys()].sort();
    assert.deepEqual(claudeNames, codexNames, `${label}: same ClipCraft tools`);
    assert.ok(IMAGE_TOOLS.every((n) => codex.tools.has(n)) && IMAGE_TOOLS.every((n) => !claude.tools.has(n)), `${label}: image generation is Codex only`);
    assert.ok(claudeNames.length >= 70, `${label}: the full tool list (${claudeNames.length})`);
    // Same descriptions and schemas.
    const differences = [];
    for (const name of claudeNames) {
      if (claude.tools.get(name).description !== codex.tools.get(name).description) differences.push(`${name} description: Claude ${JSON.stringify(claude.tools.get(name).description)} / Codex ${JSON.stringify(codex.tools.get(name).description)}`);
      try { assert.deepEqual(clean(claude.tools.get(name).schema), clean(codex.tools.get(name).schema)); } catch (e) { differences.push(`${name} schema: ${e.message.split('\n').filter((l) => /^[+-] /.test(l.trim()) || /^\s*[+-]\s/.test(l)).slice(0, 4).join(' | ')}`); }
    }
    assert.deepEqual(differences, [], `${label}: tools differ between agents`);
    // No built-ins beyond the allowed ones.
    for (const [provider, got] of [['codex-sdk', codex], ['claude-agent-sdk', claude]]) {
      const allowed = [...ALLOWED[provider].always, ...(webResearch ? ALLOWED[provider].web : [])];
      assert.deepEqual(got.other.filter((n) => !allowed.includes(n)), [], `${label}: ${provider} offers no other built-ins`);
      if (webResearch) assert.ok(ALLOWED[provider].web.every((n) => got.other.includes(n)), `${label}: ${provider} has its web tools`);
      else assert.ok(ALLOWED[provider].web.every((n) => !got.other.includes(n)), `${label}: ${provider} has no web tools`);
      // Instructions once, through the system channel; the request carries its context.
      assert.equal(count(got.systemText, system), 1, `${label}: ${provider} gets the instructions once in its system channel`);
      assert.equal(count(got.userText, system.slice(0, 200)), 0, `${label}: ${provider} request does not repeat the instructions`);
      assert.ok(got.userText.includes(context), `${label}: ${provider} request carries the request context`);
    }
    checks.push(`${label}: ${claudeNames.length} shared tools identical; instructions once; built-ins as allowed`);
  }
  console.log(`AGENT PARITY OK (${checks.join('; ')})`);
} finally {
  agents.closeNativeSessions();
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
