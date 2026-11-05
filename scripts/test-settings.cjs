// Exercise settings APIs with interrupted writes/renames; never read real settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-settings-'));
const file = path.join(root, 'settings-test', 'settings.json');
const sourceFile = path.resolve(__dirname, '../electron/settings.cjs');
const localRequire = createRequire(sourceFile);
let fault;
const injectedFs = { ...fs,
  writeFileSync(target, data, encoding) {
    if (fault === 'write' && typeof target === 'number') {
      fs.writeFileSync(target, data.slice(0, 12), encoding);
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    }
    return fs.writeFileSync(target, data, encoding);
  },
  renameSync(from, to) {
    if (fault === 'rename') throw Object.assign(new Error('rename blocked'), { code: 'EACCES' });
    return fs.renameSync(from, to);
  },
};
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), {
  module: moduleStub, Buffer, process: { env: { FVE_SMOKE: root } },
  require: (id) => id === 'fs' ? injectedFs : id === 'electron'
    ? { app: {}, safeStorage: { isEncryptionAvailable: () => false } } : localRequire(id),
}, { filename: sourceFile });
const settings = moduleStub.exports;
try {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = { quality: 'medium', futureSetting: { keep: true }, ai: { keys: { openai: { enc: 'encrypted-placeholder', hint: '…abcd' } } } };
  fs.writeFileSync(file, JSON.stringify(existing));
  const before = fs.readFileSync(file, 'utf8');
  for (fault of ['write', 'rename']) {
    assert.throws(() => settings.setQuality('low'), /disk full|rename blocked/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'failure preserves the previous settings byte-for-byte');
    assert.equal(settings.getQuality(), 'medium');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'], 'failure cleans partial settings');
  }
  fault = null;
  assert.equal(settings.setQuality('low'), 'low');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.quality, 'low');
  assert.equal(saved.proxy, true);
  assert.deepEqual(saved.ai, existing.ai, 'encrypted key records remain unchanged');
  assert.deepEqual(saved.futureSetting, existing.futureSetting);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // Adding SDK settings must preserve the API key records and unrelated settings
  // of an existing profile, including when switching back to an API provider.
  for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
    settings.save({ provider, model: '', executablePath: `/custom/${provider}` });
    assert.equal(settings.getPublic().provider, provider);
    assert.equal(settings.getActive().model, '', 'an empty SDK model delegates to the installed CLI');
    assert.equal(settings.getActive().executablePath, `/custom/${provider}`);
    assert.equal(settings.getPublic().keys.openai, existing.ai.keys.openai.hint);
  }
  settings.save({ provider: 'openai', model: 'api-model' });
  assert.equal(settings.getActive().provider, 'openai');
  assert.equal(settings.getActive().model, 'api-model');
  assert.equal(settings.getPublic().executablePaths['codex-sdk'], '/custom/codex-sdk');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).ai.keys, existing.ai.keys);
  for (const provider of ['codex-sdk', 'claude-agent-sdk', 'custom', 'openai']) {
    settings.save({ provider, model: 'original-model', baseUrl: 'https://keep.example/v1', executablePath: '/keep/agent' });
    const beforeModel = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.setModel(provider, '  selected-model  ');
    assert.equal(settings.getActive().model, 'selected-model');
    const afterModel = JSON.parse(fs.readFileSync(file, 'utf8'));
    const expected = structuredClone(beforeModel);
    expected.ai.models[provider] = 'selected-model';
    assert.deepEqual(afterModel, expected, 'quick model selection changes only that model, preserving credentials, endpoints and paths');
    const stable = fs.readFileSync(file, 'utf8');
    assert.throws(() => settings.setModel(provider === 'openai' ? 'custom' : 'openai', 'bad'), /provider changed/);
    assert.equal(fs.readFileSync(file, 'utf8'), stable);
    fault = 'rename';
    assert.throws(() => settings.setModel(provider, 'unsaved-model'), /rename blocked/);
    fault = null;
    assert.equal(fs.readFileSync(file, 'utf8'), stable, 'failed quick selections preserve the saved model');
  }
  for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
    settings.save({ provider, model: 'model-a', baseUrl: 'https://keep.example/v1', executablePath: '/keep/agent' });
    settings.setReasoningEffort(provider, 'model-a', 'high');
    assert.equal(settings.getActive().reasoningEffort, 'high');
    settings.setModel(provider, 'model-b');
    assert.equal(settings.getActive().reasoningEffort, '', 'effort overrides do not leak to a different model');
    settings.setReasoningEffort(provider, 'model-b', 'low');
    settings.setModel(provider, 'model-a');
    assert.equal(settings.getActive().reasoningEffort, 'high', 'each model retains its own effort choice');
    assert.equal(settings.getActive().baseUrl, 'https://keep.example/v1');
    assert.equal(settings.getActive().executablePath, '/keep/agent');
    assert.throws(() => settings.setReasoningEffort(provider, 'model-b', 'high'), /model changed/);
    assert.throws(() => settings.setReasoningEffort(provider, 'model-a', 'unknown'), /Invalid thinking effort/);
    settings.setReasoningEffort(provider, 'model-a', '');
    assert.equal(settings.getActive().reasoningEffort, '', 'CLI default clears the explicit override');
  }
  for (const provider of ['openai', 'groq', 'openrouter', 'custom', 'claude', 'gemini', 'ollama']) {
    settings.save({ provider, model: 'model-a' });
    settings.setReasoningEffort(provider, 'model-a', 'high', ['low', 'high']);
    settings.setModel(provider, 'model-b');
    assert.equal(settings.getActive().reasoningEffort, '');
    settings.setReasoningEffort(provider, 'model-b', 'low', ['low']);
    settings.setModel(provider, 'model-a');
    assert.equal(settings.getActive().reasoningEffort, 'high');
    assert.throws(() => settings.setReasoningEffort(provider, 'model-a', 'max', ['low', 'high']), /Invalid thinking effort/);
    settings.setReasoningEffort(provider, 'model-a', '', []);
    assert.equal(settings.getActive().reasoningEffort, '');
  }
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  legacy.ai.provider = 'gemini'; legacy.ai.models.gemini = '';
  fs.writeFileSync(file, JSON.stringify(legacy));
  const defaultModel = settings.getActive().model;
  settings.setReasoningEffort('gemini', defaultModel, 'low', ['low']);
  assert.equal(settings.getActive().reasoningEffort, 'low', 'legacy blank API models use their actual default model key');
  console.log('settings ok (write/rename failures preserve keys, compatible JSON, private mode)');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
