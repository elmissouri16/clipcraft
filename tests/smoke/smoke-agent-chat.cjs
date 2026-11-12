// Deterministic reasoning, real IPC/tools/history, and actual Electron controls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const q = code => win.webContents.executeJavaScript(code), wait = ms => new Promise(r => setTimeout(r, ms));
  const untilFn = async (fn, label) => { for (let i = 0; i < 240; i++) { if (await fn()) return; await wait(50); } throw Error('Timeout: ' + label); };
  const until = code => untilFn(() => q(code), code);
  const result = { checks: [], errors: [] };
  const check = (label, value) => { assert.ok(value, label); result.checks.push(label); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type = (text, selector = '.pilot-input textarea') => q(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const submit = async (text, enter = false) => { await type(text); if (enter) await q(`document.querySelector('.pilot-input textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); else await click('.pilot-input .send'); };
  const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), (await win.capturePage()).toPNG());
  const settings = require('../../electron/system/settings.cjs'), local = require('../../electron/agents/localAgents.cjs');
  const original = { run: local.runEditorNative, status: local.status };
  let active = 0, peak = 0;
  const runs = [];
  const gate = signal => {
    let release; const promise = new Promise((resolve, reject) => {
      release = resolve;
      if (signal.aborted) reject(Error('Stopped'));
      else signal.addEventListener('abort', () => reject(Error('Stopped')), { once: true });
    });
    return { release, promise };
  };
  local.status = async () => ({ ok: true, authenticated: true });
  local.runEditorNative = async (_config, options) => {
    active++; peak = Math.max(peak, active);
    const entry = { text: options.prompt.split('\n')[0], prompt: options.prompt, history: options.history, edit: gate(options.signal), finish: gate(options.signal), stage: 'waiting' };
    // Attach rejection handlers immediately; both gates can be aborted before use.
    entry.edit.promise.catch(() => {}); entry.finish.promise.catch(() => {});
    runs.push(entry);
    const call = async (name, args) => {
      const output = await options.onTool(name, args), data = JSON.parse(output.content[0].text);
      if (data.error) throw Error(data.error); return data;
    };
    try {
      await call('get_project', { scope: 'overview' });
      await entry.edit.promise;
      if (entry.text === 'Fail this request') throw Error('Deliberate provider fixture failure');
      await call('set_project', { name: entry.text }); entry.stage = 'edited';
      await entry.finish.promise;
      await call('complete_edit', {});
      return { text: `Completed **${entry.text}**.\n\nThe project name is updated.` };
    } finally { entry.stage = 'ended'; active--; }
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true }); settings.save({ provider: 'codex-sdk' });
  win.webContents.setBackgroundThrottling(false); win.setContentSize(1400, 900);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  const finish = async index => {
    runs[index].edit.release(); await untilFn(() => runs[index].stage === 'edited', 'request edited ' + index);
    runs[index].finish.release(); await untilFn(() => runs[index].stage === 'ended', 'request ended ' + index);
  };
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await click('.home-frame-card');
    await until('!!document.querySelector(".topbar")'); await q('document.querySelector(".welcome-go")?.click()');
    await click('.workspace-switch button:nth-child(2)');
    await q(`window.__fve.load({id:'chat-queue',name:'Chat queue fixture',ratio:'16:9',width:320,height:180,fps:30,media:[],videoClips:[],audioClips:[],overlayClips:[],textClips:[{id:'title',text:'A selected title',start:0,duration:5}]})`);
    await until('!!document.querySelector(".pilot-input textarea")&&!document.querySelector(".pilot-input textarea").disabled');
    await type('First edit');
    await q(`(()=>{const e=document.querySelector('.pilot-input textarea');for(let i=0;i<2;i++)e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
    await untilFn(() => runs.length === 1, 'first request');
    check('repeated Enter consumes a draft once', await q('!document.querySelector(".pilot-queue")'));
    await until('document.querySelector(".tl-agent-status")?.dataset.phase==="working"');
    check('timeline shows work before a document edit', await q('document.querySelector(".tl-agent-status").textContent.includes("Agent working")'));
    await q('window.__fve.select({track:"text",id:"title"})'); await click('.pilot-attach-selection');
    await until('!!document.querySelector(".pilot-context-chip")');
    await submit('Second edit', true); await submit('Third edit'); await submit('Remove this queued edit');
    await type('Keep my unsent draft');
    await until('document.querySelectorAll(".pilot-queue-item").length===3');
    check('Enter and button queue messages without starting concurrent runs', runs.length === 1 && active === 1);
    check('queued message owns its attachment', await q('(()=>{const s=window.__fve.rawProject().craftAI.sessions[0];return s.queue[0].timelineAttachments.length===1&&!s.timelineAttachments.length&&s.queue[1].timelineAttachments.length===0})()'));
    await click('button[aria-label="Edit queued message 1"]'); await type('Second edit revised', '.pilot-queue-editor textarea');
    await click('.pilot-queue-editor .btn'); await click('button[aria-label="Remove queued message 3"]');
    check('queue edits preserve unsent composer draft', await q('document.querySelector(".pilot-input textarea").value==="Keep my unsent draft"&&document.querySelectorAll(".pilot-queue-item").length===2'));
    await click('.workspace-switch button:nth-child(1)'); await click('.workspace-switch button:nth-child(2)');
    check('queue and running request survive workspace changes', await q('document.querySelectorAll(".pilot-queue-item").length===2&&!!document.querySelector("button[aria-label=Stop]")'));
    runs[0].edit.release(); await untilFn(() => runs[0].stage === 'edited', 'first edit');
    await until('document.querySelector(".tl-agent-status")?.dataset.phase==="editing"');
    await shot('chat-editing-1400');
    runs[0].finish.release(); await until('!document.querySelector("button[aria-label=Stop]")'); await wait(150);
    check('editing a queued message pauses automatic submission', runs.length === 1 && await q('document.querySelector(".pilot-queue-head").textContent.includes("Paused")'));
    await click('.pilot-queue-head button'); await untilFn(() => runs.length === 2, 'second request');
    check('queued attachment refreshes after the preceding edit', /"changed_since_attachment":true/.test(runs[1].prompt));
    check('second request includes completed first-turn context', JSON.stringify(runs[1].history).includes('Completed **First edit**'));
    await finish(1); await untilFn(() => runs.length === 3, 'third request'); await finish(2);
    await until('!document.querySelector("button[aria-label=Stop]")&&!document.querySelector(".tl-agent-status")');
    check('FIFO order and one provider request at a time', JSON.stringify(runs.map(r => r.text)) === JSON.stringify(['First edit', 'Second edit revised', 'Third edit']) && peak === 1);
    check('each queued turn keeps its own Undo checkpoint', await q('window.__fve.history().past.length===3&&window.__fve.rawProject().name==="Third edit"'));
    await click('.pilot-undo'); await wait(100);
    check('Undo reverts only the latest queued turn', await q('window.__fve.rawProject().name==="Second edit revised"'));
    check('completed activity is collapsed in docked chat', await q('[...document.querySelectorAll(".pilot-turn-activity")].every(e=>!e.open)'));
    await submit('Stop current'); await untilFn(() => runs.length === 4, 'stoppable request');
    await submit('After stop'); await click('button[aria-label=Stop]');
    await until('!document.querySelector("button[aria-label=Stop]")'); await wait(150);
    check('Stop pauses remaining messages without submitting them', runs.length === 4 && await q('window.__fve.rawProject().craftAI.sessions[0].queuePaused&&document.querySelectorAll(".pilot-queue-item").length===1'));
    check('timeline indicator clears after Stop', await q('!document.querySelector(".tl-agent-status")'));
    await q('window.__savedQueue=structuredClone(window.__fve.rawProject());window.__fve.load(window.__savedQueue)');
    await until('!!document.querySelector(".pilot-queue")'); await wait(150);
    check('saved queued instructions restore paused', runs.length === 4 && await q('window.__fve.rawProject().craftAI.sessions[0].queuePaused'));
    await click('button[aria-label="New chat"]'); await wait(100);
    check('another chat does not inherit or run the queue', runs.length === 4 && await q('!document.querySelector(".pilot-queue")&&!!document.querySelector(".pilot-welcome")'));
    await click('.pilot-session-picker .dropdown-btn'); await until('!!document.querySelector(".pilot-session-picker [role=option]")');
    await q('[...document.querySelectorAll(".pilot-session-picker [role=option]")].find(e=>e.textContent.includes("queued")).click()');
    await until('!!document.querySelector(".pilot-queue")');
    check('returning to a paused chat retains its queue', await q('document.querySelector(".pilot-queue").textContent.includes("After stop")'));
    await click('.pilot-queue-head button'); await untilFn(() => runs.length === 5, 'resumed request'); await finish(4);
    await until('!document.querySelector("button[aria-label=Stop]")');
    await submit('Fail this request'); await untilFn(() => runs.length === 6, 'failed request'); await submit('After failure');
    runs[5].edit.release(); await until('!document.querySelector("button[aria-label=Stop]")'); await wait(150);
    check('provider failure pauses queued follow-ups', runs.length === 6 && await q('document.querySelector(".pilot-queue-head").textContent.includes("Paused")'));
    await click('button[aria-label="Remove queued message 1"]'); await submit('Manual interruption'); await untilFn(() => runs.length === 7, 'manual interruption');
    await submit('After manual interruption');
    await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual edit wins"}})');
    await until('document.querySelector(".tl-agent-status")?.dataset.phase==="interrupted"');
    runs[6].edit.release(); await until('!document.querySelector("button[aria-label=Stop]")');
    check('manual editing pauses queue and prevents stale writes', runs.length === 7 && await q('window.__fve.rawProject().name==="Manual edit wins"&&window.__fve.rawProject().craftAI.sessions[0].queuePaused'));
    // Stale queued attachments remain editable instead of disappearing or submitting unscoped.
    await q('window.__fve.select({track:"text",id:"title"})'); await click('.pilot-attach-selection'); await submit('Stale attachment');
    await q('window.__fve.dispatch({type:"delete",track:"text",id:"title"})');
    await until('window.__fve.rawProject().textClips.length===0');
    await click('button[aria-label="Remove queued message 1"]'); await click('.pilot-queue-head button');
    await until('!!document.querySelector(".pilot-context-error")');
    check('missing attachments pause the queue and preserve instructions', runs.length === 7 && await q('document.querySelectorAll(".pilot-queue-item").length===1&&document.querySelector(".pilot-context-error").textContent.includes("deleted")'));
    await click('button[aria-label="Remove attachment from queued message 1"]'); await click('.pilot-queue-head button');
    await untilFn(() => runs.length === 8, 'repaired attachment'); await finish(7); await until('!document.querySelector("button[aria-label=Stop]")');
    // Long conversation, queue, Arabic text, tall draft and minimum-size viewport.
    await submit('Layout request'); await untilFn(() => runs.length === 9, 'layout request');
    for (const text of ['Add a clearer ending and a short closing title.', 'اجعل العناوين أوضح وأضف نهاية قصيرة', 'A long message '.repeat(30), 'Fourth queued instruction']) await submit(text);
    await type('A multiline draft\n'.repeat(9));
    await q('(()=>{const e=document.querySelector(".pilot-list");e.scrollTop=0;e.dispatchEvent(new Event("scroll"));})()');
    await until('!!document.querySelector(".pilot-latest button")');
    runs[8].edit.release(); await untilFn(() => runs[8].stage === 'edited', 'activity while reading older messages');
    check('new activity preserves the reader scroll position', await q('document.querySelector(".pilot-list").scrollTop<5'));
    await click('.pilot-latest button');
    for (const [w, h] of [[1400, 900], [1000, 640]]) {
      win.setContentSize(w, h); await wait(200);
      const geometry = await q(`(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,height:b.height}};return {panel:r('.pilot-panel'),input:r('.pilot-input'),list:r('.pilot-list'),queue:r('.pilot-queue-list'),timeline:r('.tl-agent-status'),send:r('.pilot-input .send'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      (result.geometry ||= []).push({ width: w, ...geometry });
      check('composer and timeline fit at ' + w, !geometry.overflow && geometry.input.bottom <= geometry.panel.bottom && geometry.send.right <= geometry.panel.right && geometry.timeline.bottom <= h && geometry.list.height > 75 && geometry.queue.height <= 149);
      check('following the latest message survives resizing at ' + w, await q('(()=>{const e=document.querySelector(".pilot-list");return Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<3})()'));
      await shot('chat-queued-' + w);
    }
    await click('.workspace-switch button:nth-child(1)'); await click('.pilot-fab'); await wait(200); await shot('chat-floating-1000');
    check('floating chat keeps queue composer and Stop accessible', await q('(()=>{const p=document.querySelector(".pilot-panel").getBoundingClientRect(),s=document.querySelector("button[aria-label=Stop]").getBoundingClientRect(),i=document.querySelector(".pilot-input").getBoundingClientRect();return s.y>=p.y&&i.bottom<=p.bottom})()'));
    await click('button[aria-label=Stop]'); await until('!document.querySelector("button[aria-label=Stop]")');
    await type('Preserve this draft while continuing');
    await q('[...document.querySelectorAll(".pilot-error-actions button")].find(e=>e.textContent.includes("Continue from current timeline")).click()');
    await untilFn(() => runs.length === 10, 'explicit continuation ahead of paused queue');
    check('Continue runs immediately while preserving queue and draft', await q('document.querySelectorAll(".pilot-queue-item").length===4&&document.querySelector(".pilot-input textarea").value==="Preserve this draft while continuing"'));
    await finish(9); await until('!document.querySelector("button[aria-label=Stop]")'); await wait(100);
    check('explicit continuation keeps the remaining queue paused', runs.length === 10 && await q('document.querySelector(".pilot-queue-head").textContent.includes("Paused")'));
    await click('.pilot-queue-head button'); await untilFn(() => runs.length === 11, 'queued run before project switch');
    const before = runs.length;
    await q('window.__fve.load({id:"other-project",name:"Other",media:[],videoClips:[],audioClips:[],textClips:[]})');
    await untilFn(() => runs[10].stage === 'ended', 'old project request canceled'); await wait(100);
    check('project switching clears queue and timeline indicator', runs.length === before && await q('!document.querySelector(".pilot-queue")&&!document.querySelector(".tl-agent-status")'));
    check('no renderer errors', result.errors.length === 0);
  } catch (error) { result.error = error.stack; await shot('failure'); }
  finally { local.runEditorNative = original.run; local.status = original.status; }
  result.requests = runs.map(({ text, stage }) => ({ text, stage })); result.peakConcurrency = peak;
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
