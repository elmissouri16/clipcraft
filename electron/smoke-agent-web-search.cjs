const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
  fs.mkdirSync(dir,{recursive:true});
  const live=process.env.FVE_CODEX_WEB_LIVE==='1',ai=require('./ai.cjs'),settings=require('./settings.cjs'),{shell}=require('electron');
  const original=ai.agentStep,originalOpen=shell.openExternal,result={live,checks:[],errors:[]},opened=[];
  const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
  const q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(js,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(50);}throw new Error(`Timed out: ${js}`);};
  const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
  const draft=text=>q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  settings.setFirstRun({tourSeen:true,packPromptSeen:true});settings.save({provider:'codex-sdk',model:'gpt-6.1-sol'});
  win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
  shell.openExternal=async url=>{opened.push(url);};
  let cancel=false,searchStarted=false;
  ai.agentStep=async(cfg,req)=>{
    if(live&&!cancel)return original(cfg,req);
    req.onSearch({id:'search-test',query:'IANA example domains official documentation',status:'running'});searchStarted=true;
    if(cancel)return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Stopped'),{name:'AbortError'})),{once:true}));
    await wait(300);req.onSearch({id:'search-test',query:'IANA example domains official documentation',status:'done'});
    const text='The domains example.com and example.org are reserved for documentation. [IANA example domains](https://www.iana.org/help/example-domains)';
    return {calls:[],text,content:{role:'model',parts:[{text}]}};
  };
  try{
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    const before=await q('window.__fve.exportData().project');
    await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');
    await draft('Use live web search to find the official IANA documentation about example domains. Tell me which domains it reserves for documentation and include a Markdown source link to the official page. Do not edit the project.');
    await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');
    await until('!!document.querySelector("button[aria-label=Stop]")');await until('!document.querySelector("button[aria-label=Stop]")',live?180000:30000);
    result.text=await q('document.querySelector(".pilot-messages")?.textContent||document.querySelector(".pilot-body")?.textContent||document.body.textContent');
    check('Codex search activity appears in the chat',await q('!!document.querySelector("[data-tool-icon=web_search]")&&!!document.querySelector(".pilot-steps li.done")'));
    check('researched replies contain clickable source links',await q('[...document.querySelectorAll(".pilot-source-link")].some(a=>new URL(a.title).hostname.endsWith("iana.org"))'));
    await q('[...document.querySelectorAll(".pilot-source-link")].find(a=>new URL(a.title).hostname.endsWith("iana.org")).click()');
    for(let n=0;opened.length===0&&n<100;n++)await wait(20);
    check('source clicks open the verified HTTP(S) URL through the main process',opened.length===1&&new URL(opened[0]).hostname.endsWith('iana.org'));
    const bad=await q('window.api.openWebSource("file:///tmp/private")');check('source links cannot open local files',!!bad.error&&opened.length===1);
    check('research does not change project media or create an Undo entry',(await q('window.__fve.exportData().project.media.length'))===before.media.length&&!await q('!!document.querySelector(".pilot-undo")'));
    fs.writeFileSync(path.join(dir,'search.png'),(await win.capturePage()).toPNG());
    cancel=true;searchStarted=false;
    await draft('Search another source.');await click('button[aria-label=Send]');for(let n=0;!searchStarted&&n<100;n++)await wait(20);
    check('a running search exposes Stop',searchStarted);await click('button[aria-label=Stop]');await until('!document.querySelector("button[aria-label=Stop]")');
    check('stopped searches leave no running activity rows',!await q('!!document.querySelector(".pilot-steps li.running")'));
    check('no renderer errors',result.errors.length===0);result.ok=true;
  }catch(error){result.ok=false;result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>null);fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
  finally{ai.agentStep=original;shell.openExternal=originalOpen;}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,live,checks:result.checks,error:result.error,dir}));app.exit(result.ok?0:1);
};
