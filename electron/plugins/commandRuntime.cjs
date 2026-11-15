const path=require('node:path'),crypto=require('node:crypto');
const {serveCommandProtocol,COMMAND_URL,COMMAND_SCRIPT_URL}=require('./commandProtocol.cjs');
const {markCommandSender}=require('./ipcGuard.cjs');
const schema=import('../../shared/pluginCommands.mjs');
const editorSchema=import('../../shared/pluginEditor.mjs');
const editSchema=import('../../shared/pluginEdits.mjs');
const aiSchema=import('../../shared/pluginAi.mjs');
const DIR=__dirname,MAX_BYTES=256*1024;
const plainText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const bounded=value=>{const encoded=JSON.stringify(value);if(!encoded||Buffer.byteLength(encoded)>MAX_BYTES)throw Error('Command protocol payload exceeds 256 KiB.');};
class CommandRuntime {
 constructor({ipcMain,BrowserWindow,session,manager,getWindow,timeoutMs=15000,aiTimeoutMs=90000,sandboxEnabled=true,chapterService,review}){
  Object.assign(this,{BrowserWindow,session,manager,getWindow,timeoutMs,aiTimeoutMs,sandboxEnabled,review});this.active=null;this.jobs=new Map();this.editCommits=new Map();
  this.chapterService=chapterService||require('./chapterService.cjs').createChapterService();
  const owned=(event,token)=>{
   const job=this.jobs.get(event.sender.id);
   if(!job||event.sender!==job.window.webContents||event.senderFrame!==job.window.webContents.mainFrame||token!==job.token)throw Error('Unknown command runtime or token.');
   return job;
  };
  ipcMain.handle('pluginRuntime:job',(event,sandboxed)=>{
   const job=this.jobs.get(event.sender.id);
   if(!job||event.sender!==job.window.webContents||event.senderFrame!==job.window.webContents.mainFrame||job.taken)throw Error('Unknown or already taken command job.');
   if(sandboxed!==true){this.finish(job,{status:'failed',error:'The command renderer is not sandboxed.'});throw Error('Command renderer is not sandboxed.');}
   job.taken=true;return {token:job.token,code:job.code,input:job.input,commandId:job.command.id,development:!!job.development};
  });
  ipcMain.handle('pluginRuntime:log',(event,token,value)=>{
   const job=owned(event,token);if(job.closed||!job.development||!value||Object.keys(value).some(k=>!['level','message'].includes(k))||!['debug','info','warning','error'].includes(value.level)||typeof value.message!=='string'||value.message.length>1000)return false;
   return this.manager.development?.record(job.key,value.level,value.message,'worker')||false;
  });
  ipcMain.handle('pluginRuntime:call',async(event,token,method,args)=>{
   const job=owned(event,token);try{bounded({method,args});if(++job.calls>64)throw Error('Command exceeded 64 broker requests.');
   if(this.active!==job||job.closed)throw Error('Command is no longer active.');
   if(method==='editor.read'){
    if(!job.permissions.includes('editor.read'))throw Error('Permission denied: editor.read');
    if(args!==null)throw Error('editor.read takes no arguments.');
    return job.editor;
   }
   if(method==='editor.stage'){
    if(!job.permissions.some(p=>['clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p)))throw Error('Permission denied: clip editing permission');
    if(job.edits||job.staging)throw Error('Only one clip transaction may be staged per run.');
    job.staging=true;
    const edits=(await editSchema).clipTransaction(args,job.editor,job.snapshot.duration_sec,job.permissions);
    if(this.active!==job||job.closed)throw Error('Command was canceled.');
    job.edits=edits;return {staged:edits.operations.length};
   }
   if(method==='project.read'){
    if(!job.permissions.includes('project.read'))throw Error('Permission denied: project.read');
    if(args!==null)throw Error('project.read takes no arguments.');
    return job.snapshot;
   }
   if(method==='markers.add'){
    if(!job.permissions.includes('markers.write'))throw Error('Permission denied: markers.write');
    const {commandMarkers}=await schema,markers=commandMarkers(args,job.snapshot.duration_sec);
    const limit=job.permissions.includes('ai.chapters')?20:500;
    if(job.markers.length+markers.length>limit)throw Error(`Command exceeded ${limit} staged markers.`);
    if(this.active!==job||job.closed)throw Error('Command was canceled.');
    job.markers.push(...markers);return {staged:markers.length};
   }
   if(method==='transcript.read'){
    if(!job.permissions.includes('captions.read'))throw Error('Permission denied: captions.read');
    if(args!==null)throw Error('transcript.read takes no arguments.');
    return job.captions;
   }
   if(method==='ai.chapters'){
    if(!job.permissions.includes('ai.chapters')||!job.permissions.includes('captions.read'))throw Error('Permission denied: ai.chapters');
    if(job.aiCalled)throw Error('Only one AI chapter request is allowed per run.');
    job.aiCalled=true;job.aiPending=true;
    let markers;
    try{markers=await job.chapterService.chapters(args,job.controller.signal);}finally{job.aiPending=false;}
    if(this.active!==job||job.closed)throw Error('Command was canceled.');
    return markers;
   }
   if(method==='ai.translateCaptions'){
    if(!job.permissions.includes('ai.translateCaptions'))throw Error('Permission denied: ai.translateCaptions');
    if(job.aiCalled)throw Error('Only one AI request is allowed per run.');
    job.aiCalled=true;job.aiPending=true;
    try{
      const translations=await job.chapterService.translateCaptions(args,job.controller.signal);
      if(this.active!==job||job.closed)throw Error('Command was canceled.');
      return translations;
    }finally{job.aiPending=false;}
   }
   if(method==='captions.addTranslation'){
    if(!job.permissions.includes('captions.write'))throw Error('Permission denied: captions.write');
    if(job.translation)throw Error('Only one translated caption track may be staged.');
    const {translationProposal}=await aiSchema;
    const proposal=translationProposal(args,job.captions,job.language);
    if(this.active!==job||job.closed)throw Error('Command was canceled.');
    job.translation=proposal;return {staged:proposal.translations.length};
   }
   if(method==='export.gif'){
    if(!job.permissions.includes('export.gif'))throw Error('Permission denied: export.gif');
    if(job.gifStaged)throw Error('Only one GIF job may be staged.');
    const plan=(await import('../../shared/pluginGif.mjs')).gifPlan(job.gifGeometry,args);
    if(JSON.stringify(plan)!==JSON.stringify(job.gifPlan))throw Error('GIF settings must match the settings approved for this run.');
    job.gifStaged=true;return {staged:true,...plan};
   }
   if(method==='progress'){
    if(!args||!Number.isFinite(args.fraction)||args.fraction<0||args.fraction>1||!plainText(args.message,80)||Object.keys(args).some(k=>!['fraction','message'].includes(k)))throw Error('Invalid command progress.');
    this.progress(job,{phase:'running',progress:args.fraction,message:args.message});return {ok:true};
   }
   throw Error('Unsupported command capability.');
   }catch(error){this.finish(job,{status:'failed',error:String(error.message).slice(0,2000)});throw error;}
  });
  ipcMain.handle('pluginRuntime:finish',async(event,token,result)=>{
   const job=owned(event,token);try{bounded(result);
   if(!result||typeof result.ok!=='boolean'||!plainText(result.message??'',1000)||!plainText(result.error??'',2000))throw Error('Invalid command completion.');
   if(result.ok)await this.complete(job,result.message||'');
   else this.finish(job,{status:'failed',error:result.error||'Command failed.'});
   return {ok:true};
   }catch(error){this.finish(job,{status:'failed',error:String(error.message).slice(0,2000)});throw error;}
  });
 }
 progress(job,update){if(job.phase!==update.phase){job.phase=update.phase;this.manager.development?.record(job.key,'info',`Command ${job.command?.id||''}: ${update.phase}`,'lifecycle');}const win=this.getWindow();if(win&&!win.isDestroyed())win.webContents.send('plugins:commandProgress',{runId:job.runId,...update});}
 async run(request,approve){
  const {exportProject,...protocol}=request||{};bounded(protocol);
  if(exportProject!==undefined&&Buffer.byteLength(JSON.stringify(exportProject))>8*1024*1024)throw Error('GIF composition exceeds 8 MiB.');
  if(!this.sandboxEnabled)throw Error('Executable plugins require Electron process sandboxing.');
  if(this.active)throw Error('Another plugin command is already running.');
  if(!request||Object.keys(request).some(k=>!['runId','key','commandId','input','snapshot','captions','exportProject','panelAction','editor'].includes(k))||typeof request.runId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(request.runId)||!/^[a-f0-9]{64}$/.test(request.key))throw Error('Invalid command request.');
  if(request.panelAction!==undefined)this.manager.panelRuntime.actions.bind(request);
  const job={runId:request.runId,key:request.key,closed:false,markers:[],calls:0,controller:new AbortController()};this.active=job;
  const interrupted=new Promise(resolve=>{job.interrupt=resolve;});
  job.interrupted=interrupted;
  job.owner=this.getWindow()?.webContents;job.ownerClosed=()=>this.finish(job,{status:'canceled'});
  for(const event of ['destroyed','render-process-gone','did-start-navigation'])job.owner?.on?.(event,job.ownerClosed);
  try{
   const {commandInput,commandSnapshot}=await schema;
   const bundle=await this.manager.commandBundle(request.key),command=bundle.manifest.contributes.commands.find(c=>c.id===request.commandId);
   if(!command||!bundle.code)throw Error('Unknown executable command.');
   Object.assign(job,{command,permissions:bundle.manifest.permissions,input:commandInput(command,request.input),snapshot:commandSnapshot(request.snapshot),code:bundle.code,token:crypto.randomBytes(24).toString('hex')});
   if(job.permissions.includes('editor.read'))job.editor=(await editorSchema).editorSnapshot(request.editor);
   else if(request.editor!==undefined)throw Error('Editor context requires editor.read.');
   job.manifest=bundle.manifest;job.development=bundle.development;
   if(job.permissions.includes('export.gif')){
    if(!this.gifExporter)throw Error('GIF export is unavailable. Restart ClipCraft.');
    const {renderable,exportDuration}=await import('../../src/state/store.js');
    const {gifPlan,gifProjectSnapshot}=await import('../../shared/pluginGif.mjs');
    job.exportProject=renderable(gifProjectSnapshot(request.exportProject));
    job.gifGeometry={width:job.exportProject.width,height:job.exportProject.height,duration_sec:exportDuration(job.exportProject)};
    job.gifPlan=gifPlan(job.gifGeometry,job.input);
   }else if(request.exportProject!==undefined)throw Error('Composition data requires export.gif.');
   const captionWriting=job.permissions.includes('captions.write');
   if(captionWriting){const {sourceTrack,translationLanguage}=await aiSchema;job.sourceTrack=sourceTrack(job.input.source_track);job.language=translationLanguage(job.input.language).value;}
   if(job.permissions.includes('captions.read'))job.captions=(await aiSchema)[captionWriting?'validateTranslationSnapshot':'validateCaptionSnapshot'](request.captions,job.snapshot.duration_sec);
   else if(request.captions!==undefined)throw Error('Caption data requires captions.read.');
   if(job.permissions.includes('ai.chapters')||job.permissions.includes('ai.translateCaptions'))job.chapterService=this.chapterService.prepare(job.captions,captionWriting?{language:job.language}:undefined);
   if(job.closed)return {status:'canceled'};
   this.progress(job,{phase:'permission',progress:0,message:''});
   const granted=await Promise.race([approve(bundle.manifest,command,{gif:job.gifPlan,ai:job.chapterService?.descriptor,translation:captionWriting?{language:job.language,sourceTrack:job.sourceTrack}:null,captions:job.captions?{cues:job.captions.length,characters:job.captions.reduce((n,c)=>n+c.text.length,0)}:null}),interrupted.then(()=>false)]);
   if(job.closed)return {status:'canceled'};
   if(!granted)return {status:'denied'};
   // Recheck exact package integrity and activation after the user answers the permission prompt.
   await this.manager.commandBundle(request.key);
   if(job.closed)return {status:'canceled'};
   return await new Promise((resolve,reject)=>{
    job.resolve=resolve;job.reject=reject;
    const partition=`plugin-command-${crypto.randomUUID()}`,ses=this.session.fromPartition(partition);
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
    ses.on('will-download',event=>event.preventDefault());
    serveCommandProtocol(ses);
    const allowed=new Set([COMMAND_URL,COMMAND_SCRIPT_URL]);
    ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed.has(details.url)&&!details.url.startsWith('blob:')}));
    const win=new this.BrowserWindow({show:false,width:1,height:1,webPreferences:{preload:path.join(DIR,'commandPreload.cjs'),sandbox:true,contextIsolation:true,webSecurity:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,partition,backgroundThrottling:false,devTools:false,webgl:false,spellcheck:false,navigateOnDragDrop:false}});
    job.window=win;job.senderId=win.webContents.id;job.session=ses;markCommandSender(win.webContents);this.jobs.set(win.webContents.id,job);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const event of ['will-navigate','will-frame-navigate','will-attach-webview'])win.webContents.on(event,e=>e.preventDefault());
    win.webContents.once('render-process-gone',()=>{if(!job.reviewing)this.finish(job,{status:'failed',error:'The command sandbox stopped.'});});
    win.once('closed',()=>{if(!job.closed&&!job.reviewing)this.finish(job,{status:'failed',error:'The command sandbox closed.'});});
    job.timer=setTimeout(()=>this.finish(job,{status:'failed',error:'Plugin command exceeded its execution time limit.'}),job.chapterService?this.aiTimeoutMs:this.timeoutMs);
    this.progress(job,{phase:'running',progress:0,message:''});
    win.loadURL(COMMAND_URL).catch(error=>this.finish(job,{status:'failed',error:error.message}));
   });
  }catch(error){return {status:'failed',error:String(error.message).slice(0,2000)};}
  finally{this.dispose(job);if(this.active===job)this.active=null;}
 }
 async complete(job,message){
  if(job.permissions.some(p=>['clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p))){
   if(job.reviewing||job.closed)throw Error('Clip command is no longer accepting results.');
   job.reviewing=true;
   if(!job.edits)throw Error('No clip transaction was staged.');
   await this.manager.commandBundle(job.key);if(job.closed)return;
   for(const [token,record] of this.editCommits)if(record.expires<Date.now())this.editCommits.delete(token);
   while(this.editCommits.size>=32)this.editCommits.delete(this.editCommits.keys().next().value);
   const editCommit=crypto.randomUUID();this.editCommits.set(editCommit,{runId:job.runId,key:job.key,edits:JSON.stringify(job.edits),owner:job.owner,frame:job.owner?.mainFrame,expires:Date.now()+30000});
   this.finish(job,{status:'completed',key:job.key,markers:[],edits:job.edits,editCommit,message});return;
  }
  if(job.permissions.includes('export.gif')){
   if(job.reviewing||job.closed||!job.gifStaged)throw Error('No GIF job was staged.');
   job.reviewing=true;clearTimeout(job.timer);this.disposeWorker(job);
   const artifact=await this.gifExporter.run({project:job.exportProject,plan:job.gifPlan,signal:job.controller.signal,
    onProgress:(progress,message)=>this.progress(job,{phase:'running',progress,message}),
    verify:()=>this.manager.commandBundle(job.key)});
   if(!job.closed)this.finish(job,artifact?{status:'completed',key:job.key,artifact}:{status:'canceled'});
   return;
  }
  if(job.permissions.includes('captions.write')){
    if(job.reviewing||job.closed||job.aiPending)throw Error('Caption command is not ready for review.');
    if(!job.translation)throw Error('No translated caption track was proposed.');
    job.reviewing=true;clearTimeout(job.timer);this.disposeWorker(job);
    this.progress(job,{phase:'review',progress:1,message:require('../system/i18n.cjs').t('plugins.translation_review_pending')});
    const accepted=await Promise.race([this.review?.(job.manifest,job.command,[],job.chapterService?.descriptor,{runId:job.runId,signal:job.controller.signal,translation:{...job.translation,sourceTrack:job.sourceTrack,captions:job.captions}}),job.interrupted.then(()=>false)]);
    if(job.closed)return;
    if(accepted!==true){this.finish(job,{status:'denied',review_declined:true});return;}
    await this.manager.commandBundle(job.key);
    if(!job.closed)this.finish(job,{status:'completed',key:job.key,markers:[],translation:{...job.translation,sourceTrack:job.sourceTrack},message,reviewed:true});
    return;
  }
  if(!job.permissions.includes('ai.chapters')){this.finish(job,{status:'completed',key:job.key,markers:job.markers,message});return;}
  if(job.reviewing||job.closed)throw Error('Command is no longer accepting results.');
  if(job.aiPending)throw Error('The requested AI operation must finish before command completion.');
  job.reviewing=true;clearTimeout(job.timer);this.disposeWorker(job);
  if(!job.markers.length)throw Error('No chapter markers were proposed for review.');
  this.progress(job,{phase:'review',progress:1,message:require('../system/i18n.cjs').t('plugins.ai_review_pending')});
  const accepted=await Promise.race([this.review?.(job.manifest,job.command,job.markers,job.chapterService.descriptor),job.interrupted.then(()=>false)]);
  if(job.closed)return;
  if(accepted!==true){this.finish(job,{status:'denied',review_declined:true});return;}
  await this.manager.commandBundle(job.key);
  if(!job.closed)this.finish(job,{status:'completed',key:job.key,markers:job.markers,message,reviewed:true});
 }
 finish(job,result){if(job.closed)return;job.closed=true;job.controller?.abort();job.interrupt?.();job.resolve?.(result);this.dispose(job);}
 dispose(job){
  clearTimeout(job.timer);
  job.controller?.abort();
  for(const event of ['destroyed','render-process-gone','did-start-navigation'])job.owner?.removeListener?.(event,job.ownerClosed);
  this.disposeWorker(job);
 }
 disposeWorker(job){
  if(job.window){this.jobs.delete(job.senderId);if(!job.window.isDestroyed())job.window.destroy();job.window=null;}
  const session=job.session;job.session=null;
  session?.closeAllConnections().catch(()=>{});session?.clearStorageData?.().catch(()=>{});
 }
 async authorizeEdits(request){
  if(!request||Object.keys(request).some(k=>!['runId','key','token','edits'].includes(k)))return false;
  const record=this.editCommits.get(request.token);
  if(!record||record.reserved||record.expires<Date.now()||record.runId!==request.runId||record.key!==request.key||record.edits!==JSON.stringify(request.edits))return false;
  record.reserved=true;
  try{
   await this.manager.commandBundle(record.key);
   return this.editCommits.get(request.token)===record&&record.expires>=Date.now()&&this.getWindow()?.webContents===record.owner&&record.owner?.mainFrame===record.frame&&!record.owner?.isDestroyed?.();
  }catch{return false;}finally{if(this.editCommits.get(request.token)===record)this.editCommits.delete(request.token);}
 }
 cancel(runId){for(const [token,record] of this.editCommits)if(!runId||record.runId===runId)this.editCommits.delete(token);const job=this.active;if(job&&(!runId||job.runId===runId)){this.finish(job,{status:'canceled'});return true;}return false;}
}
module.exports={CommandRuntime};
