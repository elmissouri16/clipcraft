// Keyboard shortcuts in Settings, in the real app with real key presses: remap,
// conflict move, persistence, the editor obeying the new keys, reset.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const q = s => win.webContents.executeJavaScript(s), wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async s => { for (let i = 0; i < 200; i++) { if (await q(s)) return; await wait(50); } throw Error('Timeout: ' + s); };
  const result = { checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  // Real keyboard input through Chromium (modifiers as Electron accelerator names).
  // The battery runs two app windows at once: reclaim focus so key presses reach this one.
  const press = async (keyCode, modifiers = []) => { win.focus(); win.webContents.focus(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await wait(120); };
  const settingsFile = path.join(dir, 'settings-test', 'settings.json');
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    win.setContentSize(1400, 900); win.show(); win.focus(); win.webContents.focus();
    const image = path.join(dir, 'source.png');
    fs.writeFileSync(image, require('electron').nativeImage.createFromBitmap(Buffer.from([74, 84, 120, 255]), { width: 1, height: 1 }).resize({ width: 160, height: 90 }).toPNG());
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")'); await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load({id:'keys',name:'Keys',ratio:'16:9',width:1280,height:720,fps:30,media:[{id:'m',type:'image',path:${JSON.stringify(image)},poster:${JSON.stringify(image)},name:'Still',width:160,height:90}],videoClips:[{id:'v',mediaId:'m',in:0,out:6,speed:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]})`);
    check('the inspector no longer carries a shortcuts list', await q('!document.querySelector(".inspector .shortcuts")&&!document.querySelector(".inspector").textContent.includes("Keyboard shortcuts")'));

    // Settings > Keyboard shortcuts.
    await q('document.querySelector("button[aria-label=Settings]").click()'); await until('!!document.querySelector(".settings2")');
    await q('document.querySelector(".set2-rail button[data-section=shortcuts]").click()');
    await until('!!document.querySelector(".shortcut-settings")');
    check('every action is listed with its keys', await q('document.querySelectorAll(".shortcut-row[data-action]").length>=20&&document.querySelector(".shortcut-row[data-action=split]").textContent.includes("S")'));
    fs.writeFileSync(path.join(dir, 'shortcuts-default.png'), (await win.capturePage()).toPNG());

    // Add K to Split by pressing it, then remove S.
    win.focus(); win.webContents.focus();
    await q('document.querySelector(".shortcut-row[data-action=split] .shortcut-add").click()');
    check('the add button records keys', await q('document.querySelector(".shortcut-row[data-action=split] .shortcut-add").classList.contains("recording")&&document.activeElement===document.querySelector(".shortcut-row[data-action=split] .shortcut-add")'));
    // A bare modifier keeps waiting (keyDown + keyUp with no modifier state left behind).
    win.focus(); win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift', modifiers: ['shift'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift', modifiers: [] }); await wait(120);
    check('a bare modifier keeps recording', await q('!!document.querySelector(".shortcut-add.recording")'));
    await press('K');
    await until('[...document.querySelectorAll(".shortcut-row[data-action=split] kbd")].some(k=>k.textContent==="K")');
    result.splitAfterK = await q('[...document.querySelectorAll(".shortcut-row[data-action=split] .shortcut-combo")].map(c=>c.textContent)');
    await q('document.querySelector("button[aria-label=\'Remove S from Split at playhead\']").click()'); await wait(200);
    // Ctrl shows as ⌘ on macOS, where Cmd works as Ctrl.
    check('Split now uses K and Ctrl+B', await q('(()=>{const c=[...document.querySelectorAll(".shortcut-row[data-action=split] .shortcut-combo")].map(e=>e.textContent);return c.length===2&&c.includes("K")&&c.some(x=>x==="CtrlB"||x==="⌘B")})()'));
    // Escape while recording cancels without closing Settings.
    await q('document.querySelector(".shortcut-row[data-action=marker] .shortcut-add").click()'); await press('Escape');
    check('Escape cancels recording and keeps Settings open', await q('!!document.querySelector(".settings2")&&!document.querySelector(".shortcut-add.recording")'));
    // Taking a key from another action moves it and says so.
    await q('document.querySelector(".shortcut-row[data-action=marker] .shortcut-add").click()'); await press('D', ['control']);
    await until('document.querySelector(".shortcut-notice").textContent.includes("moved")');
    check('assigning Ctrl+D to Marker moves it from Duplicate', await q('document.querySelector(".shortcut-notice").textContent.includes("Duplicate")&&document.querySelector(".shortcut-row[data-action=duplicate]").textContent.includes("Not set")'));
    fs.writeFileSync(path.join(dir, 'shortcuts-remapped.png'), (await win.capturePage()).toPNG());
    const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).shortcuts;
    result.stored = stored;
    check('only the changes are saved to settings.json', JSON.stringify(stored.split) === JSON.stringify(['Ctrl+B', 'K']) && JSON.stringify(stored.duplicate) === '[]' && stored.marker.includes('Ctrl+D') && !('togglePlay' in stored));
    await q('document.querySelector("button[aria-label=\'Close settings\']").click()'); await wait(200);

    // The editor obeys the new keys.
    await q('window.__fve.seek(2)'); await q('document.activeElement?.blur()'); await wait(150);
    await press('S');
    check('the old key no longer splits', await q('window.__fve.rawProject().videoClips.length===1'));
    await press('K');
    await until('window.__fve.rawProject().videoClips.length===2');
    check('the new key splits at the playhead', true);
    const markers = await q('(window.__fve.rawProject().markers||[]).length');
    await press('D', ['control']);
    check('Ctrl+D now adds a marker instead of duplicating', await q(`(window.__fve.rawProject().markers||[]).length===${markers + 1}&&window.__fve.rawProject().videoClips.length===2`));
    await press('Space');
    await until('document.querySelector(".play-btn").getAttribute("aria-label").startsWith("Pause")');
    check('untouched defaults still work (Space plays)', true);
    await press('Space');
    check('tooltips name the current keys', await q('document.querySelector(".play-btn").getAttribute("aria-label")==="Play (Space)"&&!!document.querySelector(\'.tl-toolbar [aria-label="Split at playhead (K)"], .tl-toolbar [aria-label^="Split at playhead ("][aria-label*="K"]\')'));

    // Reset all restores the defaults (and removes the stored overrides).
    await q('document.querySelector("button[aria-label=Settings]").click()'); await until('!!document.querySelector(".settings2")');
    await q('document.querySelector(".set2-rail button[data-section=shortcuts]").click()');
    await until('!!document.querySelector(".shortcut-settings")');
    await q('[...document.querySelectorAll(".shortcut-settings .settings-actions button")].find(b=>b.textContent.includes("Reset all")).click()'); await wait(300);
    check('reset all restores defaults in settings.json', JSON.stringify(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).shortcuts) === '{}');
    await q('document.querySelector("button[aria-label=\'Close settings\']").click()'); await wait(200);
    await q('window.__fve.seek(4)'); await q('document.activeElement?.blur()'); await wait(150); // away from the 2 s cut
    await press('S');
    check('the default S splits again', await q('window.__fve.rawProject().videoClips.length===3'));
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
