// Settings > AI assistant > Web research in the real app (FVE_SMOKE_MODE=web-research): Codex shows
// on and Claude off by default; real clicks switch each one, Save stores it per agent, the choice
// reloads with the dialog, and the main process hands it to the native agent run.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

module.exports = async (win, app, dir) => {
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (s, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(s)) return; await wait(60); } throw Error('Timeout: ' + s); };
  const result = { checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  const settings = require('../../electron/system/settings.cjs');
  // A real mouse click in the middle of an element.
  const clickAt = async (selector) => {
    const r = await q(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    for (const type of ['mouseDown', 'mouseUp']) { win.webContents.sendInputEvent({ type, x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 }); await wait(40); }
  };
  const pick = (provider) => q(`(()=>{const s=document.querySelector('select[aria-label="Provider"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(provider)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const switchOn = () => q('document.querySelector(\'input[aria-label="Web research"]\')?.checked');
  const openSettings = async () => { await q('document.querySelector(".topbar button[aria-label=Settings]").click()'); await until('!!document.querySelector(\'select[aria-label="Provider"]\')'); };
  const saveAndWait = async () => { await q('[...document.querySelectorAll(".set2-pane button")].find(b=>b.textContent.trim()==="Save").click()'); await until('[...document.querySelectorAll(".set2-pane *")].some(e=>e.textContent.trim()==="Saved.")'); };
  try {
    settings.setFirstRun({ tourSeen: true, packPromptSeen: true });
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    await openSettings();
    await pick('gemini'); await wait(150);
    check('API providers show no web research switch', !(await q('!!document.querySelector(\'input[aria-label="Web research"]\')')));

    await pick('codex-sdk'); await until('!!document.querySelector(\'input[aria-label="Web research"]\')');
    check('Codex shows web research on by default', await switchOn());
    await pick('claude-agent-sdk'); await until('!!document.querySelector(\'input[aria-label="Web research"]\')');
    check('Claude shows web research off by default', !(await switchOn()));
    check('the switch explains what Claude may do', await q('document.querySelector(".set2-switch-row").textContent.includes("search the web and read pages")'));
    await q('document.querySelector(".set2-switch-row").scrollIntoView({block:"center"})'); await wait(500);
    fs.writeFileSync(path.join(dir, 'settings-web-research.png'), (await win.capturePage()).toPNG());

    await clickAt('input[aria-label="Web research"]');
    check('a real click switches Claude on', await switchOn());
    await wait(400); fs.writeFileSync(path.join(dir, 'settings-web-research-on.png'), (await win.capturePage()).toPNG());
    await saveAndWait();
    check('Save stores it for Claude', settings.getActive('claude-agent-sdk').webResearch === true && settings.getActive('codex-sdk').webResearch === true);

    await pick('codex-sdk'); await until('!!document.querySelector(\'input[aria-label="Web research"]\')');
    await clickAt('input[aria-label="Web research"]');
    check('a real click switches Codex off', !(await switchOn()));
    await saveAndWait();
    check('Save stores it for Codex without touching Claude', settings.getActive('codex-sdk').webResearch === false && settings.getActive('claude-agent-sdk').webResearch === true);

    // Reopen: each agent shows its own saved choice.
    await q('document.querySelector(\'button[aria-label="Close settings"]\').click()'); await until('!document.querySelector(\'select[aria-label="Provider"]\')');
    await openSettings();
    await pick('claude-agent-sdk'); await until('!!document.querySelector(\'input[aria-label="Web research"]\')');
    const claudeShown = await switchOn();
    await pick('codex-sdk'); await until('!!document.querySelector(\'input[aria-label="Web research"]\')');
    const codexShown = await switchOn();
    check('reopened Settings show each agent’s saved choice', claudeShown === true && codexShown === false);

    // What the native run is given (main builds it from settings.getActive) and what it does with it.
    const research = require('../../electron/agents/research.cjs');
    const claudeCfg = settings.getActive('claude-agent-sdk'), codexCfg = settings.getActive('codex-sdk');
    check('the native agents receive the saved choice', research.enabled(claudeCfg) && !research.enabled(codexCfg)
      && /WebSearch and WebFetch tools are enabled/.test(research.researchInstructions(claudeCfg)) && /Web research is off/.test(research.researchInstructions(codexCfg)));
    result.public = (await q('window.api.settingsGet()')).webResearch;
    check('the renderer sees both choices', result.public['claude-agent-sdk'] === true && result.public['codex-sdk'] === false);
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
