// Actual Settings + IPC + verified native downloads; no inference or messages sent to a model.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {runtimePath}=require('../../electron/agents/agentRuntime.cjs');
module.exports=async(win,app,dir)=>{
 const sdk=require('../../electron/agents/localAgents.cjs'),original=sdk.status;
 const result={checks:[],providers:[],errors:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
 const q=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(e){throw Error(code+'\n'+e.message);}};
 const progressLog=setInterval(()=>{q('document.querySelector("[aria-label=\\\"Agent download\\\"]")?.textContent||""').then(text=>fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({at:new Date().toISOString(),text}))).catch(()=>{});},2000);
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async(code,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(code))return;await wait(50);}throw Error('Timeout '+code);};
 const button=text=>`[...document.querySelectorAll('.settings button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
 // Force a fresh-machine scenario even when developer CLIs already exist on PATH.
 sdk.status=async cfg=>{const file=runtimePath(path.join(dir,'agent-runtimes'),cfg.provider);return file&&fs.existsSync(file)?original({...cfg,executablePath:file}):{ok:false,installed:false,error:'Download the native agent to continue.'};};
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  await q('document.querySelector("button[aria-label=Settings]").click()');await until('!!document.querySelector(".settings select")');
  for(const provider of ['codex-sdk','claude-agent-sdk']){
   const name=provider==='codex-sdk'?'Codex':'Claude';
   await q(`(()=>{const s=document.querySelector('.settings select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(provider)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   const cached=fs.existsSync(runtimePath(path.join(dir,'agent-runtimes'),provider));
   if(!cached){
    await until(`!!${button('Download '+name)}`);check(name+' offers on-demand native download',true);
    if(provider==='codex-sdk'){
     await q(`${button('Download '+name)}.click()`);await until(`!!${button('Cancel download')}`);check('download exposes progress and cancellation',await q('!!document.querySelector("[aria-label=\\\"Agent download progress\\\"]")'));
     await q(`${button('Cancel download')}.click()`);await until(`!!${button('Download '+name)}`);check('cancel restores the download action',true);
    }
    await q(`${button('Download '+name)}.click()`);await until(`!!${button('Cancel download')}`);
    await until(`!${button('Cancel download')}`,600000);
   }else{check(name+' reuses its verified managed cache',true);}
   await until(`document.querySelector('[aria-label="Installed agent status"]')?.textContent&&!document.querySelector('[aria-label="Installed agent status"]').textContent.includes('Checking')`);
   result.downloadError=await q(`document.querySelector('.settings [role=alert]')?.textContent||''`);
   const status=await q(`document.querySelector('[aria-label="Installed agent status"]').textContent`);
   const file=runtimePath(path.join(dir,'agent-runtimes'),provider);
   check(name+' native executable was downloaded and published: '+(result.downloadError||''),fs.existsSync(file));
   const info=await original({provider,executablePath:file});result.lastStatus=info;const canonical=fs.realpathSync(file);check(name+' starts from its managed native executable: '+(info.error||''),info.ok&&info.executablePath===canonical);check(name+' shows a usable absolute sign-in command',info.loginCommand.includes(canonical));
   result.providers.push({provider,status,version:info.version,executablePath:file});
   fs.writeFileSync(path.join(dir,provider+'.png'),(await win.capturePage()).toPNG());
   if(provider==='codex-sdk'){
    const nativeEnv={...process.env,PATH:'/usr/bin:/bin'};delete nativeEnv.ELECTRON_RUN_AS_NODE;
    const {CodexNative}=require('../../electron/agents/codexNative.cjs'),client=new CodexNative({executablePath:file,cwd:dir,env:nativeEnv,catalogOnly:true});
    try{await client.ready;check('downloaded Codex completes native app-server initialization',true);}finally{client.close();}
   }else{
    const nativeEnv={...process.env,PATH:'/usr/bin:/bin'};delete nativeEnv.ELECTRON_RUN_AS_NODE;
    const claude=await import('@anthropic-ai/claude-agent-sdk');
    const query=claude.query({prompt:(async function*(){})(),options:{pathToClaudeCodeExecutable:file,cwd:dir,env:nativeEnv,tools:[],mcpServers:{},settingSources:[],permissionMode:'dontAsk',persistSession:false}});
    try{const models=await query.supportedModels();check('Claude SDK connects to the downloaded native executable',Array.isArray(models)&&models.length>0);}finally{query.close();}
   }
  }
  check('no partial download remains',!fs.readdirSync(path.join(dir,'agent-runtimes')).some(n=>n.startsWith('.install-')));
  check('Settings produces no renderer exceptions',result.errors.length===0);
 }catch(error){result.error=error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 finally{clearInterval(progressLog);sdk.status=original;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
