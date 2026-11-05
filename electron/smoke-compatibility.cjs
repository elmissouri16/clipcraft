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
