const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),ff=require('../../electron/media/ffmpeg.cjs'),settings=require('../../electron/system/settings.cjs'),local=require('../../electron/agents/localAgents.cjs'),ai=require('../../electron/agents/ai.cjs');
 const original={permission:dialog.showMessageBox,save:dialog.showSaveDialog,open:dialog.showOpenDialog,run:local.runEditorNative,status:local.status,models:ai.listModels};
 const result={ok:false,checks:[],measurements:[],errors:[],consents:[]},q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(s,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(s))return;await wait(40);}throw Error('Timeout '+s);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 let selected=path.join(dir,'composition.gif'),approved=true,picker=null;
 dialog.showMessageBox=async(_parent,options)=>{result.consents.push(options);return {response:approved?0:1};};
 dialog.showSaveDialog=async()=>picker?new Promise(resolve=>{picker.resolve=resolve;}):({canceled:false,filePath:selected});
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 const run=()=>click('[data-plugin-command=export-gif] > button');
 const phase=p=>until(`!!document.querySelector('.plugin-command-status[data-phase=${p}]')`);
 const exportPanel=async()=>{await click('.btn-export');await until(`!!document.querySelector(${JSON.stringify('button[aria-label="Export type"]')})`);await click('button[aria-label="Export type"]');await until('!!document.querySelector(".dropdown-list")');await q('[...document.querySelectorAll("[role=option]")].find(e=>e.textContent.trim()==="GIF export").click()');await until('!!document.querySelector("[data-plugin-command=export-gif]")');};
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const inventory=await q('window.api.pluginsList()'),gif=inventory.find(r=>r.manifest?.id==='clipcraft.gif-export');check('development loads GIF example without execution',!!gif?.enabled&&!fs.existsSync(selected));
  const a=path.join(dir,'a.mp4'),b=path.join(dir,'b.png');
  execFileSync(ff.ffmpegPath,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=20:d=1','-an','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',a]);
  execFileSync(ff.ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1','-threads','1',b]);
  const project={id:'gif-proof',name:'GIF composition',width:320,height:180,ratio:'16:9',fps:20,background:'#111111',media:[{...await ff.probe(a),id:'a',path:a,name:'Moving pattern'},{...await ff.probe(b),id:'b',path:b,name:'Blue'}],videoClips:[{id:'a',mediaId:'a',in:0,out:1,speed:1,effects:[]},{id:'b',mediaId:'b',in:0,out:1,speed:1,effects:[],transition:{type:'fade',duration:0.5}}],overlayClips:[],audioClips:[],effectClips:[],textClips:[{id:'caption',caption:true,layer:0,start:0,duration:2,text:'GIF proof',size:24,color:'#ffffff',x:0.5,y:0.8}],markers:[]};
  await q(`window.__fve.load(${JSON.stringify(project)})`);await wait(150);await exportPanel();
  check('Export dialog presents range, size and frame-rate controls',await q(`!!document.querySelector(${JSON.stringify('[aria-label="Start (seconds) value"]')})&&!!document.querySelector(${JSON.stringify('button[aria-label="Frame rate"]')})`));
  const baseline=await q('JSON.stringify(window.__fve.rawProject().videoClips)');await run();await phase('completed');
  check('GIF created through actual Export dialog',fs.existsSync(selected));
  check('native approval resolves bounded settings with Cancel default',result.consents[0].defaultId===1&&result.consents[0].detail.includes('320×180')&&result.consents[0].detail.includes('15 frames'));
  check('completion offers actual artifact metadata and file actions',await q('document.querySelector(".plugin-export-artifact").textContent.includes("320×180")&&document.querySelector(".plugin-export-artifact").textContent.includes("Open file")'));
  check('export preserves timeline and Undo',await q(`JSON.stringify(window.__fve.rawProject().videoClips)===${JSON.stringify(baseline)}&&window.__fve.history().past.length===0`));
  check('worker and hidden renderer are disposed',!BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('clipcraft-command:')||(w!==win&&w.webContents.getURL().startsWith(process.env.VITE_DEV_SERVER_URL))));
  const info=JSON.parse(execFileSync(ff.ffprobePath,['-v','error','-ignore_loop','1','-i',selected,'-count_frames','-show_streams','-show_format','-of','json']));result.artifact={file:selected,bytes:fs.statSync(selected).size,frames:Number(info.streams[0].nb_read_frames),duration:Number(info.format.duration),width:info.streams[0].width,height:info.streams[0].height};
  check('file has exact GIF format, geometry, duration and frame count',info.format.format_name==='gif'&&result.artifact.frames===15&&result.artifact.duration===1.5&&result.artifact.width===320&&result.artifact.height===180);
  execFileSync(ff.ffmpegPath,['-v','error','-xerror','-ignore_loop','1','-i',selected,'-f','null','-']);check('entire saved GIF decodes without errors',true);
  for(const time of [0,0.4,0.8,1.1]){
   const cover=await q(`window.api.exportCoverFrame(window.__fve.rawProject(),${time})`);assert.ok(cover.ok,JSON.stringify(cover));
   const reference=execFileSync(ff.ffmpegPath,['-v','error','-i',cover.path,'-vf','scale=320:180','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
   const actual=execFileSync(ff.ffmpegPath,['-v','error','-ignore_loop','1','-ss',String(time),'-i',selected,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);let error=0;
   assert.equal(actual.length,reference.length);for(let i=0;i<actual.length;i++)error+=Math.abs(actual[i]-reference[i]);error/=actual.length;
   result.measurements.push({time,meanAbsoluteRgbError:error,tolerance:10});check('composition/animation/transition parity at '+time,error<10);
  }
  fs.writeFileSync(path.join(dir,'gif-export.png'),(await win.capturePage()).toPNG());
  await run();await phase('failed');check('existing destination is protected',await q('document.querySelector(".plugin-command-status").textContent.includes("already exists")'));
  selected=path.join(dir,'declined.gif');approved=false;await run();await phase('denied');check('permission refusal writes nothing',!fs.existsSync(selected));approved=true;
  selected=path.join(dir,'canceled.gif');picker={};await run();for(let i=0;i<500&&!picker.resolve;i++)await wait(10);assert.ok(picker.resolve);await q('document.querySelector(".plugin-command-status button").click()');await phase('canceled');picker.resolve({canceled:false,filePath:selected});picker=null;await wait(150);check('cancel during native destination choice ignores late answer',!fs.existsSync(selected));
  selected=path.join(dir,'render-canceled.gif');await run();await until('document.querySelector(".plugin-command-status")?.textContent.includes("Rendering GIF frame")');await q('document.querySelector(".plugin-command-status button").click()');await phase('canceled');await wait(250);check('cancel during frame rendering leaves no file or renderer',!fs.existsSync(selected)&&!BrowserWindow.getAllWindows().some(w=>(w!==win&&w.webContents.getURL().startsWith(process.env.VITE_DEV_SERVER_URL))));
  selected=path.join(dir,'revoked.gif');await run();await until('document.querySelector(".plugin-command-status")?.textContent.includes("Rendering GIF frame")');await q(`window.api.pluginsEnable(${JSON.stringify(gif.key)},false)`);await wait(250);check('package revocation interrupts rendering without publication',!fs.existsSync(selected));await q(`window.api.pluginsEnable(${JSON.stringify(gif.key)},true)`);await until('!!document.querySelector("[data-plugin-command=export-gif]")');
  selected=path.join(dir,'stale.gif');picker={};await run();for(let i=0;i<500&&!picker.resolve;i++)await wait(10);assert.ok(picker.resolve);await q('window.__fve.dispatch({type:"setProject",patch:{name:"Concurrent edit retained"}})');await wait(100);picker.resolve({canceled:false,filePath:selected});picker=null;await wait(200);check('document edits prevent late file creation',!fs.existsSync(selected));
  await click('.export-modal .x-head button');await until('!document.querySelector(".export-modal")');
  const withEffect=structuredClone(project),definition=(await q('window.api.pluginEffects()')).find(e=>e.pluginId==='clipcraft-examples.color-pulse'),effectId=`plugin:${definition.contributionId}@${definition.digest}`;
  withEffect.videoClips[0].effects=[effectId];withEffect.videoClips[0].pluginEffects={[effectId]:{pluginId:definition.pluginId,contributionId:definition.contributionId,version:definition.version,digest:definition.digest,name:definition.name,params:Object.fromEntries(definition.parameters.map(p=>[p.id,p.default]))}};
  const trustedRequest={runId:'gif-gpu-fixture',key:gif.key,commandId:'export-gif',input:{start_sec:0,end_sec:1,max_size:'size-320',fps:'fps-20'},snapshot:{duration_sec:1.5,fps:20,markers:[],markers_total:0},exportProject:withEffect};
  selected=path.join(dir,'gpu-failed.gif');let injected=false,injectionError;
  const inject=(_event,created)=>created.webContents.once('did-finish-load',()=>{
    if(!created.webContents.getURL().startsWith(process.env.VITE_DEV_SERVER_URL))return;
    injected=true;created.webContents.executeJavaScript(`(async()=>{const {FxGL}=await import('/src/features/effects/gl.js');FxGL.prototype.effects=()=>{throw Error('Fixture GPU failure');};})()`).catch(error=>{injectionError=String(error);});
  });
  app.on('browser-window-created',inject);
  let gpuResult;try{gpuResult=await q(`window.api.pluginsRunCommand(${JSON.stringify(trustedRequest)})`);}finally{app.removeListener('browser-window-created',inject);}
  check('GPU rendering failure cannot publish a fallback GIF',injected&&!injectionError&&gpuResult.status==='failed'&&!fs.existsSync(selected));
  // Agent uses the same installed command and receives the host artifact, without document writes.
  selected=path.join(dir,'agent.gif');let agentResult;
  local.status=async()=>({ok:true,authenticated:true,version:'fixture'});ai.listModels=async()=>({ok:true,models:['fixture']});
  local.runEditorNative=async(_cfg,options)=>{const call=async(name,args={})=>JSON.parse((await options.onTool(name,args)).content[0].text);const discovered=await call('list_plugin_commands',{query:'GIF export'}),command=discovered.commands.find(c=>c.plugin_id==='clipcraft.gif-export');assert.ok(command);agentResult=await call('run_plugin_command',{key:command.key,command_id:command.command_id,input:[{id:'start_sec',value:0.5},{id:'end_sec',value:1},{id:'fps',choice:'fps-5'},{id:'max_size',choice:'size-320'}]});assert.ok(agentResult.artifact,JSON.stringify(agentResult));const complete=await call('complete_edit');assert.ok(complete.ready,JSON.stringify(complete));return {text:'Saved the verified GIF.'};};
  settings.save({provider:'codex-sdk',model:'fixture',subagents:false});await q(`window.__fve.load(${JSON.stringify({...project,id:'gif-agent-proof',width:1080,height:1920,ratio:'9:16'})})`);await wait(150);
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('button[aria-label="Close settings"]');await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');
  await q(`(()=>{const e=document.querySelector('.pilot-input textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Export a GIF using the installed GIF export plugin.');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")');await until('!document.querySelector("button[aria-label=Stop]")',60000);
  result.agentArtifact=agentResult?.artifact;
  check('CraftAI returns host-verified GIF artifact and no edit claim',agentResult?.artifact?.width===180&&agentResult?.artifact?.height===320&&agentResult?.artifact?.frame_count===3&&agentResult?.artifact?.duration_sec===0.6&&agentResult.changed===false&&fs.existsSync(selected));
  check('CraftAI GIF export does not add an Undo entry',await q('window.__fve.history().past.length===0'));
  check('no renderer exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.error=error.stack;console.error(error);}
 finally{dialog.showMessageBox=original.permission;dialog.showSaveDialog=original.save;dialog.showOpenDialog=original.open;local.runEditorNative=original.run;local.status=original.status;ai.listModels=original.models;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
