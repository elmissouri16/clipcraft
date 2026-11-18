// Native agent sessions clean up after themselves, against fake SDKs and fake processes (no agent runs):
// - a Claude session's persisted transcript is deleted through the SDK when the session is disposed, and
//   the projects folder named after its own temp working folder is removed once empty (nothing else);
// - an OpenCode session is removed from OpenCode's store before its server is stopped;
// - a working folder is removed only after the agent's process has exited, and a removal that fails
//   (Windows EBUSY) never replaces the real result.
// Usage: node tests/unit/agents/test-native-cleanup.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClaudeAdapter, transcriptFolders } = require('../../../electron/agents/adapters/claude.cjs');
const { OpenCodeSession } = require('../../../electron/agents/opencodeNative.cjs');
const { createNativeAgents } = require('../../../electron/agents/nativeAgents.cjs');
const { createLocalAgents } = require('../../../electron/agents/localAgents.cjs');
const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-cleanup-test-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  // ---- Claude: deleteSession for this session's id, in this session's folder.
  {
    const cwd = fs.mkdtempSync(path.join(root, 'claude-cwd-')), config = path.join(root, 'claude-config');
    const env = { CLAUDE_CONFIG_DIR: config };
    const [folder] = transcriptFolders(cwd, env);
    fs.mkdirSync(folder, { recursive: true });
    const other = path.join(config, 'projects', 'someone-elses-project'); fs.mkdirSync(other, { recursive: true }); fs.writeFileSync(path.join(other, 'keep.jsonl'), '{}');
    const deleted = [], id = '11111111-2222-4333-8444-555555555555';
    const sdk = {
      createSdkMcpServer: () => ({ instance: { registerTool() {}, server: { removeRequestHandler() {}, setRequestHandler() {} }, close: async () => {} } }),
      query: () => ({ async *[Symbol.asyncIterator]() { yield { type: 'system', session_id: id }; yield { type: 'result', subtype: 'success', result: 'ok', session_id: id }; }, close() {} }),
      deleteSession: async (sessionId, options) => { deleted.push({ sessionId, options }); },
    };
    const adapter = createClaudeAdapter({ sdk, executablePath: '/fake/claude', cwd, env, cfg: {}, system: 's', tools: [], webResearch: false });
    await adapter.turn({ prompt: 'hi', images: [], attempt: 0, signal: new AbortController().signal, onTool: async () => ({}) });
    await adapter.close();
    check('the Claude session transcript is deleted with its own id and folder', deleted.length === 1 && deleted[0].sessionId === id && deleted[0].options.dir === cwd);
    check('the empty projects folder of its temp working folder is removed', !fs.existsSync(folder));
    check('another project\'s transcripts are never touched', fs.existsSync(path.join(other, 'keep.jsonl')));
    await adapter.close();
    check('closing twice deletes nothing more', deleted.length === 1);
    const unused = createClaudeAdapter({ sdk, executablePath: '/fake/claude', cwd, env, cfg: {}, system: 's', tools: [], webResearch: false });
    await unused.close();
    check('a session that never ran deletes nothing', deleted.length === 1);
  }

  // ---- OpenCode: session.remove before the server process is stopped.
  {
    const cwd = fs.mkdtempSync(path.join(root, 'opencode-cwd-')), order = [];
    let proc;
    const spawnImpl = (file, args, options) => {
      proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.exitCode = null; proc.signalCode = null;
      proc.kill = () => { order.push('kill'); setTimeout(() => { proc.exitCode = 0; proc.emit('exit', 0); }, 30); };
      setTimeout(() => proc.stdout.write('server listening on http://127.0.0.1:65531\n'), 5);
      return proc;
    };
    const client = { session: { create: async () => ({ id: 'ses_1' }), remove: async ({ sessionID }) => { order.push(`remove ${sessionID}`); } },
      event: { subscribe: ({ signal }) => ({ async *[Symbol.asyncIterator]() { await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })); } }) } };
    const session = new OpenCodeSession({ sdk: { OpenCode: { make: () => client } }, executablePath: '/fake/opencode', cwd, env: {}, tools: [], spawnImpl });
    await session.ready();
    await session.close();
    check('the OpenCode session is removed from its store before the server stops', order.join(',') === 'remove ses_1,kill');
    check('closing waits until the server process has exited', proc.exitCode === 0);
  }

  // ---- The native session manager removes the folder only after the agent stopped.
  {
    let stopped = false, folder = null;
    class SlowSession {
      constructor({ cwd }) { folder = cwd; this.tokenUsage = null; }
      async run() { return { text: 'done' }; }
      close() { return sleep(80).then(() => { stopped = true; }); }
    }
    const native = createNativeAgents({ loadSdk: async () => ({}), resolveExecutable: () => '/fake/codex', childEnv: () => ({}), CodexSession: SlowSession });
    await native.run({ provider: 'codex-sdk' }, { sessionKey: 'w:1', tools: [], system: 's', prompt: 'p', onTool: async () => ({}), isComplete: async () => true });
    const closing = native.close();
    await sleep(20);
    check('the working folder stays while the agent is still stopping', fs.existsSync(folder) && !stopped);
    await closing;
    check('the working folder goes once the agent has stopped', stopped && !fs.existsSync(folder));
  }

  // ---- localAgents: the catalog process exits before its folder is removed; a failed removal is harmless.
  {
    const alive = new Map(), seen = [];
    class FakeCatalog {
      constructor({ cwd }) { this.cwd = cwd; alive.set(cwd, true); }
      async listModels() { return [{ model: 'gpt-x', displayName: 'GPT X', supportedReasoningEfforts: [] }]; }
      close() { return sleep(50).then(() => alive.set(this.cwd, false)); }
    }
    const realRm = fs.rm;
    fs.rm = (dir, options, callback) => {
      if (alive.has(dir)) { seen.push(alive.get(dir)); if (alive.get(dir)) return callback(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })); }
      return realRm(dir, options, callback);
    };
    try {
      const agents = createLocalAgents({ CodexCatalog: FakeCatalog, resolveExecutable: () => '/fake/codex.exe', home: root, env: { PATH: '' } });
      const models = await agents.listModels({ provider: 'codex-sdk' });
      check('the catalog folder is removed only after its process exited', seen.length === 1 && seen[0] === false);
      check('the model list is returned', models.ok && models.models[0] === 'gpt-x');
      class StuckCatalog extends FakeCatalog { close() { return Promise.resolve(); } }
      const stuck = createLocalAgents({ CodexCatalog: StuckCatalog, resolveExecutable: () => '/fake/codex.exe', home: root, env: { PATH: '' } });
      const still = await stuck.listModels({ provider: 'codex-sdk', refresh: true });
      check('a folder that cannot be removed never replaces the result', still.ok && still.models[0] === 'gpt-x');
      for (const [dir] of alive) realRm(dir, { recursive: true, force: true }, () => {});
    } finally { fs.rm = realRm; }
  }
  console.log(`native cleanup OK: ${checks.length} checks`);
} finally { await sleep(20); fs.rmSync(root, { recursive: true, force: true }); }
