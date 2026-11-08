// Real renderer and IPC. Only the model transports are replaced; no network or
// installed provider credentials are needed to verify exact outgoing context.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const ai = require('../../electron/agents/ai.cjs'), local = require('../../electron/agents/localAgents.cjs');
  const settings = require('../../electron/system/settings.cjs');
  const original = { step: ai.agentStep, run: local.runEditorNative, status: local.status };
  const result = { checks: [], requests: [], errors: [] };
  const q = js => win.webContents.executeJavaScript(js);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async js => { for (let n = 0; n < 150; n++) { if (await q(js)) return;await wait(100); }throw Error('Timeout: ' + js); };
  const check = (name, ok) => { assert.ok(ok, name);result.checks.push(name); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async name => { await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(100);fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG()); };
  const menu = async label => { await until(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent===${JSON.stringify(label)})`);await q(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(label)}).click()`); };
  const active = 'window.__fve.rawProject().craftAI.sessions.find(s=>s.id===window.__fve.rawProject().craftAI.activeSessionId)';
  const rightClip = async id => { await q(`(()=>{const el=document.querySelector('[data-sel-id="${id}"]');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+20,clientY:r.top+12}));})()`); };
  const attachClip = async id => { await rightClip(id);await menu('Add clip to CraftAI');await until('!!document.querySelector(".pilot-context-chip")'); };
  const parse = text => JSON.parse(text.slice(text.indexOf('\n') + 1)).attachments;
  const fixture = id => ({ id, name: 'Timeline reference verification', ratio: '16:9', width: 640, height: 360, fps: 30,
    media: [], videoClips: [{ id: 'v1', gap: true, in: 0, out: 4 }, { id: 'v2', gap: true, in: 0, out: 6 }],
    overlayClips: [], audioClips: [], effectClips: [], textClips: [{ id: 't', text: 'A referenced title', start: 2, duration: 3 }, { id: 'later', text: 'Outside the selected range', start: 8, duration: 2 }],
    craftAI: { sessions: [{ id: 'legacy-style', style: 'meme', messages: [], contents: [], draft: '' }], activeSessionId: 'legacy-style' } });
  const send = async text => {
    await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until('!!document.querySelector("button[aria-label=Send]")&&!document.querySelector("button[aria-label=Send]").disabled');
    await click('button[aria-label=Send]');
  };
  ai.agentStep = async (_cfg, req) => {
    result.requests.push({ provider: 'ollama', system: req.system, contents: req.contents });
    return { ok: true, provider: 'ollama', calls: [], text: 'Reference received.', content: { role: 'model', parts: [{ text: 'Reference received.' }] } };
  };
  local.status = async () => ({ ok: true, authenticated: true, version: 'context-fixture' });
  local.runEditorNative = async (cfg, options) => {
    result.requests.push({ provider: cfg.provider, prompt: options.prompt, history: options.history, system: options.system });
    const complete = await options.onTool('complete_edit', {});
    assert.equal(JSON.parse(complete.content[0].text).ready, true);
    assert.equal(await options.isComplete(), true);
    return { text: 'Native reference received.' };
  };
  win.setSize(1440, 1000);win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });settings.save({ provider: 'ollama' });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(fixture('context-ui'))})`);
    await until('!!document.querySelector("[data-sel-id=v1]")');
    await q('window.__fve.seek(1)');
    await attachClip('v1');
    check('retired style cards, picker and composer controls are absent', await q('!document.querySelector(".pilot-styles,.pilot-picked,button[aria-label=\\"Editing styles\\"]")'));
    check('legacy preset selections are discarded', await q(`${active}.style===undefined`));
    check('clip menu opens CraftAI with a draft attachment', await q(`${active}.timelineAttachments[0].clip_refs[0].id==='v1'`));
    check('attaching does not seek, edit or send', await q('window.__fve.currentTime()===1&&window.__fve.history().past.length===0') && result.requests.length === 0);
    check('attachment-only drafts can start another chat', await q('!document.querySelector("button[aria-label=" + JSON.stringify("New chat") + "]").disabled'));
    await q('window.__fve.select({track:"video",id:"v1",items:[{track:"video",id:"v1"},{track:"text",id:"t"}]})');
    await rightClip('v1');await menu('Add selected clips to CraftAI');
    await until(`${active}.timelineAttachments.length===2`);
    check('right-click preserves a multi-track clip selection', await q(`${active}.timelineAttachments[1].clip_refs.length===2`));
    await q(`(()=>{const scroll=document.querySelector('.tl-scroll'),r=scroll.getBoundingClientRect();const header=document.querySelector('.ruler .tl-head').getBoundingClientRect().width;const ruler=document.querySelector('.ruler');const y=ruler.getBoundingClientRect().top+12;const x=t=>r.left+header+t*60-scroll.scrollLeft;ruler.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,shiftKey:true,clientX:x(2),clientY:y}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:x(4),clientY:y}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:x(4),clientY:y}));})()`);
    await menu('Add selected range to CraftAI');await until(`${active}.timelineAttachments.length===3`);
    check('Shift-drag attaches the precise ruler range', await q(`${active}.timelineAttachments[2].start_sec===2&&${active}.timelineAttachments[2].end_sec===4`));
    check('range selection leaves playhead and edit history unchanged', await q('window.__fve.currentTime()===1&&window.__fve.history().past.length===0'));
    await q(`(()=>{const el=document.querySelector('.zoom');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'120');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until('parseFloat(document.querySelector("[data-sel-id=v1]").style.width)>470');
    await q(`(()=>{const scroll=document.querySelector('.tl-scroll');scroll.scrollLeft=200;const r=scroll.getBoundingClientRect();const header=document.querySelector('.ruler .tl-head').getBoundingClientRect().width;const ruler=document.querySelector('.ruler'),y=ruler.getBoundingClientRect().top+12;const x=t=>r.left+header+t*120-scroll.scrollLeft;ruler.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,shiftKey:true,clientX:x(4),clientY:y}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:x(2),clientY:y}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:x(2),clientY:y}));})()`);
    await menu('Add selected range to CraftAI');
    check('reversed range selection respects zoom and horizontal scroll and deduplicates', await q(`${active}.timelineAttachments.length===3&&${active}.timelineAttachments[2].start_sec===2&&${active}.timelineAttachments[2].end_sec===4`));
    await q(`(()=>{const el=document.querySelector('.zoom');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'60');el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.tl-scroll').scrollLeft=0;})()`);
    await capture('attachments.png');
    await click('.pilot-context-chip .icon-btn');await until(`${active}.timelineAttachments.length===2`);
    await click('.pilot-context-jump');await until('window.__fve.currentTime()===0');
    check('chips can be removed and jump to their timeline part', true);
    const firstChat = await q(`${active}.id`);
    await click('button[aria-label="New chat"]');await until('!document.querySelector(".pilot-context-chip")');
    check('new chats do not inherit attachments', await q(`${active}.timelineAttachments.length===0`));
    await click('button[aria-label="Chat sessions"]');await q(`document.querySelector('[role=option][aria-selected=false]').click()`);
    await until(`${active}.id===${JSON.stringify(firstChat)}&&document.querySelectorAll('.pilot-context-chip').length===2`);
    check('switching chats restores each draft context', true);
    // Refresh at send: the title moves after attaching, without changing the draft.
    await q('window.__fve.dispatch({type:"update",track:"text",id:"t",patch:{start:4}})');
    await until('window.__fve.rawProject().textClips[0].start===4');
    await send('Explain the attached parts only.');
    await until(`${active}.messages.at(-1)?.text==='Reference received.'&&!document.querySelector('button[aria-label=Stop]')`);
    const apiContext = parse(result.requests[0].contents.at(-1).parts.find(p => p.text?.startsWith('Host-provided timeline context')).text);
    check('requests contain exactly the user text without a preset suffix', result.requests[0].contents.at(-1).parts[0].text === 'Explain the attached parts only.');
    check('API receives live clip positions and exact range scope', apiContext[0].clips.find(c => c.clip_id === 't').start_sec === 4 && apiContext[1].start_sec === 2 && apiContext[1].end_sec === 4);
    check('attachments are consumed once and shown on the sent message', await q(`!${active}.timelineAttachments.length&&document.querySelectorAll('.pilot-message-context span').length===2`));
    check('system prompt explains scope and required visual inspection', result.requests[0].system.includes('Host-provided timeline context'));
    // A deleted attached clip must preserve the user draft and prevent a request.
    await q('window.__fve.select({track:"text",id:"t"})');await attachClip('t');await q('window.__fve.dispatch({type:"delete",track:"text",id:"t"})');
    await until('!window.__fve.rawProject().textClips.some(c=>c.id==="t")');
    const count = result.requests.length;await send('Fix this title.');await until('!!document.querySelector(".pilot-context-error")');
    check('deleted context blocks sending and retains draft', result.requests.length === count && await q(`${active}.draft==='Fix this title.'&&${active}.timelineAttachments.length===1`));
    await click('.pilot-context-chip .icon-btn');
    await attachClip('v2');
    const persisted = await q('window.__fve.rawProject()');
    await q(`window.__fve.load(${JSON.stringify(persisted)})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');
    await until('document.querySelectorAll(".pilot-context-chip").length===1');
    check('reopening the same project preserves attachments without replaying the last attach action', await q(`${active}.timelineAttachments[0].clip_refs[0].id==='v2'`));
    check('reopening clears the transient range highlight', await q('!document.querySelector(".tl-context-range")'));
    for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
      settings.save({ provider });
      await q(`window.__fve.load(${JSON.stringify(fixture('context-' + provider))})`);await until('!!document.querySelector("[data-sel-id=v2]")');
      await rightClip('v2');await menu('Add clip time range to CraftAI');await until('!!document.querySelector(".pilot-context-chip")');
      check(`${provider} starts without another project's context`, await q(`${active}.timelineAttachments.length===1`));
      await send('Inspect just this attached range.');
      await until(`${active}.messages.at(-1)?.text==='Native reference received.'&&!document.querySelector('button[aria-label=Stop]')`);
      const request = result.requests.find(r => r.provider === provider);
      const context = parse(request.prompt.slice(request.prompt.indexOf('Host-provided timeline context')));
      check(`${provider} receives the question and native context together`, request.prompt.startsWith('Inspect just this attached range.') && context[0].start_sec === 4 && context[0].end_sec === 10 && context[0].clip_refs.some(r => r.id === 'v2'));
      check(`${provider} context scope prompt reaches the native loop`, request.system.includes('Host-provided timeline context'));
    }
    await capture('sent-native.png');
    check('renderer has no runtime errors', result.errors.length === 0);
  } catch (error) {
    result.error = error.stack;
    await capture('failure.png');
    result.dom = await q('document.body.innerText.slice(-3500)');
  } finally { ai.agentStep = original.step;local.runEditorNative = original.run;local.status = original.status; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ checks: result.checks, error: result.error, evidence: dir }));app.exit(result.error ? 1 : 0);
};
