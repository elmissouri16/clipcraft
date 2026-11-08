// Agent evaluation run (FVE_SMOKE_MODE=agent-eval), launched by scripts/agent-eval.cjs.
// Real UI, real provider, real tools: imports the case footage, sends the brief
// through the CraftAI composer, approves proposed plans, then scores the final
// project with the editorial critique, a fresh verbatim transcript and loudness.
const fs = require('node:fs'), path = require('node:path');

module.exports = async (win, app, dir) => {
  const q = code => win.webContents.executeJavaScript(code), wait = ms => new Promise(r => setTimeout(r, ms));
  const testCase = JSON.parse(fs.readFileSync(process.env.FVE_EVAL_CASE, 'utf8'));
  const result = { id: testCase.id, brief: testCase.brief, started: new Date().toISOString(), errors: [], approvals: 0 };
  const shot = async name => fs.writeFileSync(path.join(dir, `${name}.png`), (await win.capturePage()).toPNG());
  const until = async (code, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(code)) return; await wait(250); } throw Error(`Timeout: ${label}`); };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(String(message).slice(0, 500)); });
  const started = Date.now();
  try {
    const settings = require('../../electron/system/settings.cjs');
    if (testCase.provider) settings.save({ provider: testCase.provider, ...(testCase.model ? { model: testCase.model } : {}) });
    result.provider = settings.getPublic().provider; result.model = settings.getPublic().models?.[result.provider];
    win.setContentSize(1600, 1000); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")', 30000, 'home');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")', 30000, 'editor');
    await q('document.querySelector(".welcome-go")?.click()');
    // Import the footage like a drop, then lay it out in order.
    const items = await q(`window.api.probePaths(${JSON.stringify(testCase.media)})`);
    const failed = items.filter(i => i.error);
    if (failed.length) throw Error(`Could not import: ${failed.map(f => `${f.name}: ${f.error}`).join('; ')}`);
    await q(`(()=>{const items=${JSON.stringify(items)}.map((m,i)=>({...m,id:'eval-m'+i}));window.__fve.dispatch({type:'addMedia',items});
      items.forEach((m,i)=>window.__fve.dispatch({type:'addToTimeline',mediaId:m.id,clipId:'eval-c'+i,...(m.type==='audio'?{at:0}:{})}));})()`);
    await wait(500);
    await q('document.querySelector(".workspace-switch button:last-child").click()');
    await until('!!document.querySelector(".pilot-input textarea")', 15000, 'composer');
    const send = async text => {
      await q(`(()=>{const e=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until('!document.querySelector(".pilot-input .send").disabled', 15000, 'send enabled');
      await q('document.querySelector(".pilot-input .send").click()');
      await until('!!document.querySelector(".pilot-run-status")', 30000, 'request start');
      await until('!document.querySelector(".pilot-run-status")', (testCase.timeout_sec || 900) * 1000, 'request finish');
      await wait(500);
    };
    await send(testCase.brief);
    for (const followUp of testCase.follow_ups || []) await send(followUp);
    // Approve plans the agent proposes (bounded), as a user would.
    while (testCase.approve_plan !== false && result.approvals < 3 && await q('!!document.querySelector(".edit-plan .plan-actions .btn-primary")')) {
      result.approvals++;
      await shot(`plan-${result.approvals}`);
      await q('document.querySelector(".edit-plan .plan-actions .btn-primary").click()');
      await until('!!document.querySelector(".pilot-run-status")', 30000, 'approved request start');
      await until('!document.querySelector(".pilot-run-status")', (testCase.timeout_sec || 900) * 1000, 'approved request finish');
      await wait(500);
    }
    result.seconds = Math.round((Date.now() - started) / 1000);
    await shot('final');
    const final = await q('window.__fve.rawProject()');
    fs.writeFileSync(path.join(dir, 'final-project.json'), JSON.stringify(final, null, 1));
    const session = (final.craftAI?.sessions || []).find(s => s.id === final.craftAI.activeSessionId) || final.craftAI?.sessions?.[0] || { messages: [] };
    const replies = session.messages.filter(m => m.role !== 'user');
    const steps = replies.flatMap(m => (m.steps || []).map(s => ({ name: s.name, status: s.status, label: s.label, detail: s.detail })));
    result.replies = replies.map(m => ({ text: String(m.text || '').slice(0, 1200), error: m.error?.error }));
    // Provider-reported token usage per reply (native Codex), summed for the run.
    const usage = replies.map(m => m.tokenUsage).filter(Boolean);
    if (usage.length) result.token_usage = Object.fromEntries(['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'].map(k => [k, usage.reduce((n, u) => n + (u[k] || 0), 0)]));
    // Images actually sent: a contact sheet counts once, otherwise each frame.
    const shots = [];
    for (const turn of session.contents || []) for (const part of turn.parts || []) {
      const r = part.functionResponse?.response?.result; if (!r) continue;
      if (r.sheet_id) shots.push({ tool: part.functionResponse.name, images: 1, frames: (r.frames || []).length });
      else if ((r.frames || []).length) shots.push({ tool: part.functionResponse.name, images: r.frames.length, frames: r.frames.length });
    }
    result.images_sent = { images: shots.reduce((n, x) => n + x.images, 0), frames: shots.reduce((n, x) => n + x.frames, 0), sheets: shots.filter(x => x.frames > 1 && x.images === 1).length };
    // Fresh measurements of the delivered edit; scripts/agent-eval.cjs scores them
    // (Electron's main process cannot load the renderer's ES modules).
    if (testCase.speech_metrics !== false) {
      const res = await q(`window.api.runCaptions(window.__fve.exportData().project,{language:${JSON.stringify(testCase.language || 'auto')},source:'all',maxLen:0,verbatim:true})`);
      if (res?.ok) result.final_segments = res.segments;
      else result.errors.push(`Final transcript: ${res?.error || 'failed'}`);
    }
    const loud = await q('window.api.agentLoudness(window.__fve.exportData().project,{})');
    if (loud?.ok) result.loudness = { integrated_lufs: loud.integrated_lufs, true_peak_db: loud.true_peak_db };
    result.step_list = steps;
  } catch (error) {
    result.error = error.stack || String(error);
    result.seconds = Math.round((Date.now() - started) / 1000);
    try { await shot('failure'); } catch {}
  }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(0);
};
