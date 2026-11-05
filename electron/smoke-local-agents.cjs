// Opt-in live checks using the user's installed/logged-in CLIs. Isolated project
// and settings profile; only small connection/edit prompts are sent to providers.
// FVE_SMOKE=<temp dir> FVE_SMOKE_MODE=local-agents electron .
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async (win, app, dir) => {
  const result = { providers: [], errors: [] };
  const q = (js) => { new (require('node:vm').Script)(js); return win.webContents.executeJavaScript(js); };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js, timeoutMs = 150000) => {
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += 100) {
      if (await q(js)) return;
      await wait(100);
    }
    throw new Error(`Timed out: ${js}`);
  };
  const clickText = (selector, text) => q(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const value = (selector, text) => q(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  win.webContents.on('console-message', (_event, level, text) => { if (level >= 3) result.errors.push(text); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")', 20000);
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")', 20000);
    await wait(300);
    await q('document.querySelector(".welcome-go")?.click()');
    for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
      const evidence = { provider };
      await q('document.querySelector("button[aria-label=Settings]").click()');
      await until('!!document.querySelector(".settings select")', 10000);
      await value('.settings select', provider);
      const statusElement = `document.querySelector('[aria-label="Installed agent status"]')`;
      await until(`${statusElement}?.textContent.includes("Signed in")`, 30000);
      evidence.detected = await q(`${statusElement}.textContent`);
      assert.equal(await q('document.querySelectorAll(".settings input[type=password]").length'), 0, 'SDK does not ask for an API key');
      await clickText('.settings button', 'Load models');
      await until('!!document.querySelector(".settings .result.ok:not([aria-label])") || !!document.querySelector(".settings .result.bad:not([aria-label])")', 30000);
      evidence.models = await q('document.querySelector(".settings .result:not([aria-label])").textContent');
      assert.equal(await q('!!document.querySelector(".settings .result.bad:not([aria-label])")'), false, 'model listing succeeds');
      // A blank draft must use the CLI default even if a model override had
      // previously been saved. This also exercises the Settings test IPC path.
      await q(`window.api.settingsSave({ provider: ${JSON.stringify(provider)}, model: 'clipcraft-invalid-test-model' })`);
      await clickText('.settings button', 'Test connection');
      await until('document.querySelector(".settings .result.ok:not([aria-label])")?.textContent.includes("Connected")', 150000);
      evidence.connection = await q('document.querySelector(".settings .result.ok:not([aria-label])").textContent');
      await clickText('.settings button', 'Save');
      await until('document.querySelector(".settings .result.ok:not([aria-label])")?.textContent.includes("Saved")', 10000);
      const saved = await q('window.api.settingsGet()');
      assert.equal(saved.provider, provider);
      assert.equal(saved.models[provider], '', 'blank model retains the installed default');
      assert.equal(saved.keys[provider], undefined);
      await q(`document.querySelector('.settings button[aria-label="Close settings"]').click()`);
      if (!await q('!!document.querySelector(".pilot-panel")')) await q('document.querySelector(".pilot-fab").click()');
      await until('!!document.querySelector(".pilot-input textarea:not(:disabled)")', 30000);
      if (await q(`!document.querySelector('button[aria-label="New chat"]').disabled`)) await q(`document.querySelector('button[aria-label="New chat"]').click()`);
      const before = await q('window.__fve.exportData().project.name');
      const target = provider === 'codex-sdk' ? 'Codex SDK Verified' : 'Claude SDK Verified';
      await value('.pilot-input textarea', `Rename this project to "${target}" using set_project. Do not change anything else. Then confirm briefly.`);
      await q('document.querySelector(".pilot-input button[aria-label=Send]").click()');
      await until('!!document.querySelector(".pilot-msg.assistant .bubble") && !document.querySelector(".send.stop")', 150000);
      evidence.reply = await q('document.querySelector(".pilot-msg.assistant .bubble").textContent');
      evidence.steps = await q('[...document.querySelectorAll(".pilot-steps li")].map(el => el.textContent)');
      assert.equal(await q('window.__fve.exportData().project.name'), target, 'real SDK applies editor tool request');
      await q('document.querySelector(".pilot-undo").click()');
      await until(`window.__fve.exportData().project.name === ${JSON.stringify(before)}`, 10000);
      evidence.undo = true;
      fs.writeFileSync(path.join(dir, `${provider}.png`), (await win.capturePage()).toPNG());

      // Stop a pending real SDK query, then use a fresh message in the same chat.
      await value('.pilot-input textarea', 'Think carefully about a detailed video editing plan, but do not change any project settings or clips.');
      await q('document.querySelector(".pilot-input button[aria-label=Send]").click()');
      await until('!!document.querySelector(".send.stop")', 10000);
      await wait(300);
      const started = Date.now();
      await q('document.querySelector("button[aria-label=Stop]").click()');
      await until('!document.querySelector(".send.stop")', 15000);
      evidence.stopMs = Date.now() - started;
      assert.equal(await q('document.querySelector(".pilot-msg.assistant:last-child .bubble").textContent'), 'Stopped.');
      await value('.pilot-input textarea', 'Reply with exactly OK. Do not call tools.');
      await q('document.querySelector(".pilot-input button[aria-label=Send]").click()');
      await until('document.querySelector(".pilot-msg.assistant:last-child .bubble")?.textContent.includes("OK") && !document.querySelector(".send.stop")', 150000);
      evidence.chatAfterStop = true;
      result.providers.push(evidence);
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    }
    result.ok = result.errors.length === 0;
  } catch (error) { result.ok = false; result.error = error.stack; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
