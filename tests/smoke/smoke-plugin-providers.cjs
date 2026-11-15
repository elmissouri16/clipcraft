const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog}=require('electron'),settings=require('../../electron/system/settings.cjs');
 if(process.env.FVE_PROVIDER_REOPEN==='1'){
  const result={ok:false,checks:[]},q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
  try{
   for(let i=0;i<500&&!await q('!!window.__fve&&!!document.querySelector(".home-frame-card")');i++)await wait(20);
   const saved=await q('window.api.settingsGet()'),check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
   check('restart preserves exact unavailable provider selection',saved.provider.startsWith('plugin-provider:clipcraft-tests.provider/chat@')&&saved.providerPlugins.some(p=>p.id===saved.provider&&p.unavailable));
   check('restart preserves scoped consent but no migrated credential',settings.pluginProviderApproved(saved.provider)&&!saved.keys[saved.provider]);
   const failed=await q(`window.api.aiTest({provider:${JSON.stringify(saved.provider)}})`);check('unavailable provider fails before a connection after restart',!failed.ok&&failed.error.includes('unavailable'));
   await q('document.querySelector(".home-frame-card").click()');for(let i=0;i<500&&!await q('!!document.querySelector(".topbar")');i++)await wait(20);
   await q(`document.querySelector(${JSON.stringify('button[aria-label="Settings"]')}).click()`);for(let i=0;i<500&&!await q('!!document.querySelector(".settings2 select")');i++)await wait(20);
   check('reopened Settings represents the missing provider explicitly',await q('document.querySelector(".settings2").textContent.includes("This plugin provider is unavailable")'));
   check('dev example is reloaded without changing saved selection',saved.providerPlugins.some(p=>p.pluginId==='clipcraft-examples.local-ai')&&settings.getPublic().provider===saved.provider);
   result.ok=true;
  }catch(error){result.error=error.stack;}
  fs.writeFileSync(path.join(dir,'reopen-result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);return;
 }

 const original={open:dialog.showOpenDialog,prompt:dialog.showMessageBox,fetch:globalThis.fetch};
 const result={ok:false,checks:[],requests:[],consents:[],errors:[],outsideRequests:0},q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(s,ms=25000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(s))return;await wait(40);}throw Error('Timeout '+s);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const textButton=async text=>q(`[...document.querySelectorAll('.settings2 button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled).click()`);
 let mode='normal',approved=true,pending=0,aborted=0,sequence=0;
 const reply=(res,message)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));};
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body||'{}');
  result.requests.push({url:req.url,model:data.model,hasAuthorization:!!req.headers.authorization,expectedCredential:req.headers.authorization==='Bearer provider-fixture-one',tools:(data.tools||[]).map(t=>t.function.name)});
  if(mode==='pending'){pending++;res.on('close',()=>aborted++);return;}
  if(mode==='redirect'){res.writeHead(307,{location:'/leaked'});res.end();return;}
  if(mode==='error'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'rejected provider-fixture-one'}}));return;}
  if(mode==='agent'){
   const tool=(name,args)=>reply(res,{content:null,tool_calls:[{id:'call_'+(++sequence),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
   const toolMessages=data.messages.filter(m=>m.role==='tool');
   if(!toolMessages.length)return tool('get_project',{});
   if(toolMessages.length===1)return tool('set_project',{name:'Named through plugin provider'});
   return reply(res,{content:'Renamed the project using the configured plugin provider.'});
  }
  reply(res,{content:'OK'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/v1`;
 globalThis.fetch=(url,options)=>{if(!String(url).startsWith(base+'/')){result.outsideRequests++;return Promise.reject(Error('Fixture blocked another service.'));}return original.fetch(url,options);};
 dialog.showMessageBox=async(_parent,options)=>{result.consents.push(options);return {response:approved?0:1};};
 let installFolder;
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[installFolder]});
 const project={id:'provider-proof',name:'Before provider',width:320,height:180,fps:24,ratio:'16:9',media:[],videoClips:[{id:'gap',gap:true,in:0,out:2}],audioClips:[],overlayClips:[],textClips:[],effectClips:[],markers:[]};
 const openSettings=async()=>{await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');};
 const select=async id=>{await q(`(()=>{const e=document.querySelector('select[aria-label="Provider"]');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(80);};
 const close=()=>click('button[aria-label="Close settings"]');
 const install=async manifest=>{
  installFolder=path.join(dir,'provider-'+manifest.version);fs.mkdirSync(installFolder);fs.writeFileSync(path.join(installFolder,'plugin.json'),JSON.stringify(manifest));
  await q('window.api.pluginsInstall(true)');const rows=await q('window.api.pluginsList()');return rows.find(r=>r.manifest?.id===manifest.id&&r.manifest.version===manifest.version);
 };
 const send=async()=>{
  await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Use the configured provider to rename this project.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")');
 };
 const done=()=>until('!document.querySelector("button[aria-label=Stop]")');
 win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);settings.setFirstRun({tourSeen:true,packPromptSeen:true});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');await q(`window.__fve.load(${JSON.stringify(project)})`);
  await openSettings();const initial=await q('window.api.settingsGet()');check('dev example loads without approval or network requests',initial.providerPlugins.some(p=>p.pluginId==='clipcraft-examples.local-ai'&&!p.approved)&&result.requests.length===0);
  const manifest={id:'clipcraft-tests.provider',name:'Provider fixture',publisher:'ClipCraft tests',version:'1.0.0',apiVersion:1,permissions:[],contributes:{aiProviders:[{id:'chat',name:'Fixture AI',description:'Isolated protocol fixture.',protocol:'openai',baseUrl:base,needsKey:true,defaultModel:'fixture-tools',models:[{id:'fixture-tools',name:'Fixture tools',vision:false},{id:'fixture-other',name:'Fixture other',vision:false}]}]}};
  const row=await install(manifest),id=`plugin-provider:${manifest.id}/chat@${row.key}`;await select(id);
  check('provider appears in native Settings selector with exact version',await q(`document.querySelector('select[aria-label="Provider"]').selectedOptions[0].textContent.includes('Fixture AI · 1.0.0')`));
  check('endpoint is visible but cannot be edited',await q(`document.querySelector('.settings2').textContent.includes(${JSON.stringify(base)})&&![...document.querySelectorAll('.settings2 input')].some(e=>e.value===${JSON.stringify(base)})`));
  approved=false;await textButton('Save');await until('document.querySelector(".settings2").textContent.includes("permission declined")');
  check('consent denial preserves selected provider and credentials',settings.getPublic().provider===initial.provider&&!settings.pluginProviderApproved(id)&&!settings.getPublic().keys[id]);approved=true;
  await textButton('Save');await until('document.querySelector(".settings2").textContent.includes("Saved")');
  check('native consent identifies destination, unverified publisher and Cancel default',result.consents[0].defaultId===1&&result.consents[0].detail.includes(base)&&result.consents[0].detail.includes('unverified')&&result.consents[0].detail.includes('tool results'));
  check('saving configuration does not probe a model endpoint',result.requests.length===0&&settings.getPublic().provider===id);
  await textButton('Manage API key');await until(`!!document.querySelector(${JSON.stringify(`[data-service-key="assistant:${id}"] input`)})`);
  await q(`(()=>{const e=document.querySelector(${JSON.stringify(`[data-service-key="assistant:${id}"] input`)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'provider-fixture-one');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await textButton('Save key');await until(`document.querySelector(${JSON.stringify(`[data-service-key="assistant:${id}"]`)}).textContent.includes('Key saved')`);
  const settingsFile=path.join(dir,'settings-test','settings.json');check('credentials are encrypted on disk and only hints reach public settings',!fs.readFileSync(settingsFile,'utf8').includes('provider-fixture-one')&&settings.getPublic().keys[id]&&!JSON.stringify(settings.getPublic()).includes('provider-fixture-one'));
  await textButton('Assistant settings');await until('!!document.querySelector("select")');await textButton('Test connection');await until('document.querySelector(".settings2").textContent.includes("Connected")');
  check('real HTTP connection test reaches only declared endpoint with its own key',result.requests.length===1&&result.requests[0].expectedCredential&&result.requests[0].url==='/v1/chat/completions');
  await textButton('Load models');await wait(200);check('model discovery uses declared catalog without requests',result.requests.length===1);
  fs.writeFileSync(path.join(dir,'provider-settings.png'),(await win.capturePage()).toPNG());await close();await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');mode='agent';await send();await done();
  check('CraftAI performs the real protocol tool loop and applies guarded edits',await q('window.__fve.rawProject().name==="Named through plugin provider"')&&result.requests.some(r=>r.tools.includes('set_project'))&&result.requests.filter(r=>r.model==='fixture-tools').length>=4);
  check('provider edits keep normal one-step Undo',await q('window.__fve.history().past.length===1'));await q('window.__fve.dispatch({type:"undo"})');await wait(80);check('Undo restores the project name',await q('window.__fve.rawProject().name==="Before provider"'));
  mode='pending';pending=0;await send();for(let i=0;i<500&&!pending;i++)await wait(10);assert.ok(pending);await click('button[aria-label=Stop]');await done();await wait(100);check('Stop aborts pending provider HTTP and preserves the document',aborted>0&&await q('window.__fve.rawProject().name==="Before provider"'));
  mode='normal';await openSettings();await q(`window.api.pluginsEnable(${JSON.stringify(row.key)},false)`);await wait(150);
  check('disablement preserves exact selection as unavailable',settings.getPublic().provider===id&&await q('document.querySelector(".settings2").textContent.includes("This plugin provider is unavailable")'));
  const beforeDisabled=result.requests.length,disabled=await q(`window.api.aiTest({provider:${JSON.stringify(id)}})`);check('disabled provider makes no requests and cannot fall back',!disabled.ok&&result.requests.length===beforeDisabled&&result.outsideRequests===0);
  await q(`window.api.pluginsEnable(${JSON.stringify(row.key)},true)`);await wait(150);check('re-enabling exact package restores its scoped approval and key',settings.pluginProviderApproved(id)&&!!settings.getPublic().keys[id]);
  settings.saveProviderKey('openai','builtin-fixture-key');mode='error';const failure=await q(`window.api.aiTest({provider:${JSON.stringify(id)}})`);check('provider errors redact credentials and never enter fallback',!failure.ok&&!failure.error.includes('provider-fixture-one')&&result.outsideRequests===0);
  mode='redirect';const beforeRedirect=result.requests.length,redirect=await q(`window.api.aiTest({provider:${JSON.stringify(id)}})`);check('redirect cannot forward conversation or credential',!redirect.ok&&result.requests.length===beforeRedirect+1&&!result.requests.some(r=>r.url==='/leaked'));
  mode='pending';pending=0;await q(`window.__providerPending=window.api.aiTest({provider:${JSON.stringify(id)}});void 0`);for(let i=0;i<500&&!pending;i++)await wait(10);assert.ok(pending);const revokeAt=Date.now();await q(`window.api.pluginsEnable(${JSON.stringify(row.key)},false)`);const revoked=await q('window.__providerPending');result.revokeLatencyMs=Date.now()-revokeAt;check('revocation aborts a pending connection and rejects late results',!revoked.ok&&result.revokeLatencyMs<2000);await q(`window.api.pluginsEnable(${JSON.stringify(row.key)},true)`);
  const updated=structuredClone(manifest);updated.version='1.1.0';updated.contributes.aiProviders[0].name='Fixture AI updated';const newer=await install(updated),newId=`plugin-provider:${manifest.id}/chat@${newer.key}`;
  check('update leaves prior selection unavailable and never migrates credentials',settings.getPublic().provider===id&&!settings.getPublic().keys[newId]&&!settings.pluginProviderApproved(newId));
  await select(newId);approved=false;await textButton('Save');await wait(150);check('updated version requires fresh consent',!settings.pluginProviderApproved(newId)&&settings.getPublic().provider===id);approved=true;await textButton('Save');await wait(150);
  check('updated version remains keyless after approval',settings.getPublic().provider===newId&&!settings.getPublic().keys[newId]);
  const oldCredential=settings.getPublic().keys[id];check('old scoped key remains removable without exposing its value',!!oldCredential&&!!settings.getPublic().providerPlugins.find(p=>p.id===id&&p.unavailable));await q(`window.api.settingsClearKey(${JSON.stringify(id)})`);check('removing orphaned credentials preserves new selection',!settings.getPublic().keys[id]&&settings.getPublic().provider===newId);
  await q(`window.api.pluginsRemove(${JSON.stringify(newer.key)})`);check('removal retains unavailable selection without another provider receiving it',settings.getPublic().provider===newId&&result.outsideRequests===0);
  check('no renderer exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.error=error.stack;console.error(error);try{result.dom=await q('document.body.innerText.slice(-2200)');}catch{}}
 finally{dialog.showOpenDialog=original.open;dialog.showMessageBox=original.prompt;globalThis.fetch=original.fetch;server.closeAllConnections();server.close();}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
