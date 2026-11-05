// Real renderer/IPC/settings/provider adapters with isolated simulated API
// responses. Separate model-picker smoke covers live installed SDK requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const result = { providers: [], errors: [] };
  const q = (js) => { new (require('node:vm').Script)(js); return win.webContents.executeJavaScript(js); };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js) => {
    for (let i = 0; i < 200; i++) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const choose = (selector, text) => q(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`);
  const settings = require('./settings.cjs');
  const ai = require('./ai.cjs');
  settings.setFirstRun({ tourSeen: true });
  const originalFetch = global.fetch;
  const originalCapabilities = ai.modelCapabilities;
  let ids, requests;
  global.fetch = async (url, options = {}) => {
    const u = String(url), body = options.body ? JSON.parse(options.body) : null;
    const cap = (id) => id === ids[0] ? ['low', 'high'] : id === ids[1] ? ['low'] : [];
    const metadata = (id) => ({ id, name: `models/${id}`, reasoning: { supported_efforts: cap(id) }, supportedThinkingLevels: cap(id),
      capabilities: { effort: { supported: cap(id).length > 0, ...Object.fromEntries(['low', 'medium', 'high', 'xhigh', 'max'].map((level) => [level, { supported: cap(id).includes(level) }])) } } });
    let reply;
    if (u.endsWith('/api/tags')) reply = { models: ids.map((name) => ({ name })) };
    else if (u.endsWith('/api/show')) reply = { thinking: { values: cap(body.model) } };
    else if (!body && /\/models(?:\?|$)/.test(u)) reply = { data: ids.map(metadata), models: ids.map(metadata) };
    else if (!body && u.includes('/models/')) reply = metadata(decodeURIComponent(u.split('/models/')[1]));
    else {
      requests.push({ url: u, body });
      if (u.endsWith('/responses')) reply = { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }] };
      else if (u.includes(':generateContent')) reply = { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] } }] };
      else if (u.endsWith('/v1/messages')) reply = { content: [{ type: 'text', text: 'OK' }] };
      else if (u.endsWith('/api/chat')) reply = { message: { content: 'OK' } };
      else reply = { choices: [{ message: { content: 'OK' } }] };
    }
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  const open = async () => {
    await click('button[aria-label="Choose AI model"]');
    await until(`!!document.querySelector('.pilot-model-menu') && !document.querySelector('.pilot-model-menu .spin') && !document.querySelector('button[aria-label="Thinking effort"]').disabled`);
  };
  const effort = async (label) => {
    await click('button[aria-label="Thinking effort"]');
    await choose('.pilot-effort-control [role=option]', label);
    await until(`document.querySelector('button[aria-label="Thinking effort"]').textContent.trim() === ${JSON.stringify(label)} && !document.querySelector('.pilot-model-custom input').disabled`);
  };
  const level = (provider, body) => provider === 'openai' || provider === 'openrouter' ? body.reasoning?.effort
    : provider === 'gemini' ? body.generationConfig?.thinkingConfig?.thinkingLevel?.toLowerCase()
      : provider === 'claude' ? body.output_config?.effort : provider === 'ollama' ? body.think : body.reasoning_effort;
  win.webContents.on('console-message', (_e, severity, text) => { if (severity >= 3) result.errors.push(text); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    for (const provider of ['openai', 'groq', 'openrouter', 'custom', 'claude', 'gemini', 'ollama']) {
      ids = provider === 'openai' ? ['gpt-6.1-sol', 'gpt-5.4', 'gpt-4o-mini']
        : provider === 'gemini' ? ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-unknown']
          : provider === 'groq' ? ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-unknown']
            : provider === 'claude' ? ['claude-sonnet-5.5', 'claude-haiku-5.5', 'claude-unknown'] : ['model-a', 'model-b', 'unknown-model'];
      requests = [];
      settings.save({ provider, model: ids[0], apiKey: 'isolated-thinking-test', baseUrl: provider === 'custom' ? 'https://custom.test/v1' : '' });
      await q(`window.__fve.load({id:${JSON.stringify(`thinking-${provider}`)},name:'Thinking controls',media:[],videoClips:[],audioClips:[],textClips:[]})`);
      await click('.pilot-fab'); await until('!!document.querySelector(".pilot-panel")');
      await open();
      await click('button[aria-label="Thinking effort"]');
      const labels = await q('[...document.querySelectorAll(".pilot-effort-control [role=option]")].map(el=>el.textContent.trim())');
      assert.deepEqual(labels, ['Default', 'Low', 'High']);
      await choose('.pilot-effort-control [role=option]', 'High');
      await until(`document.querySelector('button[aria-label="Thinking effort"]').textContent.trim()==='High' && !document.querySelector('.pilot-model-custom input').disabled`);
      assert.equal(settings.getActive().reasoningEffort, 'high');
      assert.equal((await q(`window.api.settingsSetReasoningEffort(${JSON.stringify(provider)},${JSON.stringify(ids[0])},'max')`)).ok, false);
      await click('button[aria-label="Choose AI model"]');
      await q(`(() => {const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Reply OK');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until('!document.querySelector("button[aria-label=Send]").disabled');
      await click('button[aria-label=Send]');
      await until('!document.querySelector("button[aria-label=Stop]") && document.querySelector(".pilot-msg.assistant .bubble")?.textContent === "OK"');
      assert.equal(level(provider, requests.at(-1).body), 'high');
      await open(); await choose('.pilot-model-options [role=option]', ids[1]);
      await until('!document.querySelector(".pilot-model-menu")'); await open();
      assert.equal(await q(`document.querySelector('button[aria-label="Thinking effort"]').textContent.trim()`), 'Default');
      await effort('Low');
      await choose('.pilot-model-options [role=option]', ids[0]);
      await until('!document.querySelector(".pilot-model-menu")'); await open();
      assert.equal(await q(`document.querySelector('button[aria-label="Thinking effort"]').textContent.trim()`), 'High');
      await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(path.join(dir, `${provider}.png`), (await win.capturePage()).toPNG());
      await choose('.pilot-model-options [role=option]', ids[2]);
      await until('!document.querySelector(".pilot-model-menu")');
      await click('button[aria-label="Choose AI model"]');
      await until('!document.querySelector(".pilot-effort-control").textContent.includes("Checking allowed")');
      assert.equal(await q(`document.querySelector('button[aria-label="Thinking effort"]').disabled`), true);
      assert.equal(settings.getActive().reasoningEffort, '');
      result.providers.push({ provider, allowedLevels: labels, selectedLevelReachedRequest: true, perModelRestore: true, unsupportedDefaultOnly: true });
    }
    // Clear a saved override even when the capability service is unavailable.
    settings.setModel('ollama', ids[0]);
    ai.modelCapabilities = async () => ({ ok: false, error: 'Capability lookup unavailable' });
    const clear = await q(`window.api.settingsSetReasoningEffort('ollama',${JSON.stringify(ids[0])},'')`);
    assert.equal(clear.ok, true);
    ai.modelCapabilities = originalCapabilities;
    result.offlineReset = true;
    settings.setModel('ollama', ids[0]);
    let release;
    ai.modelCapabilities = () => new Promise((resolve) => { release = resolve; });
    await q(`window.__thinkingSave=window.api.settingsSetReasoningEffort('ollama',${JSON.stringify(ids[0])},'high'); true`);
    for (let i = 0; !release && i < 100; i++) await wait(50);
    assert.ok(release);
    settings.setModel('ollama', ids[1]);
    release({ ok: true, reasoningEfforts: ['low', 'high'] });
    assert.equal((await q('window.__thinkingSave')).ok, false);
    assert.equal(settings.getActive().reasoningEffort, 'low');
    result.staleModelSaveRejected = true;
    ai.modelCapabilities = originalCapabilities;
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.ok = false; result.error = error.stack;
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG());
  } finally { global.fetch = originalFetch; ai.modelCapabilities = originalCapabilities; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
