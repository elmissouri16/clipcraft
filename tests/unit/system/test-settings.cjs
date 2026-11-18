// Exercise settings APIs with interrupted writes/renames; never read real settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-settings-'));
const file = path.join(root, 'settings-test', 'settings.json');
const sourceFile = path.resolve(__dirname, "../../../electron/system/settings.cjs");
const localRequire = createRequire(sourceFile);
let fault;
let encryptionAvailable = false;
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
    ? { app: {}, safeStorage: { isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (value) => Buffer.from(`mock-encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^mock-encrypted:/, '') } } : localRequire(id),
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
  // Web research: Codex on and Claude off until changed, saved per agent, never for API providers.
  assert.deepEqual({ ...settings.getPublic().webResearch }, { 'codex-sdk': true, 'claude-agent-sdk': false, 'opencode-sdk': false });
  settings.save({ provider: 'claude-agent-sdk', model: '', webResearch: true });
  assert.equal(settings.getActive().webResearch, true);
  settings.save({ provider: 'codex-sdk', model: '', webResearch: false });
  assert.equal(settings.getActive().webResearch, false);
  settings.save({ provider: 'codex-sdk', model: '' });
  assert.equal(settings.getActive().webResearch, false, 'a save without the field keeps the choice');
  assert.deepEqual({ ...settings.getPublic().webResearch }, { 'codex-sdk': false, 'claude-agent-sdk': true, 'opencode-sdk': false });
  settings.save({ provider: 'openai', model: 'api-model', webResearch: true });
  assert.equal(settings.getActive().webResearch, false, 'API providers have no native research');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ai.webResearch.openai, undefined);
  assert.deepEqual({ ...settings.getPublic().subagents }, { 'codex-sdk': false, 'claude-agent-sdk': false, 'opencode-sdk': false });
  assert.deepEqual({ ...settings.getPublic().subagentConcurrency }, { 'codex-sdk': 2, 'claude-agent-sdk': 2, 'opencode-sdk': 2 });
  for (const provider of ['codex-sdk', 'claude-agent-sdk', 'opencode-sdk']) {
    settings.save({ provider, model: '', subagents: true });assert.equal(settings.getActive().subagents, true);
    settings.save({ provider, model: '' });assert.equal(settings.getActive().subagents, true, 'ordinary saves preserve delegation choice');
    settings.save({ provider, model: '', subagents: false });assert.equal(settings.getActive().subagents, false);
    const beforeQuick = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.setSubagents(provider, { enabled: true, concurrency: 6 });
    const afterQuick = JSON.parse(fs.readFileSync(file, 'utf8')), expectedQuick = structuredClone(beforeQuick);
    expectedQuick.ai.subagents[provider] = true;expectedQuick.ai.subagentConcurrency = { ...(expectedQuick.ai.subagentConcurrency || {}), [provider]: 6 };
    assert.deepEqual(afterQuick, expectedQuick, 'composer delegation updates preserve models, credentials, endpoints and unrelated preferences');
    assert.equal(settings.getActive().subagentConcurrency, 6);
    settings.setSubagents(provider, { concurrency: 1 });assert.equal(settings.getActive().subagents, true);assert.equal(settings.getActive().subagentConcurrency, 1);
    const beforeInvalid = fs.readFileSync(file, 'utf8');
    for (const concurrency of [0, 7, 1.5, '6']) assert.throws(() => settings.setSubagents(provider, { concurrency }), /between 1 and 6/);
    assert.equal(fs.readFileSync(file, 'utf8'), beforeInvalid);
    for (fault of ['write', 'rename']) {
      assert.throws(() => settings.setSubagents(provider, { enabled: false, concurrency: 3 }), /disk full|rename blocked/);
      assert.equal(fs.readFileSync(file, 'utf8'), beforeInvalid, 'failed composer saves preserve the old preference');
    }
    fault = null;
  }
  settings.save({ provider: 'openai', model: 'api-model', subagents: true });assert.equal(settings.getActive().subagents, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ai.subagents.openai, undefined);
  assert.throws(() => settings.setSubagents('codex-sdk', { enabled: false }), /provider changed/);
  settings.save({ provider: 'codex-sdk', model: '', webResearch: true });
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
  const beforeSpeech = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.throws(() => settings.saveServiceKey('gemini-tts', 'synthetic-speech-key'), /Secure storage/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), beforeSpeech);
  encryptionAvailable = true;
  const publicSpeech = settings.saveServiceKey('gemini-tts', 'synthetic-speech-key');
  assert.equal(publicSpeech.serviceKeys['gemini-tts'], '…-key');
  assert.equal(settings.getServiceKey('gemini-tts'), 'synthetic-speech-key');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('synthetic-speech-key'), 'speech key uses the encrypted-key path');
  assert.ok(!JSON.stringify(publicSpeech).includes('synthetic-speech-key'), 'renderer receives only the key hint');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).ai, beforeSpeech.ai, 'speech key does not change the chat provider or keys');
  settings.clearServiceKey('gemini-tts');
  assert.equal(settings.getServiceKey('gemini-tts'), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).ai, beforeSpeech.ai);
  // The central key editor must not switch the active assistant or replace its configuration.
  const beforeCredential = JSON.parse(fs.readFileSync(file, 'utf8'));
  const publicCredential = settings.saveProviderKey('groq', 'synthetic-provider-key');
  const withCredential = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(publicCredential.keys.groq, '…-key');
  assert.equal(settings.getActive('groq').apiKey, 'synthetic-provider-key');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('synthetic-provider-key'));
  assert.ok(!JSON.stringify(publicCredential).includes('synthetic-provider-key'));
  for (const name of ['provider', 'models', 'baseUrls', 'executablePaths', 'reasoningEfforts', 'webResearch', 'subagents', 'subagentConcurrency']) {
    assert.deepEqual(withCredential.ai[name], beforeCredential.ai[name], `key-only save preserves ${name}`);
  }
  assert.deepEqual(withCredential.services, beforeCredential.services);
  const credentialBytes = fs.readFileSync(file, 'utf8');
  for (fault of ['write', 'rename']) {
    assert.throws(() => settings.saveProviderKey('openai', 'replacement-provider-key'), /disk full|rename blocked/);
    assert.equal(fs.readFileSync(file, 'utf8'), credentialBytes);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
  }
  fault = null;
  assert.throws(() => settings.saveProviderKey('codex-sdk', 'unwanted-key'), /does not use an API key/);
  assert.throws(() => settings.saveProviderKey('openai', '  '), /Paste a key/);
  encryptionAvailable = false;
  assert.throws(() => settings.saveProviderKey('openai', 'replacement-provider-key'), /Secure storage/);
  assert.equal(fs.readFileSync(file, 'utf8'), credentialBytes);
  encryptionAvailable = true;
  settings.clearKey('groq');
  assert.equal(settings.getActive().provider, beforeCredential.ai.provider);
  // A settings.json that exists but does not parse is moved aside (settings.json.bad-<time>) before any
  // setter writes, so a hand-edit typo never wipes the saved keys; an earlier copy is never replaced.
  const dir = path.dirname(file), badCopies = () => fs.readdirSync(dir).filter((n) => n.startsWith('settings.json.bad-')).sort();
  const torn = fs.readFileSync(file, 'utf8').replace(/\}\s*$/, ',}');
  fs.writeFileSync(file, torn);
  settings.setWindowState({ x: 0, y: 0, width: 1280, height: 800, maximized: false, fullScreen: false });
  assert.equal(badCopies().length, 1, 'the unreadable settings were set aside');
  assert.equal(fs.readFileSync(path.join(dir, badCopies()[0]), 'utf8'), torn, 'byte for byte, keys included');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).window, 'the new settings file is written after it');
  const tornAgain = '{"language": "fr",,}';
  fs.writeFileSync(file, tornAgain);
  assert.equal(settings.getLanguagePreference(), 'system', 'a torn file reads as empty settings');
  fs.writeFileSync(file, tornAgain + ' ');
  settings.setLanguagePreference('es');
  assert.equal(badCopies().length, 3, 'each torn file gets its own copy, earlier copies are kept');
  assert.equal(fs.readFileSync(path.join(dir, badCopies()[0]), 'utf8'), torn, 'the first copy is never replaced');
  assert.deepEqual(badCopies().slice(1).map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).sort(), [tornAgain, tornAgain + ' '].sort());
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).language, 'es');
  console.log('settings ok (atomic writes, private credentials, key-only edits preserve assistant configuration, torn files set aside)');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
