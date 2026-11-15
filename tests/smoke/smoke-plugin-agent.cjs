// Actual CraftAI UI/tool loop + real sandbox; provider replies and native dialog choices are fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),local=require('../../electron/agents/localAgents.cjs'),ai=require('../../electron/agents/ai.cjs'),settings=require('../../electron/system/settings.cjs');
 const original={run:local.runEditorNative,status:local.status,models:ai.listModels,step:ai.agentStep,dialog:dialog.showMessageBox,open:dialog.showOpenDialog};
 const q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms)),result={checks:[],errors:[],prompts:[],runs:[],ok:false};
 const until=async(js,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(40);}throw Error('Timeout: '+js);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const parse=value=>JSON.parse(value.content[0].text);
 let mode='normal',provider='codex-sdk',approved=true,resolvePrompt,plan=[];
 dialog.showMessageBox=async(_parent,options)=>{
  result.prompts.push({message:options.message,detail:options.detail,defaultId:options.defaultId});
  if(mode==='approval-stop')return new Promise(resolve=>{resolvePrompt=resolve;});
  return {response:approved?0:1};
 };
 local.status=async()=>({ok:true,authenticated:true,version:'plugin-fixture'});ai.listModels=async()=>({ok:true,models:['fixture-model']});
 local.runEditorNative=async(_cfg,options)=>{
  const call=async(name,args={})=>parse(await options.onTool(name,args));
  check(`${provider}/${mode}: native tools include command discovery and execution`,['list_plugin_commands','run_plugin_command'].every(name=>options.tools.some(t=>t.name===name)));
  const discovered=await call('list_plugin_commands',{query:mode.startsWith('slow')?'Agent command fixture':'Chapter markers'});
  assert.ok(!discovered.error,JSON.stringify(discovered));const command=discovered.commands.find(c=>c.plugin_id===(mode.startsWith('slow')?'clipcraft-tests.agent-command':'clipcraft-examples.chapter-markers'));assert.ok(command,'command discovered');
  const args={key:command.key,command_id:command.command_id,input:[{id:'count',value:4}]};
  const run=await call('run_plugin_command',args);result.runs.push({provider,mode,result:run});
  if(mode==='denied'){
   check('denial is reported as unchanged without unresolved edit debt',run.permission_denied&&run.not_applicable&&!run.changed);
   const repeat=await call('run_plugin_command',args);check('same request cannot prompt again after denial',repeat.permission_denied);
  }else if(mode.startsWith('slow')||mode==='approval-stop')return {text:'Command interrupted.'};
  else check(`${provider}: actual plugin result contains four applied markers`,run.markers_added===4&&run.changed&&!run.error);
  const complete=await call('complete_edit');assert.ok(complete.ready,JSON.stringify(complete));return {text:mode==='denied'?'Plugin permission declined.':'Added four chapter markers with the installed plugin.'};
 };
 const reply=(calls,text='')=>({calls,text,content:{role:'model',parts:[...calls.map(functionCall=>({functionCall})),...(text?[{text}]:[])]}});
 ai.agentStep=async(_cfg,req)=>{
  const next=plan.shift();assert.ok(next,'API fixture plan remains');return next(req);
 };
 const project=id=>({id,name:'Plugin command agent proof',ratio:'16:9',width:320,height:180,fps:24,media:[],videoClips:[{id:'gap',gap:true,in:0,out:10}],overlayClips:[],audioClips:[],textClips:[],effectClips:[],markers:[]});
 const load=async id=>{
  settings.save({provider,model:'fixture-model',subagents:false});
  await q(`window.__fve.load(${JSON.stringify(project(id))})`);await wait(100);
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('button[aria-label="Close settings"]');
  await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');await wait(100);
 };
 const send=async()=>{
  await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Use the installed chapter marker plugin to add four chapter markers.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")');
 };
 const done=()=>until('!document.querySelector("button[aria-label=Stop]")');
 win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);settings.setFirstRun({tourSeen:true,packPromptSeen:true});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  for(const native of ['codex-sdk','claude-agent-sdk','opencode-sdk']){
   provider=native;mode='normal';await load('plugin-agent-'+provider);const prompts=result.prompts.length;await send();await done();
   check(`${provider}: actual timeline receives expected markers`,await q('JSON.stringify(window.__fve.rawProject().markers.map(m=>m.time))===JSON.stringify([0,2.5,5,7.5])'));
   check(`${provider}: native approval is fresh and defaults to Cancel`,result.prompts.length===prompts+1&&result.prompts.at(-1).defaultId===1&&result.prompts.at(-1).detail.includes('Add timeline markers'));
   check(`${provider}: command participates in the agent Undo transaction`,await q('window.__fve.history().past.length===1&&!window.__fve.history().agentEdit'));
   check(`${provider}: activity reports the host marker count`,await q('[...document.querySelectorAll("[data-tool-icon=run_plugin_command]")].length===1&&document.body.textContent.includes("Added 4 markers.")'));
   await until('!document.querySelector(".tl-agent-status")');
   await q('document.querySelector("[data-tool-icon=run_plugin_command]").closest(".pilot-activity").scrollIntoView({block:"center"})');
   await wait(200);
   fs.writeFileSync(path.join(dir,provider+'-completed.png'),(await win.capturePage()).toPNG());
   await q('window.__fve.dispatch({type:"undo"})');await wait(80);check(`${provider}: one Undo removes all command markers`,await q('window.__fve.rawProject().markers.length===0'));
   await q('window.__fve.dispatch({type:"redo"})');await wait(80);check(`${provider}: one Redo restores them`,await q('window.__fve.rawProject().markers.length===4'));
  }
  provider='ollama';mode='api';await load('plugin-agent-api');
  let selected;
  plan=[
   req=>{check('API loop starts with core command discovery',req.tools.some(t=>t.name==='list_plugin_commands')&&!req.tools.some(t=>t.name==='run_plugin_command'));return reply([{name:'list_plugin_commands',args:{query:'Chapter markers'}},{name:'load_tools',args:{groups:['plugins']}}]);},
   req=>{selected=req.contents.flatMap(turn=>turn.parts||[]).find(part=>part.functionResponse?.name==='list_plugin_commands').functionResponse.response.result.commands.find(c=>c.plugin_id==='clipcraft-examples.chapter-markers');check('API loop loads command execution schema',req.tools.some(t=>t.name==='run_plugin_command'));return reply([{name:'run_plugin_command',args:{key:selected.key,command_id:selected.command_id,input:[{id:'count',value:4}]}}]);},
   req=>{const applied=req.contents.flatMap(turn=>turn.parts||[]).find(part=>part.functionResponse?.name==='run_plugin_command').functionResponse.response.result;check('API loop receives actual committed marker count',applied.markers_added===4&&applied.changed);return reply([],'Added four chapter markers with the installed plugin.');},
  ];
  await send();await done();check('API agent applies command with one Undo step',await q('window.__fve.rawProject().markers.length===4&&window.__fve.history().past.length===1'));
  provider='codex-sdk';mode='denied';approved=false;await load('plugin-agent-denial');const beforeDenial=result.prompts.length;await send();await done();
  check('native permission refusal prompts only once and leaves document/Undo unchanged',result.prompts.length===beforeDenial+1&&await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));approved=true;
  // Install one slow original fixture through Settings, using the normal package path and runtime.
  const folder=path.join(dir,'command-fixture');fs.mkdirSync(folder);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../../examples/plugins/chapter-markers/plugin.json')));
  fixture.id='clipcraft-tests.agent-command';fixture.name='Agent command fixture';fixture.contributes.commands[0].id='slow-command';
  fs.writeFileSync(path.join(folder,'plugin.json'),JSON.stringify(fixture));fs.writeFileSync(path.join(folder,'commands.js'),`export async function run(ctx){await ctx.project.read();await ctx.markers.add([{time:1,label:'Staged'}]);await ctx.progress(.25,'Waiting fixture');await new Promise(r=>setTimeout(r,2000));return {message:'Ready'};}`);
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('[data-section=plugins]');await until('!!document.querySelector(".plugin-settings")');
  await q('document.querySelector(".plugin-settings input[type=checkbox]").click()');
  await until('[...document.querySelectorAll(".plugin-settings button")].some(e=>e.textContent.includes("folder")&&!e.disabled)');
  await q('[...document.querySelectorAll(".plugin-settings button")].find(e=>e.textContent.includes("folder")).click()');
  await until('[...document.querySelectorAll(".plugin-row")].some(e=>e.textContent.includes("Agent command fixture"))');await click('button[aria-label="Close settings"]');
  for(const interrupt of ['stop','manual','disable']){
   mode='slow-'+interrupt;await load('plugin-agent-'+mode);await send();await until('document.body.textContent.includes("Waiting fixture")');
   check(`${interrupt}: real sandbox is running with activity progress`,BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('clipcraft-command:')));
   if(interrupt==='stop')await click('button[aria-label=Stop]');
   if(interrupt==='manual')await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual edit retained"}})');
   if(interrupt==='disable')await q('(async()=>{const row=(await window.api.pluginsList()).find(r=>r.manifest?.id==="clipcraft-tests.agent-command");await window.api.pluginsEnable(row.key,false);})()');
   await done();await wait(150);
   check(`${interrupt}: staged markers were discarded`,await q('window.__fve.rawProject().markers.length===0'));
   check(`${interrupt}: command sandbox was disposed`,!BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('clipcraft-command:')));
   if(interrupt==='manual')check('concurrent manual edit survives',await q('window.__fve.rawProject().name==="Manual edit retained"'));
  }
  mode='approval-stop';await load('plugin-agent-approval-stop');resolvePrompt=null;await send();for(let i=0;i<300&&!resolvePrompt;i++)await wait(20);assert.ok(resolvePrompt);
  await click('button[aria-label=Stop]');await done();resolvePrompt({response:0});await wait(120);
  check('Stop during pending permission cannot launch a late-approved command',await q('window.__fve.rawProject().markers.length===0')&&!BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('clipcraft-command:')));
  check('no renderer exceptions',!result.errors.length);result.ok=true;
 }catch(error){result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>'');fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 finally{local.runEditorNative=original.run;local.status=original.status;ai.listModels=original.models;ai.agentStep=original.step;dialog.showMessageBox=original.dialog;dialog.showOpenDialog=original.open;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,error:result.error,checks:result.checks,dir}));app.exit(result.ok?0:1);
};
