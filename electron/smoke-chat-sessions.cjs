// Two real Electron launches share an isolated smoke directory. The deterministic
// provider checks saved context through real IPC and the actual editor tool loop.
// FVE_SMOKE=<dir> FVE_SMOKE_MODE=chat-sessions [FVE_CHAT_STAGE=reopen] electron .
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { dialog, ipcMain } = require('electron');

module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const stage = process.env.FVE_CHAT_STAGE || 'prepare';
  const result = { stage, errors: [] };
  const projectFile = path.join(dir, 'sessions.clipcraft.json');
  const metaFile = path.join(dir, 'sessions-meta.json');
  const ai = require('./ai.cjs');
  const settings = require('./settings.cjs');
  settings.save({ provider: 'ollama' });
  settings.setFirstRun({ tourSeen: true });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: projectFile });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectFile] });
  const q = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js) => {
    for (let i = 0; i < 200; i++) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const draft = (text) => q(`(() => {
    const el = document.querySelector('.pilot-input textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const openChat = async () => {
    if (!await q('!!document.querySelector(".pilot-panel")')) await click('.pilot-fab');
    await until('!!document.querySelector(".pilot-input textarea")');
  };
  const send = async (text) => {
    await draft(text);
    await until('!document.querySelector("button[aria-label=Send]").disabled');
    await click('button[aria-label=Send]');
    await until('!document.querySelector("button[aria-label=Stop]") && !!document.querySelector(".pilot-msg.assistant:last-child .bubble")');
  };
  const home = async () => { await click('button[aria-label=Projects]'); await until('!!document.querySelector(".home-frame-card")'); };
  const fresh = async () => {
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()'); await openChat();
  };
  const openFile = async () => {
    await q(`[...document.querySelectorAll('.home-action')].find(b => b.textContent.includes('Open project')).click()`);
    await until('!!document.querySelector(".topbar")'); await openChat();
  };
  const chooseSession = async (id) => {
    await click('button[aria-label="Chat sessions"]');
    await q(`[...document.querySelectorAll('.pilot-session-picker [role=option]')].find(b => b.getAttribute('aria-selected') === 'false' && b.textContent.includes('Remember violet')).click()`);
    await until(`window.__fve.exportData().project.craftAI.activeSessionId === ${JSON.stringify(id)}`);
  };
  let releasePending;
  const requests = [];
  ai.agentStep = async (_cfg, req) => {
    requests.push(structuredClone({ contents: req.contents }));
    const last = req.contents.at(-1);
    const text = last.parts.find((p) => p.text)?.text || '';
    if (text === 'Leave this request pending') return new Promise((resolve) => {
      releasePending = () => resolve({ calls: [{ name: 'set_project', args: { name: 'WRONG PROJECT' } }],
        content: { role: 'model', parts: [{ functionCall: { name: 'set_project', args: { name: 'WRONG PROJECT' } } }] } });
    });
    if (text.startsWith('Remember violet')) {
      const calls = [{ name: 'get_project', args: {} }, { name: 'set_project', args: { name: 'Session Project' } }];
      return { calls, text: '', content: { role: 'model', parts: calls.map((c) => ({ functionCall: c })) } };
    }
    if (text === 'Continue the first conversation') {
      assert.ok(req.contents.some((t) => t.parts.some((p) => p.text?.startsWith('Remember violet'))));
      assert.ok(req.contents.some((t) => t.parts.some((p) => p.functionResponse?.name === 'get_project')));
      assert.ok(!req.contents.some((t) => t.parts.some((p) => p.text === 'Second session')));
      assert.ok(!req.contents.some((t) => t.parts.some((p) => p.text === 'Leave this request pending')));
      result.restoredModelContext = true;
    }
    const reply = text === 'Continue the first conversation' ? 'Violet remembered.' : 'Saved reply.';
    return { calls: [], text: reply, content: { role: 'model', parts: [{ text: reply }] } };
  };
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    if (stage === 'prepare') {
      await fresh();
      await send('Remember violet and rename this project.');
      const firstId = await q('window.__fve.exportData().project.craftAI.activeSessionId');
      await click('.pilot-undo');
      await until('window.__fve.exportData().project.name === "Untitled"');
      assert.equal(await q('document.querySelectorAll(".pilot-msg").length'), 2);
      await q('window.__fve.dispatch({type:"redo"})');
      await until('window.__fve.exportData().project.name === "Session Project"');
      result.undoKeepsChat = true;
      await click('button[aria-label="New chat"]');
      await send('Second session');
      await chooseSession(firstId);
      await draft('Keep this first-session draft');
      await click('button[aria-label=Save]');
      await until('document.querySelector(".save-state")?.textContent.includes("Saved") || document.querySelector(".save-status")?.textContent.includes("Saved")');
      const saved = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      assert.equal(saved.craftAI.sessions.length, 2);
      assert.equal(saved.craftAI.activeSessionId, firstId);
      result.projectFileSaved = true;
      await home();
      await openFile();
      assert.equal(await q('document.querySelector(".pilot-input textarea").value'), 'Keep this first-session draft');
      result.homeRestoredDraft = true;
      // Reopen the same id while mounted: disk, rather than stale local chat, wins.
      await draft('Temporary in-memory draft');
      await click('button[aria-label=Open]');
      await until('!document.querySelector(".pilot-panel")');
      await openChat();
      await until('document.querySelector(".pilot-input textarea")?.value === "Keep this first-session draft"');
      result.sameIdReopen = true;
      await home(); await fresh();
      assert.equal(await q('document.querySelectorAll(".pilot-msg").length'), 0);
      await send('Unsaved project session');
      await draft('Unsaved draft');
      const unsavedId = await q('window.__fve.exportData().project.id');
      await home();
      assert.ok((await q('window.api.slotList()')).some((s) => s.id === unsavedId));
      result.chatOnlyAutosave = true;
      // A late provider/tool result from a project being left must not edit the next.
      await openFile();
      await draft('Leave this request pending');
      await click('button[aria-label=Send]');
      await until('!!document.querySelector("button[aria-label=Stop]")');
      while (!releasePending) await wait(50);
      await home(); await fresh();
      releasePending(); await wait(300);
      assert.equal(await q('window.__fve.exportData().project.name'), 'Untitled');
      assert.equal(await q('document.querySelectorAll(".pilot-msg").length'), 0);
      result.lateResultIsolated = true;
      // Exercise the real renderer close callback before the autosave debounce.
      await home(); await openFile();
      await draft('Saved immediately at close');
      let closeCalled = false;
      ipcMain.removeHandler('app:closeNow');
      ipcMain.handle('app:closeNow', () => { closeCalled = true; return true; });
      win.webContents.send('app:closeRequest');
      for (let i = 0; !closeCalled && i < 100; i++) await wait(50);
      assert.equal(closeCalled, true);
      const closingFile = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      const closingSlot = await q(`window.api.slotRead(${JSON.stringify(closingFile.id)})`);
      for (const p of [closingFile, closingSlot.project]) {
        assert.equal(p.craftAI.sessions.find((s) => s.id === firstId).draft, 'Saved immediately at close');
      }
      result.closeFlushesLatestChat = true;
      fs.writeFileSync(metaFile, JSON.stringify({ firstId, unsavedId }));
    } else {
      const { firstId, unsavedId } = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      await openFile();
      assert.equal(await q('window.__fve.exportData().project.craftAI.activeSessionId'), firstId);
      assert.ok(await q('document.querySelector(".pilot-list").textContent.includes("Interrupted.")'));
      assert.equal(await q('document.querySelectorAll(".pilot-undo").length'), 0);
      await send('Continue the first conversation');
      assert.equal(result.restoredModelContext, true);
      result.restartRestoredSessions = true;
      await click('button[aria-label="Chat sessions"]');
      const options = await q('[...document.querySelectorAll(".pilot-session-picker [role=option]")].map(b => b.textContent)');
      assert.equal(options.length, 2);
      await q(`[...document.querySelectorAll('.pilot-session-picker [role=option]')].find(b => b.textContent === 'Second session').click()`);
      assert.equal(await q('document.querySelectorAll(".pilot-msg").length'), 2);
      result.archivedSessionRestored = true;
      await home();
      const slot = await q(`window.api.slotRead(${JSON.stringify(unsavedId)})`);
      assert.equal(slot.project.craftAI.sessions[0].draft, 'Unsaved draft');
      // Open the actual Home autosave card for the chat-only project.
      await q(`[...document.querySelectorAll('.home-card, .home-continue')].find(b => b.textContent.includes('Untitled')).click()`);
      await until(`!!document.querySelector('.topbar') && window.__fve.exportData().project.id === ${JSON.stringify(unsavedId)}`);
      await openChat();
      assert.equal(await q('document.querySelector(".pilot-input textarea").value'), 'Unsaved draft');
      result.unsavedRestartRestored = true;
      await q('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      fs.writeFileSync(path.join(dir, 'sessions.png'), (await win.capturePage()).toPNG());
    }
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.ok = false; result.error = error.stack;
    fs.writeFileSync(path.join(dir, `${stage}-failure.png`), (await win.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(dir, `${stage}-result.json`), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
