// Real Settings/CraftAI, worker, IPC and reducer; model text/native choices are test fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),ai=require('../../electron/agents/ai.cjs'),settings=require('../../electron/system/settings.cjs'),local=require('../../electron/agents/localAgents.cjs');
 const original={chat:ai.chat,dialog:dialog.showMessageBox,run:local.runEditorNative,status:local.status,models:ai.listModels};
 const result={checks:[],errors:[],consents:[],reviews:[],requests:[],ok:false};
 const q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(js,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(40);}throw Error('Timeout: '+js);};
 const untilHost=async(fn,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await wait(20);}throw Error('Host fixture timeout');};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 let mode='normal',consent=true,reviewResolve,modelResolve,aborted=0,changeConfig=false;
 const chapters=[{time:0,label:'The opening topic'},{time:4,label:'The second topic'}];
 dialog.showMessageBox=async(_parent,options)=>{
  if(options.title==='Review chapter markers'){
   result.reviews.push({detail:options.detail,defaultId:options.defaultId,buttons:options.buttons});
   return new Promise(resolve=>{reviewResolve=resolve;});
  }
  result.consents.push({detail:options.detail,defaultId:options.defaultId,buttons:options.buttons});
  if(changeConfig)settings.save({provider:'ollama',model:'changed-after-consent',baseUrl:'http://127.0.0.1:22222'});
  return {response:consent?0:1};
 };
 ai.chat=async(cfg,opts)=>{
  result.requests.push({provider:cfg.provider,model:cfg.model,baseUrl:cfg.baseUrl,maxTokens:opts.maxTokens,prompt:opts.messages[0].content,system:opts.system,webResearch:cfg.webResearch});
  opts.signal.addEventListener('abort',()=>{aborted++;});
  if(mode==='pending')return new Promise(resolve=>{modelResolve=resolve;});
  if(mode==='malformed')return JSON.stringify({chapters:[{time:3,label:'Invented timestamp'}]});
  if(mode==='failure')throw Error('PRIVATE_CREDENTIAL /private/provider/log');
  return JSON.stringify({chapters});
 };
 const base=id=>({id,name:'PRIVATE_PROJECT_TITLE',ratio:'16:9',width:320,height:180,fps:24,media:[],videoClips:[{id:'gap',gap:true,in:0,out:10}],overlayClips:[],audioClips:[],effectClips:[],markers:[],textClips:[
  {id:'cap1',caption:true,start:0,duration:2,text:'An opening topic about planning.'},
  {id:'cap2',caption:true,start:4,duration:2,text:'A second topic about implementation.'},
  {id:'cap3',caption:true,start:8,duration:2,text:'A short conclusion.'},
  {id:'title',caption:false,start:0,duration:2,text:'PRIVATE_NON_CAPTION_TITLE'},
 ]});
 let sequence=0;
 const open=async(project=base('ai-workflow-'+(++sequence)),provider='ollama')=>{
  settings.save({provider,model:'fixture-chapters',baseUrl:provider==='ollama'?'http://127.0.0.1:11434':'',subagents:false});
  await q(`window.__fve.load(${JSON.stringify(project)})`);await wait(120);
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('[data-section=plugins]');
  await until('[...document.querySelectorAll(".plugin-row")].some(e=>e.textContent.includes("AI chapter markers"))');
  await q('[...document.querySelectorAll(".plugin-row")].find(e=>e.textContent.includes("AI chapter markers")).click()');await until('!!document.querySelector("[data-plugin-command=suggest-chapters] > button")');
 };
 const run=async()=>{reviewResolve=null;modelResolve=null;await click('[data-plugin-command=suggest-chapters] > button');};
 const phase=p=>until(`!!document.querySelector('.plugin-command-status[data-phase=${p}]')`);
 const review=async accept=>{await untilHost(()=>!!reviewResolve);const resolve=reviewResolve;reviewResolve=null;resolve({response:accept?0:1});};
 const sandboxExists=()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('clipcraft-command:'));
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  await open();changeConfig=true;await run();await phase('review');changeConfig=false;
  check('dev autoload exposes the AI example without model execution before Run',result.requests.length===1);
  const request=result.requests[0],captionData=JSON.parse(request.prompt).captions;
  check('host sends only existing captions and timings',captionData.length===3&&captionData.every(c=>Object.keys(c).sort().join(',')==='end_sec,start_sec,text')&&!request.prompt.includes('PRIVATE_'));
  check('consent names exact service, provider/model and text amount',result.consents[0].defaultId===1&&result.consents[0].detail.includes('http://127.0.0.1:11434')&&result.consents[0].detail.includes('fixture-chapters')&&result.consents[0].detail.includes('3 cues')&&result.consents[0].detail.includes('usage charges may apply'));
  check('settings changed during approval cannot redirect the captured request',request.model==='fixture-chapters'&&request.baseUrl==='http://127.0.0.1:11434');
  check('request output is bounded and web research is off',request.maxTokens===2048&&request.webResearch===false);
  check('no edits or Undo entries exist before explicit marker review',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  check('sandbox is stopped before review',!sandboxExists());
  check('review shows actual proposed timestamps/titles and defaults to Discard',result.reviews[0].defaultId===1&&result.reviews[0].detail.includes('00:00:04.000 — The second topic')&&result.reviews[0].buttons[1]==='Discard');
  await q('document.querySelector(".plugin-command-status").scrollIntoView({block:"end"})');await wait(180);fs.writeFileSync(path.join(dir,'review-pending.png'),(await win.capturePage()).toPNG());
  await review(true);await phase('completed');
  check('Apply commits actual AI chapter titles and timings',await q(`JSON.stringify(window.__fve.rawProject().markers.map(({time,label})=>({time,label})))===${JSON.stringify(JSON.stringify(chapters))}`));
  check('accepted suggestions create one Undo step',await q('window.__fve.history().past.length===1'));
  await q('window.__fve.dispatch({type:"undo"})');await wait(80);check('one Undo removes all AI chapter markers',await q('window.__fve.rawProject().markers.length===0'));
  await q('window.__fve.dispatch({type:"redo"})');await wait(80);check('one Redo restores all AI chapter markers',await q('window.__fve.rawProject().markers.length===2'));
  await q('document.querySelector(".plugin-command-status").scrollIntoView({block:"end"})');await wait(180);fs.writeFileSync(path.join(dir,'applied.png'),(await win.capturePage()).toPNG());
  await click('button[aria-label="Close settings"]');await open();await run();await phase('review');await review(false);await phase('denied');
  check('Discard preserves the project and Undo',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  const callsBeforeDenial=result.requests.length;consent=false;await run();await phase('denied');consent=true;
  check('sharing refusal never calls a model',result.requests.length===callsBeforeDenial);
  for(const failure of ['malformed','failure']){
   mode=failure;const before=result.requests.length,reviews=result.reviews.length;await run();await phase('failed');
   check(`${failure}: fails without edits, review or automatic retries`,result.requests.length===before+1&&result.reviews.length===reviews&&await q('window.__fve.rawProject().markers.length===0'));
   check(`${failure}: provider secrets are absent from displayed errors`,!await q('document.querySelector(".plugin-command-status").textContent.includes("PRIVATE_CREDENTIAL")'));
  }
  mode='normal';await click('button[aria-label="Close settings"]');const missing=base('missing-captions');missing.textClips=missing.textClips.filter(c=>!c.caption);await open(missing);const beforeMissing=result.requests.length,promptsBeforeMissing=result.consents.length;await run();await phase('failed');
  check('missing captions fail before approval or model access',result.requests.length===beforeMissing&&result.consents.length===promptsBeforeMissing&&await q('document.querySelector(".plugin-command-status").textContent.includes("existing timeline captions")'));
  await click('button[aria-label="Close settings"]');const oversized=base('oversized-captions');oversized.textClips[0].text='x'.repeat(24001);await open(oversized);await run();await phase('failed');
  check('oversized captions fail explicitly without silent truncation',result.requests.length===beforeMissing&&await q('document.querySelector(".plugin-command-status").textContent.includes("24,000")'));
  for(const interruption of ['cancel','manual','disable','timeout']){
   await click('button[aria-label="Close settings"]');await open();mode='pending';const beforeAbort=aborted;await run();await untilHost(()=>!!modelResolve);
   check(`${interruption}: model request is pending with no edits`,await q('window.__fve.rawProject().markers.length===0'));
   if(interruption==='cancel')await click('.plugin-command-status button');
   if(interruption==='manual')await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual edit preserved"}})');
   if(interruption==='disable')await q('(async()=>{const row=(await window.api.pluginsList()).find(r=>r.manifest?.id==="clipcraft-examples.ai-chapter-markers");await window.api.pluginsEnable(row.key,false);})()');
   await phase(interruption==='manual'||interruption==='timeout'?'failed':'canceled');
   await untilHost(()=>aborted>beforeAbort);check(`${interruption}: abort reaches the model and disposes the sandbox`,!sandboxExists());
   modelResolve(JSON.stringify({chapters}));await wait(100);
   check(`${interruption}: late results cannot apply staged markers`,await q('window.__fve.rawProject().markers.length===0'));
   if(interruption==='manual')check('concurrent manual edit survives',await q('window.__fve.rawProject().name==="Manual edit preserved"'));
   if(interruption==='disable')await q('(async()=>{const row=(await window.api.pluginsList()).find(r=>r.manifest?.id==="clipcraft-examples.ai-chapter-markers");await window.api.pluginsEnable(row.key,true);})()');
  }
  mode='normal';await click('button[aria-label="Close settings"]');await open();await run();await phase('review');await click('.plugin-command-status button');await phase('canceled');await review(true);await wait(80);
  check('late review approval cannot revive a canceled command',await q('window.__fve.rawProject().markers.length===0'));
  // CraftAI must pass the same sharing approval and review; it cannot apply directly.
  local.status=async()=>({ok:true,authenticated:true,version:'fixture'});ai.listModels=async()=>({ok:true,models:['fixture-chapters']});
  let agentResult;
  local.runEditorNative=async(_cfg,options)=>{
   const call=async(name,args={})=>JSON.parse((await options.onTool(name,args)).content[0].text);
   const list=await call('list_plugin_commands',{query:'AI chapter markers'}),command=list.commands.find(c=>c.plugin_id==='clipcraft-examples.ai-chapter-markers');
   agentResult=await call('run_plugin_command',{key:command.key,command_id:command.command_id,input:[{id:'count',value:2}]});
   if(agentResult.error&&!agentResult.permission_denied)throw Error(agentResult.error);
   const complete=await call('complete_edit');assert.ok(complete.ready,JSON.stringify(complete));return {text:agentResult.permission_denied?'Review declined; no markers added.':'Applied two reviewed AI chapter markers.'};
  };
  for(const apply of [true,false]){
   await click('button[aria-label="Close settings"]');await open(base('agent-ai-'+apply),'codex-sdk');await click('button[aria-label="Close settings"]');
   await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');await wait(100);
   reviewResolve=null;
   await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Use the AI chapter markers plugin to suggest two chapters from my captions.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await untilHost(()=>!!reviewResolve);
   check(`CraftAI ${apply?'apply':'discard'}: review precedes all document edits`,await q('window.__fve.rawProject().markers.length===0'));
   await review(apply);await until('!document.querySelector("button[aria-label=Stop]")');await wait(200);
   check(`CraftAI ${apply?'apply':'discard'}: agent reports actual host result`,apply?agentResult.markers_added===2&&agentResult.changed:agentResult.permission_denied&&!agentResult.changed);
   check(`CraftAI ${apply?'apply':'discard'}: Undo history matches accepted changes`,await q(`window.__fve.rawProject().markers.length===${apply?2:0}&&window.__fve.history().past.length===${apply?1:0}`));
   if(apply){fs.writeFileSync(path.join(dir,'agent-applied.png'),(await win.capturePage()).toPNG());await q('window.__fve.dispatch({type:"undo"})');await wait(80);check('one agent Undo removes reviewed AI markers',await q('window.__fve.rawProject().markers.length===0'));}
   // Reopen Settings so the shared setup can start the next isolated project.
   await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');
  }
  check('no renderer exceptions',!result.errors.length);result.ok=true;
 }catch(error){result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>'');fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 finally{ai.chat=original.chat;dialog.showMessageBox=original.dialog;local.runEditorNative=original.run;local.status=original.status;ai.listModels=original.models;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,error:result.error,checks:result.checks,dir}));app.exit(result.ok?0:1);
};
