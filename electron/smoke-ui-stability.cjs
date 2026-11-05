// Real renderer regression: AI edits must not move a paused timeline viewport.
// Run against a dev renderer (or freshly compiled dist):
// FVE_SMOKE=/tmp/clipcraft-ui FVE_SMOKE_MODE=ui-stability \
// VITE_DEV_SERVER_URL=http://localhost:5173 npx electron .
// The smoke directory must exist; all settings and evidence stay isolated there.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const q = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js) => {
    for (let i = 0; i < 150; i++) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const result = { checks: [], headers: [], scroll: [], errors: [] };
  const check = (ok, name, detail) => result.checks.push({ ok: !!ok, name, detail });
  const settings = require('./settings.cjs');
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });
  settings.save({ provider: 'ollama' });
  const ai = require('./ai.cjs');
  let step = 0;
  ai.agentStep = async () => {
    await wait(100);
    if (step === 0) {
      step++;
      const calls = [{ name: 'load_tools', args: { groups: ['text'] } }];
      return { calls, content: { role: 'model', parts: calls.map((functionCall) => ({ functionCall })) } };
    }
    if (step++ < 7) {
      const calls = [{ name: 'add_text', args: { text: `AI title ${step}`, start_sec: 0, duration_sec: 60 } }];
      return { calls, content: { role: 'model', parts: calls.map((functionCall) => ({ functionCall })) } };
    }
    return { calls: [], text: 'Titles added.', content: { role: 'model', parts: [{ text: 'Titles added.' }] } };
  };
  win.webContents.on('console-message', (_e, severity, message) => { if (severity >= 3) result.errors.push(message); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await q(`window.__fve.load({id:'ui-stability',name:'Variables in 60 Seconds',ratio:'16:9',
      media:[],videoClips:[],audioClips:[],textClips:Array.from({length:8},(_,i)=>({id:'t'+i,text:'Title '+i,start:0,duration:60,layer:i}))})`);
    await wait(200);
    await q('document.querySelector(".welcome-go")?.click()');
    for (const width of [1512, 1200, 1000]) {
      win.setContentSize(width, 840);
      await wait(200);
      const header = await q(`(() => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}; };
        const meta = rect(document.querySelector('.project-meta'));
        const actions = [...document.querySelector('.top-actions').children].filter(el=>el.getBoundingClientRect().width).map(rect);
        return {width:innerWidth,meta,actions,bar:rect(document.querySelector('.topbar'))};
      })()`);
      result.headers.push(header);
      check(header.meta.right + 6 <= header.actions[0].left, `header controls clear project at ${width}px`, header);
      check(header.actions.every((r,i)=>r.right<=header.bar.right && (!i || r.left>=header.actions[i-1].right)), `header actions fit at ${width}px`);
      await q(`document.querySelector('button[aria-label="More export options"]').click()`);
      await until('!!document.querySelector(".ctx-menu")');
      const menu = await q(`(() => {
        const m=document.querySelector('.ctx-menu').getBoundingClientRect();
        const b=document.querySelector('.export-split .caret').getBoundingClientRect();
        return {left:m.left,right:m.right,top:m.top,bottom:m.bottom,buttonBottom:b.bottom,buttonRight:b.right};
      })()`);
      check(menu.left>=0 && menu.right<=width && menu.top>=menu.buttonBottom && Math.abs(menu.right-menu.buttonRight)<1 && menu.bottom<=840, `export menu anchored to its button at ${width}px`,menu);
      await q(`document.querySelector('.ctx-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    }
    win.setContentSize(1200, 840);
    await wait(200);
    await q('document.querySelector(".pilot-fab").click()');
    await until('!!document.querySelector(".pilot-input textarea")');
    await q(`(() => {
      const el = document.querySelector('.pilot-input textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Add layered titles');
      el.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await until('!document.querySelector("button[aria-label=Send]").disabled');
    await q(`(() => {
      const el = document.querySelector('.tl-scroll'); el.scrollTop=170; el.scrollLeft=640;
      window.__uiScroll = {top:el.scrollTop,left:el.scrollLeft,samples:[]};
      window.__uiScrollTimer = setInterval(()=>window.__uiScroll.samples.push({top:el.scrollTop,left:el.scrollLeft}),25);
      document.querySelector('button[aria-label=Send]').click();
    })()`);
    await until('!!document.querySelector("button[aria-label=Stop]")');
    await until('!document.querySelector("button[aria-label=Stop]")');
    await wait(250);
    const scroll = await q(`(() => { clearInterval(window.__uiScrollTimer); return window.__uiScroll; })()`);
    result.scroll.push(scroll);
    check(scroll.samples.every(s=>s.top===scroll.top && s.left===scroll.left), 'paused timeline stays still through real AI tool loop', scroll);
    check(await q('window.__fve.exportData().project.textClips.length===14'), 'AI additions completed');
    // Chat notifications can arrive between display frames. They must not keep
    // canceling the next playback frame and re-anchoring to stale React time.
    await q('window.__fve.seek(12); window.__fve.play()');
    await wait(150);
    const playback = await q(`new Promise(resolve => {
      const started=performance.now();
      const read=()=>parseFloat(document.querySelector('.playhead').style.transform.match(/translateX\\(([-\\d.]+)/)[1]);
      const x=read();
      const timer=setInterval(()=>{
        const p=window.__fve.exportData().project;
        window.__fve.dispatch({type:'craftChat',projectId:p.id,chat:structuredClone(p.craftAI)});
      },5);
      setTimeout(()=>{clearInterval(timer);resolve({elapsed:(performance.now()-started)/1000,advanced:(read()-x)/60});},700);
    })`);
    result.playback=playback;
    check(playback.advanced >= playback.elapsed*0.75 && playback.advanced <= playback.elapsed*1.25, 'playback advances continuously through chat updates', playback);
    await q('window.__fve.pause()');
    await q(`document.querySelector('button[aria-label="Close assistant"]').click()`);
    await q('document.querySelector(".tl-scroll").scrollLeft=0; window.__fve.seek(50); window.__fve.play()');
    await until('document.querySelector(".tl-scroll").scrollLeft>100');
    await q('window.__fve.pause()');
    const paused = await q(`(() => { const el=document.querySelector('.tl-scroll'); return {top:el.scrollTop,left:el.scrollLeft}; })()`);
    await wait(350);
    check(await q(`document.querySelector('.tl-scroll').scrollLeft===${paused.left}`), 'follow stops when playback pauses');
    await q('window.__fve.seek(12); window.__fve.play()');
    await wait(100);
    await q(`window.__fve.dispatch({type:'updateMany',updates:window.__fve.exportData().project.textClips.map(c=>({track:'text',id:c.id,patch:{duration:5}}))})`);
    await until(`!!document.querySelector('button[aria-label="Play (Space)"]')`);
    check(await q('window.__fve.duration()===5'), 'live duration edits stop playback at the new end');
    fs.writeFileSync(path.join(dir,'ui.png'), (await win.capturePage()).toPNG());
    check(result.errors.length===0,'no renderer errors',result.errors);
  } catch (error) { result.error = error.stack; }
  result.ok = !result.error && result.checks.every(c=>c.ok);
  fs.writeFileSync(path.join(dir,'result.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:result.ok,checks:result.checks.map(({name,ok})=>({name,ok})),error:result.error,dir}));
  app.exit(result.ok ? 0 : 1);
};
