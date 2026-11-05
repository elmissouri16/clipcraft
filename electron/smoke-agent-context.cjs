// Opt-in live requests to both installed SDKs: retrieve an archived value,
// discover a tool group and apply a real edit through the UI. Isolated profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const result = { providers: [], errors: [] };
  const q = async (js) => {
    new (require('node:vm').Script)(js);
    try { return await win.webContents.executeJavaScript(js); }
    catch (error) { throw new Error(`${js}\n${error.message}`); }
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js, timeout = 150000) => {
    for (let elapsed = 0; elapsed < timeout; elapsed += 100) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const draft = (text) => q(`(() => {
    const el = document.querySelector('.pilot-input textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const settings = require('./settings.cjs');
  settings.setFirstRun({ tourSeen: true });
  const ai = require('./ai.cjs');
  const original = ai.agentStep;
  let requests = [];
  ai.agentStep = async (cfg, req) => {
    requests.push({ tools: req.tools.map((t) => t.name), schemaChars: JSON.stringify(req.tools).length,
      contextChars: JSON.stringify(req.contents).length });
    return original(cfg, req);
  };
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")', 20000);
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")', 20000);
    await q('document.querySelector(".welcome-go")?.click()');
    for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
      requests = [];
      settings.save({ provider });
      const code = provider === 'codex-sdk' ? 'VIOLET-734' : 'AMBER-826';
      const archived = { fonts: Array.from({ length: 600 }, (_, i) => `Archived font option ${i}`), reference_code: code };
      const history = [
        { role: 'user', parts: [{ text: 'Keep future edits limited to one title. Never export unless I explicitly ask.' }] },
        { role: 'model', parts: [{ functionCall: { name: 'list_options', args: { what: 'fonts' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'list_options', response: { result: archived } } }] },
        { role: 'model', parts: [{ text: 'The prior lookup includes a reference_code for later.' }] },
      ];
      const project = { id: `agent-context-${provider}`, name: `${provider} context verification`, ratio: '16:9', width: 1280, height: 720, fps: 30,
        media: [], videoClips: [], overlayClips: [], audioClips: [], textClips: [],
        craftAI: { version: 1, activeSessionId: 'context-chat', sessions: [{ id: 'context-chat', title: 'Context verification', messages: [], contents: history, draft: '', style: null }] } };
      await q(`window.__fve.load(${JSON.stringify(project)})`);
      await until('!!document.querySelector(".pilot-fab")', 10000);
      await click('.pilot-fab');
      await until('!!document.querySelector(".pilot-panel") && !document.querySelector(".pilot-callout")', 30000);
      await draft('Add exactly one title containing the exact reference_code from the earlier tool lookup. It is in archived output: use recall_context with query reference_code, and load the text tool group to add the title at 0s for 2s. Make no other edits and do not export. Confirm briefly.');
      await until('!document.querySelector("button[aria-label=Send]").disabled', 30000);
      await click('button[aria-label=Send]');
      await until('!document.querySelector("button[aria-label=Stop]") && !!document.querySelector(".pilot-msg.assistant .bubble")', 180000);
      const p = await q('window.__fve.exportData().project');
      assert.equal(p.textClips.length, 1);
      assert.equal(p.textClips[0].text, code, 'the SDK recalls exact archived data before editing');
      const names = await q('[...document.querySelectorAll(".pilot-steps [data-tool-icon]")].map(el=>el.dataset.toolIcon)');
      for (const name of ['load_tools', 'recall_context', 'add_text']) assert.ok(names.includes(name), `${provider}: ${name} icon visible`);
      const paths = await q(`[...document.querySelectorAll('.pilot-steps [data-tool-icon]')].filter(el=>['load_tools','recall_context','add_text'].includes(el.dataset.toolIcon)).map(el=>[el.dataset.toolIcon,el.querySelector('svg').innerHTML])`);
      assert.equal(new Set(paths.map(([name, svg]) => svg)).size, 3);
      assert.ok(requests[0].tools.includes('load_tools') && !requests[0].tools.includes('add_text'));
      assert.ok(requests.some((req) => req.tools.includes('add_text')));
      assert.ok(requests.every((req) => req.schemaChars < 14605));
      assert.ok(requests[0].contextChars < JSON.stringify(history).length / 2);
      assert.ok(await q('document.querySelector(".pilot-context-usage").textContent.includes("estimated input tokens")'));
      const saved = p.craftAI.sessions[0];
      assert.equal(saved.contents[2].parts[0].functionResponse.response.result.reference_code, code, 'full tool output persists');
      assert.ok(saved.messages.at(-1).contextUsage.requests > 0);
      assert.equal(p.videoClips.length, 0);
      await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(path.join(dir, `${provider}.png`), (await win.capturePage()).toPNG());
      // A follow-up can reuse the returned clip id and revision instead of
      // rereading the project. It still loads just the group it needs.
      const previousRequests = requests.length;
      await draft('Change the title you just added to color #ffcc00. Make no other changes. Its clip id is already in the previous tool result; reuse it.');
      await until('!document.querySelector("button[aria-label=Send]").disabled', 10000);
      await click('button[aria-label=Send]');
      await until('!document.querySelector("button[aria-label=Stop]") && window.__fve.exportData().project.textClips[0]?.color === "#ffcc00"', 180000);
      const followup = await q('window.__fve.exportData().project.craftAI.sessions[0].messages.at(-1)');
      assert.ok(!followup.steps.some((step) => step.name === 'get_project'), 'unchanged context does not need a full project read');
      assert.ok(followup.steps.some((step) => step.name === 'edit_text'));
      await q(`document.querySelectorAll('.pilot-undo')[document.querySelectorAll('.pilot-undo').length-1].click()`);
      await until('window.__fve.exportData().project.textClips[0]?.color !== "#ffcc00"', 10000);
      await q(`document.querySelectorAll('.pilot-undo')[document.querySelectorAll('.pilot-undo').length-1].click()`);
      await until('window.__fve.exportData().project.textClips.length === 0', 10000);
      result.providers.push({ provider, recalledCode: code, toolIcons: [...new Set(names)], requests,
        contextUsage: saved.messages.at(-1).contextUsage, followupReusedContext: true, followupRequests: requests.length - previousRequests,
        fullHistoryPreserved: true, undo: true });
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    }
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.ok = false; result.error = error.stack;
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG());
  } finally { ai.agentStep = original; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
