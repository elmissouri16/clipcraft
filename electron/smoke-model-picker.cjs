// Real Settings model selection -> saved config -> actual SDK request. Isolated
// profile; two tiny live prompts. Also covers custom/default and catalog races.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const result = { providers: [], errors: [] };
  const q = (js) => { new vm.Script(js); return win.webContents.executeJavaScript(js); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (js, timeout = 30000) => {
    for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
      if (await q(js)) return;
      await wait(100);
    }
    throw new Error(`Timed out: ${js}`);
  };
  const set = (selector, value) => q(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  const click = (text) => q(`[...document.querySelectorAll('.settings button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const openPicker = () => q(`document.querySelector('button[aria-label="AI model"]').click()`);
  const choose = (id) => q(`[...document.querySelectorAll('.settings-model-picker [role=option]')].find(b => b.textContent.trim() === ${JSON.stringify(id)}).click()`);
  const save = async () => {
    await click('Save');
    await until(`document.querySelector('.settings .result:not([aria-label])')?.textContent.includes('Saved.')`);
  };
  const sdk = require('./localAgents.cjs');
  const ai = require('./ai.cjs');
  const originalTest = ai.testConnection;
  const originalStatus = sdk.status;
  const originalModels = sdk.listModels;
  let requestedModel;
  ai.testConnection = async (cfg) => { requestedModel = cfg.model; return originalTest(cfg); };
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await wait(300);
    await q('document.querySelector(".welcome-go")?.click()');
    await q('document.querySelector("button[aria-label=Settings]").click()');
    await until('!!document.querySelector(".settings select")');
    for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
      await set('.settings select', provider);
      await until(`document.querySelector('button[aria-label="AI model"]') && !document.querySelector('.settings-model-picker .spin')`);
      await until(`![...document.querySelectorAll('.settings button')].find(b => b.textContent.trim() === 'Refresh models')?.disabled && document.querySelector('[aria-label="Installed agent status"]')?.textContent.includes('Signed in')`);
      await openPicker();
      const options = await q(`[...document.querySelectorAll('.settings-model-picker [role=option]')].map(b => b.textContent.trim())`);
      const wanted = provider === 'codex-sdk' ? 'gpt-6.1-sol' : 'sonnet';
      assert.ok(options.includes(wanted), `${wanted} appears automatically without loading suggestions`);
      await choose(wanted);
      await click('Test connection');
      await until(`document.querySelector('.settings .result.ok:not([aria-label])')?.textContent.includes('Connected')`, 150000);
      assert.equal(requestedModel, wanted, 'the selected model reaches the actual SDK connection test');
      await save();
      assert.equal((await q('window.api.settingsGet()')).models[provider], wanted);
      await openPicker();
      assert.ok(await q(`document.querySelectorAll('.settings-model-picker [role=option]').length > 3`), 'Save retains the loaded catalog');
      await choose(wanted);
      fs.writeFileSync(path.join(dir, `${provider}-picker.png`), (await win.capturePage()).toPNG());
      await q(`document.querySelector('.settings button[aria-label="Close settings"]').click()`);
      if (!await q('!!document.querySelector(".pilot-panel")')) await q('document.querySelector(".pilot-fab").click()');
      await until(`document.querySelector('.pilot-model')?.textContent === ${JSON.stringify(wanted)}`);
      await q('document.querySelector("button[aria-label=Settings]").click()');
      await until(`document.querySelector('button[aria-label="AI model"]')?.textContent.includes(${JSON.stringify(wanted)})`);
      await openPicker();
      await choose('Custom model ID…');
      const custom = `${provider}-custom-test`;
      await set('input[aria-label="Custom model ID"]', custom);
      await save();
      assert.equal((await q('window.api.settingsGet()')).models[provider], custom);
      await openPicker();
      await choose('Default from installed CLI');
      await save();
      assert.equal((await q('window.api.settingsGet()')).models[provider], '');
      result.providers.push({ provider, chosen: wanted, connection: true, persisted: true, craftAiModel: wanted, custom: true, default: true });
    }
    // An unavailable catalog must retain saved/custom choices; a late result
    // from the previous provider must not replace the active provider's list.
    sdk.status = async () => ({ ok: true, installed: true, authenticated: true, version: 'test', executablePath: '/test/agent' });
    sdk.listModels = async (cfg) => {
      await wait(cfg.provider === 'codex-sdk' ? 900 : 10);
      return { ok: true, models: [cfg.provider === 'codex-sdk' ? 'old-codex-result' : 'current-claude-model'] };
    };
    await set('.settings select', 'codex-sdk');
    await wait(400);
    await set('.settings select', 'claude-agent-sdk');
    await wait(1200);
    await openPicker();
    const fresh = await q(`[...document.querySelectorAll('.settings-model-picker [role=option]')].map(b => b.textContent.trim())`);
    assert.ok(fresh.includes('current-claude-model'));
    assert.ok(!fresh.includes('old-codex-result'));
    await choose('Default from installed CLI');
    result.staleCatalogIgnored = true;
    result.ok = result.errors.length === 0;
  } catch (error) { result.ok = false; result.error = error.stack; }
  finally { ai.testConnection = originalTest; sdk.status = originalStatus; sdk.listModels = originalModels; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
