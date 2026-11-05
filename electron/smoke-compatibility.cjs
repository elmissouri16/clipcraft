// Focused real-app checks. Run with FVE_SMOKE=<temp dir> FVE_SMOKE_MODE=compatibility.
// Dialogs and profiles are isolated; no user files, keys or installers are touched.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { dialog } = require('electron');

module.exports = async (win, app, dir) => {
  const result = { checks: [] };
  const q = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (js) => {
    for (let n = 0; n < 100; n++) {
      if (await q(js)) return;
      await wait(100);
    }
    throw new Error(`Timed out: ${js}`);
  };
  const originalDialog = dialog.showOpenDialog;
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await q('window.__alerts = []; void (window.alert = (text) => window.__alerts.push(text))');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await wait(300);
    await q('document.querySelector(".welcome-go")?.click()');
    await q('window.__fve.dispatch({ type: "setProject", patch: { name: "Keep this edit" } })');
    await until('window.__fve.exportData().project.name === "Keep this edit"');

    const fixture = path.join(dir, 'invalid-project.json');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    for (const project of [{ videoClips: null }, { media: {} }, { textClips: [null] }]) {
      fs.writeFileSync(fixture, JSON.stringify(project));
      await q('window.__alerts = []; document.querySelector("button[aria-label=Open]").click()');
      await until('window.__alerts.length > 0');
      assert.match(await q('window.__alerts[0]'), /Invalid project/);
      assert.equal(await q('window.__fve.exportData().project.name'), 'Keep this edit');
      assert.equal(await q('!!document.querySelector(".timeline")'), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(fixture, 'utf8')), project);
    }
    result.checks.push('invalid files show an error, retain edits and leave source files intact');

    // Direct dispatch is also safe, and Undo still reaches the previous valid edit.
    await q('window.__fve.load({ videoClips: null })');
    await wait(200);
    assert.equal(await q('window.__fve.exportData().project.name'), 'Keep this edit');
    await q('window.__fve.dispatch({ type: "undo" })');
    await until('window.__fve.exportData().project.name === "Untitled"');
    result.checks.push('invalid direct loads preserve the undo history');

    fs.writeFileSync(fixture, JSON.stringify({ name: 'Legacy project', media: [], videoClips: [] }));
    await q('document.querySelector("button[aria-label=Open]").click()');
    await until('document.querySelector(".project-name")?.value === "Legacy project"');
    assert.equal(await q('window.__fve.exportData().project.fps'), 30);
    result.checks.push('legacy project opens with compatible defaults');

    // Persist from the actual Settings dialog, then inject a failed atomic rename
    // in the main process and confirm that the UI reports failure without data loss.
    await q('document.querySelector("button[aria-label=Settings]").click()');
    await until('!!document.querySelector(".settings select")');
    await q(`(() => {
      const select = document.querySelector('.settings select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'ollama');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait(100);
    await q(`[...document.querySelectorAll('.settings button')].find(b => b.textContent.trim() === 'Save').click()`);
    await until('document.querySelector(".settings .result.ok")?.textContent.includes("Saved")');
    const settingsFile = path.join(dir, 'settings-test', 'settings.json');
    const savedSettings = fs.readFileSync(settingsFile, 'utf8');
    assert.equal(JSON.parse(savedSettings).ai.provider, 'ollama');
    const originalRename = fs.renameSync;
    try {
      fs.renameSync = (from, to) => {
        if (to === settingsFile) throw new Error('Simulated settings rename failure');
        return originalRename(from, to);
      };
      await q(`[...document.querySelectorAll('.settings button')].find(b => b.textContent.trim() === 'Save').click()`);
      await until('document.querySelector(".settings .result.bad")?.textContent.includes("Simulated settings rename failure")');
      assert.equal(fs.readFileSync(settingsFile, 'utf8'), savedSettings);
      assert.equal(fs.readdirSync(path.dirname(settingsFile)).some(n => n.endsWith('.part')), false);
    } finally { fs.renameSync = originalRename; }
    result.checks.push('Settings saves through IPC; failed atomic writes surface in the UI and retain the previous file');

    await q(`document.querySelector('.settings button[aria-label="Close settings"]').click()`);
    const updates = require('./updates.cjs');
    const { net } = require('electron');
    const { Writable } = require('node:stream');
    const downloads = path.join(dir, 'downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const existing = path.join(downloads, 'ClipCraft-test.dmg');
    fs.writeFileSync(existing, 'keep the existing installer');
    const payload = Buffer.from('test installer bytes; never executed');
    const originalCheck = updates.check;
    const originalFetch = net.fetch;
    const originalGetPath = app.getPath;
    const originalStream = fs.createWriteStream;
    try {
      app.getPath = (key) => key === 'downloads' ? downloads : originalGetPath.call(app, key);
      updates.check = () => originalCheck(async () => ({ ok: true, json: async () => ({
        version: '99.0.0', download_url: 'https://hamzaabika.com/ClipCraft-test.dmg',
      }) }));
      net.fetch = async () => ({ ok: true, body: (async function* () { yield payload; })() });
      fs.createWriteStream = (file, ...args) => String(file).startsWith(downloads)
        ? new Writable({ write(_chunk, _enc, done) { done(new Error('Simulated disk full')); } })
        : originalStream(file, ...args);
      await q('document.querySelector(".about-btn").click()');
      await q(`[...document.querySelectorAll('.about button')].find(b => b.textContent.includes('Check for updates')).click()`);
      await until('!!document.querySelector(".about-update")');
      await q(`[...document.querySelectorAll('.about button')].find(b => b.textContent.includes('Download & install')).click()`);
      await until('!!document.querySelector(".about-status.error")');
      assert.equal(fs.readFileSync(existing, 'utf8'), 'keep the existing installer');
      assert.equal(updates.lastDownload(), '');
      fs.createWriteStream = originalStream;
      await q(`[...document.querySelectorAll('.about button')].find(b => b.textContent.includes('Try again')).click()`);
      await until('document.querySelector(".about-status.ok")?.textContent.includes("Downloaded")');
      const installedPath = updates.lastDownload();
      assert.equal(path.basename(installedPath), 'ClipCraft-test (1).dmg');
      assert.equal(fs.readFileSync(installedPath).equals(payload), true);
      assert.equal(fs.readFileSync(existing, 'utf8'), 'keep the existing installer');
      assert.equal(fs.readdirSync(downloads).some(n => n.startsWith('.clipcraft-update-')), false);
      assert.match(await q('document.querySelector(".about-status.ok").textContent'), /ClipCraft-test \(1\)\.dmg/);
    } finally {
      updates.check = originalCheck;
      net.fetch = originalFetch;
      app.getPath = originalGetPath;
      fs.createWriteStream = originalStream;
    }
    result.checks.push('About reports disk errors, retries successfully and preserves existing installers');
    fs.writeFileSync(path.join(dir, 'compatibility.png'), (await win.capturePage()).toPNG());
    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = err.stack;
  } finally {
    dialog.showOpenDialog = originalDialog;
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    app.exit(result.ok ? 0 : 1);
  }
};
