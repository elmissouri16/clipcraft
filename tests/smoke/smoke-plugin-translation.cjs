const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),ai=require('../../electron/agents/ai.cjs'),settings=require('../../electron/system/settings.cjs'),local=require('../../electron/agents/localAgents.cjs');
 const original={chat:ai.chat,permission:dialog.showMessageBox,save:dialog.showSaveDialog,run:local.runEditorNative,status:local.status,models:ai.listModels};
 const result={ok:false,checks:[],errors:[],consents:[],requests:[]},q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(js,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(40);}throw Error('Timeout: '+js);};
 const untilHost=async fn=>{for(let i=0;i<600;i++){if(fn())return;await wait(20);}throw Error('Host fixture timeout');};
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);},click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 let mode='normal',approved=true,resolveModel,aborted=0,sequence=0;
 const translated=[{index:0,text:'Hola mundo'},{index:1,text:'Siguiente tema'}];
 ai.chat=async(cfg,options)=>{
  result.requests.push({provider:cfg.provider,maxTokens:options.maxTokens,payload:JSON.parse(options.messages[0].content)});options.signal.addEventListener('abort',()=>aborted++);
  if(mode==='pending')return new Promise(resolve=>{resolveModel=resolve;});
  if(mode==='malformed')return JSON.stringify({translations:[{index:0,text:'Missing cue'}]});
  return JSON.stringify({translations:translated});
 };
 dialog.showMessageBox=async(_parent,options)=>{result.consents.push({detail:options.detail,defaultId:options.defaultId});return {response:approved?0:1};};
 const project=id=>({id,name:'Translation proof',ratio:'16:9',width:320,height:180,fps:24,media:[],videoClips:[{id:'gap',gap:true,in:0,out:10}],overlayClips:[],audioClips:[],effectClips:[],markers:[],layers:{text:2},layerNames:{text:{0:'First captions',1:'English captions'}},layerState:{'text:1':{locked:true}},textClips:[
  {id:'private',caption:true,layer:0,start:0,duration:2,text:'PRIVATE_OTHER_TRACK'},
  {id:'a',caption:true,layer:1,start:0,duration:2,text:'Hello world',words:[{text:'Hello',start:0,end:1},{text:'world',start:1,end:2}],word_timing:'measured'},
  {id:'b',caption:true,layer:1,start:4,duration:2,text:'Next topic',word_timing:'edited'},
 ]});
 const open=async(p=project('translation-'+(++sequence)),provider='ollama')=>{
  settings.save({provider,model:'fixture',subagents:false});await q(`window.__fve.load(${JSON.stringify(p)})`);await wait(100);
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('[data-section=plugins]');
  await until('[...document.querySelectorAll(".plugin-row")].some(e=>e.textContent.includes("Caption translation"))');
  await q('[...document.querySelectorAll(".plugin-row")].find(e=>e.textContent.includes("Caption translation")).click()');await until('!!document.querySelector("[data-plugin-command=translate-captions] > button")');
 };
 const setInput=async(value)=>{
  await q(`(()=>{const el=document.querySelector('[aria-label="Source Text track value"]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(50);
  await q(`document.querySelector('[aria-label="Source Text track value"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);await wait(60);
 };
 const chooseSpanish=async()=>{await q(`document.querySelector(${JSON.stringify('button[aria-label="Target language"]')}).scrollIntoView({block:'center'})`);await wait(100);await click('button[aria-label="Target language"]');await until('!!document.querySelector(".dropdown-list")');await q('[...document.querySelectorAll("[role=option]")].find(e=>e.textContent.trim()==="Spanish").click()');};
 const run=async()=>{resolveModel=null;await click('[data-plugin-command=translate-captions] > button');};
 const review=()=>until('!!document.querySelector(".plugin-translation-review")');
 const phase=p=>until(`!!document.querySelector('.plugin-command-status[data-phase=${p}]')`);
 const accept=()=>click('.plugin-translation-review .btn-primary'),discard=()=>click('.plugin-translation-review .btn-ghost');
 const sandboxExists=()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('clipcraft-command:'));
 win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);settings.setFirstRun({tourSeen:true,packPromptSeen:true});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  await q('window.__translationReviewEvents=[];window.api.onPluginTranslationReview(e=>window.__translationReviewEvents.push(e));void 0');
  await open();check('dev loads translation example without model execution',result.requests.length===0);
  check('language parameter renders the native editor dropdown',await q(`document.querySelector(${JSON.stringify('button[aria-label="Target language"]')}).textContent.includes('French')`));
  await chooseSpanish();await setInput(2);const before=await q('JSON.stringify(window.__fve.rawProject().textClips)');await run();await review();await wait(100);
  check('selected enum and source track reach the fixed AI service',result.requests[0].payload.target_language==='Spanish'&&result.requests[0].payload.captions.length===2&&!JSON.stringify(result.requests[0].payload).includes('PRIVATE_'));
  check('translation generation has bounded output',result.requests[0].maxTokens===8192);
  check('sharing consent names source, target language and amount',result.consents[0].defaultId===1&&result.consents[0].detail.includes('Translation: Spanish. Source Text track: 2.')&&result.consents[0].detail.includes('2 cues'));
  check('real review shows original and translated text with unchanged cue times',await q('document.querySelector(".plugin-translation-review").textContent.includes("Hello world")&&document.querySelector(".plugin-translation-review").textContent.includes("Hola mundo")&&document.querySelector(".plugin-translation-review").textContent.includes("00:04.00–00:06.00")'));
  check('Discard is focused and no edits precede review',await q('document.activeElement.textContent==="Discard"&&window.__fve.rawProject().textClips.length===3&&window.__fve.history().past.length===0'));
  check('sandbox stops before host review',!sandboxExists());
  check('forged review IDs cannot approve the proposal',await q('(async()=>{try{await window.api.pluginsAnswerTranslationReview({id:"forged",accept:true});return false;}catch{return true;}})()'));
  await wait(180);fs.writeFileSync(path.join(dir,'translation-review.png'),(await win.capturePage()).toPNG());await accept();await phase('completed');
  const applied=await q('window.__fve.rawProject()'),captions=applied.textClips.filter(c=>c.source==='plugin-translation'),ids=captions.map(c=>c.id);
  check('Apply creates a separate named hidden caption track',captions.length===2&&applied.layers.text===3&&applied.layerNames.text[2]==='Captions · Spanish'&&applied.layerState['text:2'].hidden);
  check('all original captions, measured word timings and locks are preserved',JSON.stringify(applied.textClips.filter(c=>c.source!=='plugin-translation'))===before&&applied.layerState['text:1'].locked);
  check('translated cues have exact times and do not inherit measured words',JSON.stringify(captions.map(c=>[c.start,c.duration,c.text]))===JSON.stringify([[0,2,'Hola mundo'],[4,2,'Siguiente tema']])&&captions.every(c=>!c.words&&c.word_timing==='unavailable'&&c.language==='es'));
  check('new track is one Undo step',await q('window.__fve.history().past.length===1'));
  await q('window.__fve.dispatch({type:"undo"})');await wait(80);check('one Undo removes the translated track and its initial visibility state',await q('window.__fve.rawProject().textClips.length===3&&window.__fve.rawProject().layers.text===2&&!window.__fve.rawProject().layerState["text:2"]'));
  await q('window.__fve.dispatch({type:"redo"})');await wait(80);check('one Redo restores the hidden track',await q('window.__fve.rawProject().textClips.length===5&&window.__fve.rawProject().layerState["text:2"].hidden'));
  const saved=path.join(dir,'translation.clipcraft.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});await q('window.api.saveProject(JSON.stringify(window.__fve.rawProject()),null,{chat:null})');
  const reopened=await q(`window.api.openProjectPath(${JSON.stringify(saved)})`);check('real project save/reopen preserves translated text, timings, language and hidden track',!reopened.error&&JSON.parse(fs.readFileSync(saved,'utf8')).textClips.some(c=>c.source==='plugin-translation'&&c.text==='Hola mundo'&&c.language==='es'));
  await click('button[aria-label="Close settings"]');await until(`!!document.querySelector(${JSON.stringify('button[aria-label="Show layer Captions · Spanish"]')})`);await click('button[aria-label="Show layer Captions · Spanish"]');
  check('existing Timeline eye control can show the translation',await q('!window.__fve.rawProject().layerState["text:2"]?.hidden'));
  const srt=path.join(dir,'translation.srt');
  const exported=await q(`(async()=>{const {createToolRunner}=await import('/src/features/agent/tools.js');const runner=createToolRunner({api:window.api,getProject:()=>window.__fve.rawProject(),dispatch:window.__fve.dispatch,settle:async()=>{}});return runner.run('export_subtitles',{clip_ids:${JSON.stringify(ids)},file_path:${JSON.stringify(srt)}});})()`);
  check('visible translated captions export through the real subtitle service',!exported.error&&fs.readFileSync(srt,'utf8').includes('Hola mundo')&&fs.readFileSync(srt,'utf8').includes('00:00:04,000 --> 00:00:06,000'));
  await open();await setInput(2);await run();await review();const reviewId=await q('window.__translationReviewEvents.filter(e=>!e.closed).at(-1).id');await discard();await phase('denied');
  check('Discard and replayed review responses cannot edit',await q('(async()=>{try{await window.api.pluginsAnswerTranslationReview({id:'+JSON.stringify(reviewId)+',accept:true});return false;}catch{return window.__fve.rawProject().textClips.length===3&&window.__fve.history().past.length===0;}})()'));
  approved=false;const requestsBefore=result.requests.length;await run();await phase('denied');approved=true;check('sharing refusal never generates a translation',result.requests.length===requestsBefore);
  mode='malformed';await run();await phase('failed');check('missing translated cues fail without partial writes or retry',result.requests.length===requestsBefore+1&&await q('window.__fve.rawProject().textClips.length===3'));mode='normal';
  for(const reason of ['cancel','manual','disable','timeout']){
   await click('button[aria-label="Close settings"]');await open();await setInput(2);mode='pending';const priorAbort=aborted;await run();await untilHost(()=>!!resolveModel);
   if(reason==='cancel')await click('.plugin-command-status button');
   if(reason==='manual')await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual edit survives"}})');
   if(reason==='disable')await q('(async()=>{const row=(await window.api.pluginsList()).find(r=>r.manifest?.id==="clipcraft-examples.caption-translation");await window.api.pluginsEnable(row.key,false);})()');
   await phase(reason==='manual'||reason==='timeout'?'failed':'canceled');await untilHost(()=>aborted>priorAbort);resolveModel(JSON.stringify({translations:translated}));await wait(80);
   check(`${reason}: abort reaches model and late results cannot add captions`,!sandboxExists()&&await q('window.__fve.rawProject().textClips.length===3'));
   if(reason==='manual')check('concurrent manual edit is retained',await q('window.__fve.rawProject().name==="Manual edit survives"'));
   if(reason==='disable')await q('(async()=>{const row=(await window.api.pluginsList()).find(r=>r.manifest?.id==="clipcraft-examples.caption-translation");await window.api.pluginsEnable(row.key,true);})()');
  }
  mode='normal';await click('button[aria-label="Close settings"]');const locked=project('locked-target');locked.layerState['text:2']={locked:true};await open(locked);await setInput(2);const beforeLock=result.requests.length;await run();await phase('failed');check('locked target is rejected before model access',result.requests.length===beforeLock&&await q('window.__fve.rawProject().textClips.length===3'));
  await click('button[aria-label="Close settings"]');await open();await setInput(2);await run();await review();await q('window.__fve.dispatch({type:"setProject",patch:{name:"Changed during review"}})');await until('!document.querySelector(".plugin-translation-review")');check('stale project cancels the pending review',await q('window.__fve.rawProject().textClips.length===3'));
  local.status=async()=>({ok:true,authenticated:true,version:'fixture'});ai.listModels=async()=>({ok:true,models:['fixture']});let agentResult;
  local.runEditorNative=async(_cfg,options)=>{
   const call=async(name,args={})=>JSON.parse((await options.onTool(name,args)).content[0].text);
   const list=await call('list_plugin_commands',{query:'Caption translation'}),command=list.commands.find(c=>c.plugin_id==='clipcraft-examples.caption-translation');
   agentResult=await call('run_plugin_command',{key:command.key,command_id:command.command_id,input:[{id:'language',choice:'es'},{id:'source_track',value:2}]});
   if(agentResult.error&&!agentResult.permission_denied)throw Error(agentResult.error);const done=await call('complete_edit');assert.ok(done.ready,JSON.stringify(done));return {text:agentResult.permission_denied?'Caption translation discarded.':'Created a hidden Spanish caption track. Use its Timeline eye control to show it.'};
  };
  for(const apply of [true,false]){
   await click('button[aria-label="Close settings"]');await open(project('agent-translation-'+apply),'codex-sdk');await click('button[aria-label="Close settings"]');await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');await wait(100);
   await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Use the caption translation plugin to translate Text track 2 to Spanish.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await review();
   check(`CraftAI ${apply?'apply':'discard'} waits for user review`,await q('window.__fve.rawProject().textClips.length===3'));
   await (apply?accept():discard());await until('!document.querySelector("button[aria-label=Stop]")');await wait(220);
   check(`CraftAI ${apply?'apply':'discard'} reports the actual caption result`,apply?agentResult.captions_added===2&&agentResult.caption_track===3&&agentResult.changed:agentResult.permission_denied&&!agentResult.changed);
   check(`CraftAI ${apply?'apply':'discard'} preserves one-step Undo semantics`,await q(`window.__fve.rawProject().textClips.length===${apply?5:3}&&window.__fve.history().past.length===${apply?1:0}`));
   if(apply)fs.writeFileSync(path.join(dir,'agent-translation.png'),(await win.capturePage()).toPNG());
   await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');
  }
  await click('button[aria-label="Close settings"]');await q('(async()=>{const row=(await window.api.pluginsList()).find(r=>r.manifest?.id==="clipcraft-examples.caption-translation");await window.api.pluginsRemove(row.key);})()');await q(`window.__fve.load(${fs.readFileSync(saved,'utf8')})`);await wait(100);
  check('saved translated captions reopen after plugin removal',await q('window.__fve.rawProject().textClips.filter(c=>c.source==="plugin-translation").length===2'));
  check('no renderer exceptions',!result.errors.length);result.ok=true;
 }catch(error){result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>'');fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 finally{ai.chat=original.chat;dialog.showMessageBox=original.permission;dialog.showSaveDialog=original.save;local.runEditorNative=original.run;local.status=original.status;ai.listModels=original.models;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,error:result.error,checks:result.checks,dir}));app.exit(result.ok?0:1);
};
