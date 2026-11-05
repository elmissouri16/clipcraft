// Official SDK adapters with injected SDK transports: no login, network or real keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalAgents, findExecutable, unwrapShim, parseStep } = require('../electron/localAgents.cjs');
const { resolveDraft } = require('../electron/ai.cjs');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-agent-test-')));
const tools = [{ name: 'set_project', description: 'Update the project.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } } } }];
const output = { text: '', calls: [{ name: 'set_project', arguments: '{"name":"SDK Test"}' }] };
const req = { system: 'Edit the project.', contents: [{ role: 'user', parts: [{ text: 'Rename the project.' }] }], tools };
const captured = [];
let response = output;
let failure;
let pending = false;
let closed = 0;
const fakeSdk = {
  Codex: class {
    constructor(options) { captured.push({ kind: 'codex', options }); }
    startThread(options) {
      captured.push({ kind: 'thread', options });
      return { run: async (prompt, options) => {
        captured.push({ kind: 'run', prompt, options });
        if (pending) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        if (failure) throw failure;
        return { finalResponse: JSON.stringify(response) };
      } };
    }
  },
  query({ prompt, options }) {
    captured.push({ kind: 'query', prompt, options });
    return {
      async *[Symbol.asyncIterator]() {
        if (pending) await new Promise((resolve, reject) => options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        if (failure) throw failure;
        yield { type: 'result', subtype: 'success', structured_output: response, result: 'OK' };
      },
      supportedModels: async () => [{ value: 'sonnet', displayName: 'Sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }],
      close() { closed++; },
    };
  },
};
const agents = createLocalAgents({ loadSdk: async () => fakeSdk, resolveExecutable: () => '/installed/agent', home: root,
  env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'private-test-value', ELECTRON_RUN_AS_NODE: '1' },
  execFileImpl(file, args, options, cb) {
    cb(null, args[0] === '--version' ? 'agent 1.0' : JSON.stringify({ loggedIn: true, email: 'do-not-expose', accessToken: 'do-not-expose' }));
  },
});
(async () => {
  try {
    const bin = path.join(root, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const exe = path.join(bin, 'codex');
    fs.writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(findExecutable('codex-sdk', '', { env: { PATH: '' }, home: root }), exe);
    assert.throws(() => findExecutable('codex-sdk', 'codex --arg'), /absolute file path/);
    assert.throws(() => findExecutable('codex-sdk', path.join(root, 'missing')), /not found/);
    const shim = path.join(root, 'claude.cmd');
    const js = path.join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(js), { recursive: true });
    fs.writeFileSync(shim, 'not executed'); fs.writeFileSync(js, 'not executed');
    assert.equal(unwrapShim(shim, 'claude-agent-sdk', 'win32'), js);
    const codexShim = path.join(root, 'codex.cmd');
    const native = path.join(root, 'node_modules', '@openai', 'codex-win32-x64');
    const codexExe = path.join(native, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    fs.mkdirSync(path.dirname(codexExe), { recursive: true });
    fs.writeFileSync(path.join(native, 'package.json'), '{}');
    fs.writeFileSync(codexExe, 'not executed'); fs.writeFileSync(codexShim, 'not executed');
    assert.equal(unwrapShim(codexShim, 'codex-sdk', 'win32', 'x64'), codexExe);
    for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
      const saved = { provider, model: 'previous-model', executablePath: '/saved/path' };
      assert.equal(resolveDraft(saved, { model: '' }).model, '', 'clearing Model tests the CLI default rather than the saved override');
      assert.equal(resolveDraft(saved).model, 'previous-model');
      assert.equal(resolveDraft(saved, { executablePath: '' }).executablePath, '', 'clearing the path restores automatic discovery');
      const status = await agents.status({ provider });
      assert.equal(status.authenticated, true);
      assert.equal(JSON.stringify(status).includes('do-not-expose'), false, 'status never exposes account or credential JSON');
      const result = await agents.agentStep({ provider }, req);
      assert.deepEqual(result.calls, [{ name: 'set_project', args: { name: 'SDK Test' } }]);
      assert.deepEqual(result.content.parts[0], { functionCall: result.calls[0] });
      const call = captured.findLast((entry) => entry.kind === (provider === 'codex-sdk' ? 'run' : 'query'));
      assert.ok(call.prompt.includes('available_tools'));
      assert.ok(call.prompt.includes('Rename the project.'));
      const session = captured.findLast((entry) => entry.kind === (provider === 'codex-sdk' ? 'thread' : 'query'));
      assert.equal(Object.hasOwn(session.options, 'model'), false, 'empty model uses installed CLI default');
      assert.equal(fs.existsSync(session.options.workingDirectory || session.options.cwd), false, 'temporary SDK workspace is removed after completion');
      if (provider === 'codex-sdk') {
        assert.equal(session.options.sandboxMode, 'read-only');
        const client = captured.findLast((entry) => entry.kind === 'codex');
        assert.equal(client.options.config.features.shell_tool, false);
        assert.equal(client.options.env.ELECTRON_RUN_AS_NODE, undefined);
      } else {
        assert.deepEqual(session.options.tools, []);
        assert.equal(session.options.strictMcpConfig, true);
        assert.equal(session.options.persistSession, false);
        assert.equal(session.options.permissionMode, 'dontAsk');
      }
      await agents.agentStep({ provider, model: 'explicit-model' }, req);
      assert.equal(captured.findLast((entry) => entry.kind === (provider === 'codex-sdk' ? 'thread' : 'query')).options.model, 'explicit-model');
      await agents.agentStep({ provider, model: 'explicit-model', reasoningEffort: 'high' }, req);
      const effortOptions = captured.findLast((entry) => entry.kind === (provider === 'codex-sdk' ? 'thread' : 'query')).options;
      assert.equal(effortOptions[provider === 'codex-sdk' ? 'modelReasoningEffort' : 'effort'], 'high', 'saved effort reaches the official SDK option');
      const controller = new AbortController();
      pending = true;
      const canceled = agents.agentStep({ provider }, { ...req, signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      await assert.rejects(canceled, { name: 'AbortError' });
      await assert.rejects(agents.agentStep({ provider }, { ...req, timeoutMs: 10 }), /timed out/);
      pending = false;
      failure = new Error('failed private-test-value');
      await assert.rejects(agents.agentStep({ provider }, req), (error) => !error.message.includes('private-test-value') && error.message.includes('***'));
      failure = null;
    }
    assert.ok(closed > 0, 'Claude query resources are closed');
    assert.equal(resolveDraft({ provider: 'openai', model: 'saved-api-model' }, { model: '' }).model, 'saved-api-model');
    assert.equal(resolveDraft({ provider: 'codex-sdk', model: 'a', reasoningEffort: 'high', reasoningEfforts: { b: 'low' } }, { model: 'b' }).reasoningEffort, 'low');
    assert.equal(resolveDraft({ provider: 'claude-agent-sdk', model: 'a', reasoningEffort: 'high' }, { model: 'b' }).reasoningEffort, '', 'a draft model does not inherit another model’s effort');
    for (const bad of [{ text: '', calls: [{ name: 'run_shell', arguments: '{}' }] },
      { text: '', calls: [{ name: 'set_project', arguments: 'null' }] },
      { text: '', calls: [{ name: 'set_project', arguments: '[]' }] }, { text: '', calls: 'bad' }]) {
      assert.throws(() => parseStep(bad, tools));
    }
    assert.deepEqual((await agents.listModels({ provider: 'claude-agent-sdk' })).models, ['sonnet']);
    assert.deepEqual((await agents.listModels({ provider: 'claude-agent-sdk' })).modelCapabilities.sonnet.reasoningEfforts, ['low', 'medium', 'high']);
    assert.equal((await agents.listModels({ provider: 'codex-sdk' })).useCliDefault, true);
    fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codex', 'models_cache.json'), JSON.stringify({ models: [{ slug: 'codex-model', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] }));
    assert.deepEqual((await agents.listModels({ provider: 'codex-sdk' })).modelCapabilities['codex-model'].reasoningEfforts, ['low', 'high']);
    console.log('local agents ok (SDK tool bridge, discovery, auth privacy, defaults, cancellation, timeout, cleanup)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
