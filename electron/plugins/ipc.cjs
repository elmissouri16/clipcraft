const {PluginManager}=require('./manager.cjs');
function registerPlugins({ipcMain,app,dialog,getWindow,root,examplesDirectory,bundledMediaDirectory,fontDirectory}) {
  const manager=new PluginManager(root,app.getVersion());
  let ready=examplesDirectory ? require('./examples.cjs').loadExamplePlugins(manager,examplesDirectory) : Promise.resolve();
  manager.ready=ready;
  const extensions=new (require('./extensionRuntime.cjs').ExtensionRuntime)({manager,utilityProcess:require('electron').utilityProcess,safeStorage:require('electron').safeStorage});
  manager.extensions=extensions;manager.extensionMedia=null;extensions.prepareSettings = async info => {
    await require('./extensionMigrations.cjs').prepare(info,require('../system/settings.cjs').getExtensionMigrations());
    await require('./bundledMedia.cjs').prepareBundledKey(manager, info);
  };
  const agentCommands=new (require('./extensionAgentCommands.cjs').ExtensionAgentCommands)({runtime:extensions,manager,approve:async({manifest,command,signal})=>{const i18n=require('../system/i18n.cjs');const answer=await dialog.showMessageBox(getWindow(),{type:'question',title:i18n.t('plugins.agent_command_title'),signal,message:i18n.t('plugins.agent_command_message',{command:command.name,name:manifest.name}),detail:i18n.t('plugins.agent_command_detail',{version:manifest.version}),buttons:[i18n.t('app.cancel'),i18n.t('plugins.run_command')],defaultId:0,cancelId:0,noLink:true});return answer.response===1;}});extensions.agentCommands=agentCommands;manager.extensionAgentCommands=agentCommands;
  if (bundledMediaDirectory) ready = ready.then(() => require('./bundledMedia.cjs').installBundledMedia(manager, bundledMediaDirectory));
  const extensionCalls=new Map();
  const commits=new (require('./extensionCommits.cjs').ExtensionCommits)({isActive:job=>extensions.active.get(job.key)===job&&['running','activating'].includes(job.state)});extensions.commits=commits;manager.extensionCommits=commits;
  app.on?.('will-quit',()=>commits.dispose());
  const processes=new (require('./extensionProcesses.cjs').ExtensionProcesses)({isActive:job=>extensions.active.get(job.key)===job&&['running','activating'].includes(job.state)});
  const mediaRoot=require('node:path').join(require('node:path').dirname(root),'extension-media');
  const retention=new (require('./extensionMediaRetention.cjs').ExtensionMediaRetention)(mediaRoot,{autosaveRoot:require('node:path').join(require('node:path').dirname(root),process.env.FVE_SMOKE?'autosave-test':'autosave'),recoveryFile:require('node:path').join(require('node:path').dirname(root),'project-recovery.json')});
  ready=Promise.all([ready,retention.ready]);manager.ready=ready;
  const media=new (require('./extensionMedia.cjs').ExtensionMedia)({root:mediaRoot,retention,isActive:job=>extensions.active.get(job.key)===job&&['running','activating'].includes(job.state)});
  manager.extensionMedia=media;
  app.on?.('before-quit',()=>processes.dispose());
  const operations=new (require('./extensionHooks.cjs').ExtensionHooks)({runtime:extensions,commits,media,describe:async(_op,job,operation)=>{const document=await extensions.invoke({key:job.key,generation:job.generation,method:'workspace.read',operation});if(document.name.length>1000)delete document.name;return document;}});extensions.operations=operations;manager.extensionHooks=operations;
  const views=new (require('./extensionViews.cjs').ExtensionViews)({runtime:extensions,manager,ipcMain,WebContentsView:require('electron').WebContentsView,BaseWindow:require('electron').BaseWindow,session:require('electron').session,getWindow,sandboxEnabled:!app.commandLine?.hasSwitch?.('no-sandbox'),deadlineMs:process.env.FVE_SMOKE?4000:10000});extensions.views=views;manager.extensionViews=views;views.onChanged=()=>views.notify({type:'catalog'});
  app.on?.('before-quit',()=>views.dispose());
  const messages=new (require('./extensionMessages.cjs').ExtensionMessages)({isActive:job=>extensions.active.get(job.key)===job&&['running','activating'].includes(job.state),getWindow});
  messages.onChanged=(owner,value)=>{try{if(owner&&!owner.isDestroyed()&&!owner.webContents.isDestroyed())owner.webContents.send('plugins:extensionMessagesChanged',value);}catch{}};
  app.on?.('before-quit',()=>messages.dispose());
  const files=new (require('./extensionFiles.cjs').ExtensionFiles)({isActive:job=>extensions.active.get(job.key)===job&&['running','activating'].includes(job.state)});extensions.files=files;manager.extensionFiles=files;
  const dialogs=new (require('./extensionDialogs.cjs').ExtensionDialogs)({dialog,getWindow,isActive:job=>extensions.active.get(job.key)===job&&['running','activating'].includes(job.state)});
  const requestEditor=(request,{timeoutMs=30000,signal}={})=>new Promise((resolve,reject)=>{
    const owner=getWindow()?.webContents;if(!owner||owner.isDestroyed())return reject(Error('Editor unavailable'));
    const id=require('node:crypto').randomUUID();let timer;
    const cleanup=()=>{clearTimeout(timer);extensionCalls.delete(id);signal?.removeEventListener('abort',aborted);for(const event of ['destroyed','render-process-gone','did-navigate'])owner.removeListener(event,closed);};
    const closed=()=>{cleanup();reject(Error('Editor closed during extension request'));},aborted=()=>{cleanup();reject(Object.assign(Error('Export canceled'),{name:'AbortError'}));};
    if(signal?.aborted){aborted();return;}
    if(timeoutMs)timer=setTimeout(()=>{cleanup();reject(Error('Editor request timed out'));},timeoutMs);
    signal?.addEventListener('abort',aborted,{once:true});for(const event of ['destroyed','render-process-gone','did-navigate'])owner.on(event,closed);
    extensionCalls.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);},timer,key:request.key,generation:request.generation,operation:request.operation?.id});
    try{owner.send('plugins:extensionRequest',{...request,id});}catch(error){cleanup();reject(error);}
  });
  const exports=new (require('./extensionExports.cjs').ExtensionExports)({runtime:extensions,getOwner:()=>getWindow()?.webContents,requestEditor});manager.extensionExports=exports;extensions.exports=exports;
  operations.onCancelled=(owner,event)=>{for(const [id,call] of extensionCalls)if(call.operation===event.id){clearTimeout(call.timer);extensionCalls.delete(id);call.reject(Error(event.error));}try{if(!owner.isDestroyed())owner.send('plugins:extensionOperationCanceled',event);}catch{}};
  extensions.ui.onChanged=catalog=>{views.notify({type:'catalog'});const owner=getWindow();if(owner&&!owner.isDestroyed())owner.webContents.send('plugins:extensionUiChanged',catalog);};
  extensions.onChanged=state=>{agentCommands.progress();operations.prune();messages.prune();const owner=getWindow();if(owner&&!owner.isDestroyed())owner.webContents.send('plugins:extensionState',state);};
  extensions.onStopped=job=>{dialogs.stopped(job);views.stopped(job);const cleanup=Promise.allSettled([exports.stopped(job),media.stopped(job),processes.stopped(job)]);for(const [id,call] of extensionCalls)if(call.key===job.key&&call.generation===job.generation){clearTimeout(call.timer);extensionCalls.delete(id);call.reject(Error('Extension stopped'));}return cleanup;};
  extensions.invoke=async request=>{
    const job=extensions.active.get(request.key);if(!job||!['running','activating'].includes(job.state)||request.generation&&request.generation!==job.generation)throw Error('Extension is no longer active');
    const operation=request.operation,scope=operation?operations.authorize(job,operation,request.method):null;
    const recheck=()=>{if(request.inspector&&!extensions.ui.verifyInspector(job,request.inspector))throw Error('Inspector registration changed or stopped');if(request.agentScope)agentCommands.assert(request.agentScope,getWindow()?.webContents);extensions.jobsHost.authorize(job,request.jobOperation,request.method);if(!extensions.executionActive(job,request.execution))throw Error('Extension callback canceled or finished');if(operation)operations.authorize(job,operation,request.method);};recheck();
    request={...request,generation:job.generation,extensionId:job.manifest.id,...(scope?{operation:scope}:{})};
    const callSignal=extensions.callSignal(job,request.execution,request.jobOperation),follow=(promise,abort)=>{if(!callSignal)return promise;callSignal.addEventListener('abort',abort,{once:true});if(callSignal.aborted)abort();return promise.finally(()=>callSignal.removeEventListener('abort',abort));};
    if(request.method==='files.publish'){const value=await files.publish(job,request.args,{signal:callSignal,verify:recheck});if(request.agentScope)agentCommands.receipt(request.agentScope,{kind:'file',extensionId:job.manifest.id,...value});return value;}
    if(request.method==='files.cancel')return files.cancel(job,request.args?.token);
    if(request.method==='timeline.types'){const catalog=await manager.timelineTypes();recheck();const input=request.args??{};if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['kind','pluginId','cursor','limit'].includes(key))||input.kind!==undefined&&!['track','clip'].includes(input.kind)||input.pluginId!==undefined&&(typeof input.pluginId!=='string'||input.pluginId.length>100)||input.cursor!==undefined&&(!Number.isSafeInteger(input.cursor)||input.cursor<0)||input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>64))throw Error('Invalid custom type catalog page');const rows=[...catalog.tracks.map(row=>({...row,typeId:`custom-track:${row.contributionId}@${row.digest}`,category:'track'})),...catalog.clips.map(row=>({...row,typeId:`custom-clip:${row.contributionId}@${row.digest}`,category:'clip'}))].filter(row=>(!input.kind||row.category===input.kind)&&(!input.pluginId||row.pluginId===input.pluginId)),cursor=input.cursor??0;if(cursor>rows.length)throw Error('Custom type catalog cursor is stale');const items=[];let bytes=0;for(const row of rows.slice(cursor,cursor+(input.limit??16))){const size=Buffer.byteLength(JSON.stringify(row));if(bytes+size>256*1024)break;items.push(row);bytes+=size;}return {items,total:rows.length,next:cursor+items.length<rows.length?cursor+items.length:null};}
    if(request.method==='rendering.list'){
      const input=request.args??{};
      if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['cursor','limit','kind','pluginId','preferred'].includes(key))||input.cursor!==undefined&&(!Number.isSafeInteger(input.cursor)||input.cursor<0)||input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>128)||input.kind!==undefined&&!['effect','transition'].includes(input.kind)||input.pluginId!==undefined&&(typeof input.pluginId!=='string'||!/^[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}$/.test(input.pluginId))||input.preferred!==undefined&&typeof input.preferred!=='boolean')throw Error('Invalid rendering catalog page');
      const [effects,transitions]=await Promise.all([manager.effects(),manager.transitions()]);recheck();
      const rows=[...effects.map(row=>({...row,kind:'effect'})),...transitions.map(row=>({...row,kind:'transition'}))].filter(row=>(!input.kind||input.kind===row.kind)&&(!input.pluginId||input.pluginId===row.pluginId)&&(input.preferred===undefined||input.preferred===row.preferred));
      const cursor=input.cursor??0;if(cursor>rows.length)throw Error('Rendering catalog cursor is outside the current catalog');
      const items=[];let bytes=0;for(const row of rows.slice(cursor,cursor+(input.limit??32))){const item={id:(row.kind==='effect'?'plugin:':'plugin-transition:')+row.contributionId+'@'+row.digest,kind:row.kind,name:row.name,program:row.fragment!==undefined?'glsl':'expression',pluginId:row.pluginId,digest:row.digest,version:row.version,preferred:row.preferred,parameters:row.parameters,...(row.duration?{duration:row.duration}:{})},size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>256*1024)break;items.push(item);bytes+=size;}
      return {items,total:rows.length,next:cursor+items.length<rows.length?cursor+items.length:null};
    }
    if(request.method==='rendering.validate'){
      const input=request.args;if(!input||typeof input.id!=='string'||input.id.length>400||Object.keys(input).some(key=>!['id','params'].includes(key)))throw Error('Choose an installed rendering definition');
      const mode=input.id.startsWith('plugin-transition:')?'transition':'effect',rows=await(mode==='effect'?manager.effects():manager.transitions()),prefix=mode==='effect'?'plugin:':'plugin-transition:';
      const definition=rows.find(row=>prefix+row.contributionId+'@'+row.digest===input.id);if(!definition)throw Error('Rendering definition is unavailable');
      const params=(await import('../../shared/pluginEffects.mjs')).effectParameters(definition,input.params);recheck();
      const result=await requestEditor({...request,args:{id:input.id,mode,definition,params}});recheck();return result;
    }
    if(request.method==='host.capabilities')return require('../../shared/extensionCapabilities.cjs').capabilities();
    if(request.method==='host.read'){const tools=require('../media/ffmpeg.cjs');return {appVersion:app.getVersion(),apiVersion:1,platform:process.platform,arch:process.arch,tools:{ffmpeg:tools.ffmpegPath,ffprobe:tools.ffprobePath}};}
    if(request.method==='ui.showOpenDialog'||request.method==='ui.showSaveDialog')return dialogs.show(job,request.method==='ui.showOpenDialog'?'open':'save',request.args,{signal:callSignal});
    if(request.method==='ui.cancelDialog')return dialogs.cancel(job,request.args?.token);
    if(request.method==='exports.render')return follow(exports.render(job,request.args,request.agentScope),()=>exports.cancel(job,request.args?.token));
    if(request.method==='exports.cancel')return exports.cancel(job,request.args?.token);
    if(['ui.showMessage','ui.showInput'].includes(request.method)){const {token,...input}=request.args??{};const result=messages.show(job,input,token,request.method==='ui.showInput');if(!operation)return follow(result,()=>messages.dismiss(job,request.args?.token));const signal=operations.signal(operation),abort=()=>messages.dismiss(job,request.args?.token);signal.addEventListener('abort',abort,{once:true});return result.finally(()=>signal.removeEventListener('abort',abort));}
    if(request.method==='ui.dismissMessage')return messages.dismiss(job,request.args?.token);
    if(request.method==='processes.start'){const value=await processes.start(job,request.args);try{recheck();if(request.agentScope&&job.state!=='activating'){const scope=request.agentScope,signal=agentCommands.signal(scope),abort=()=>{try{processes.kill(job,value.id);}catch{}};signal.addEventListener('abort',abort,{once:true});agentCommands.track(scope,()=>signal.removeEventListener('abort',abort));}if(operation&&job.state!=='activating'){const signal=operations.signal(operation),abort=()=>{try{processes.kill(job,value.id);}catch{}};signal.addEventListener('abort',abort,{once:true});operations.track(operation,()=>signal.removeEventListener('abort',abort));}return value;}catch(error){try{processes.kill(job,value.id);}catch{}throw error;}}
    if(request.method==='processes.serverStart'){
      if(operation||request.agentScope||request.jobOperation)throw Error('Start persistent helpers from activation or an ordinary command, outside managed edit/job scopes');
      const value=await follow(processes.startServer(job,request.args),()=>processes.cancelServerStart(job,request.args?.token));try{recheck();return value;}catch(error){processes.kill(job,value.id);throw error;}
    }
    if(request.method==='processes.cancelStart')return processes.cancelServerStart(job,request.args?.token);
    if(request.method==='processes.read')return follow(processes.read(job,request.args?.id),()=>processes.cancelRead(job,request.args?.id));
    if(request.method==='processes.closeOutput')return processes.closeOutput(job,request.args?.id);
    if(request.method==='processes.wait')return follow(processes.wait(job,request.args?.id),()=>{try{processes.kill(job,request.args?.id);}catch{}});
    if(request.method==='processes.kill')return processes.kill(job,request.args?.id);
    if(request.method==='media.import'){const value=await media.import(job,request.args);try{recheck();return value;}catch(error){await media.release(job,value.id).catch(()=>{});throw error;}}
    if(request.method==='media.release')return media.release(job,request.args?.id);
    if(request.method==='media.insert'||request.method==='media.preview'){
      const item=await media.item(job,request.args?.id,request.method==='media.insert',scope?.id);recheck();
      if(request.method==='media.preview')media.get(job,item.id).previewing=true;
      try{return await requestEditor({...request,args:{...request.args,item}});}catch(e){if(request.method==='media.preview')try{media.get(job,item.id).previewing=false;}catch{}throw e;}
    }
    return requestEditor(request);
  };

  app.on?.('before-quit',()=>extensions.dispose());
  ready.then(()=>app.whenReady?.()).then(()=>extensions.activate('startup',{continueOnError:true})).catch(console.error);

  const previewCache=new (require('./previewCache.cjs').PreviewCache)(manager);
  app.on?.('before-quit',()=>previewCache.dispose());
  const browserPreferences=new (require('./browserPreferences.cjs').BrowserPreferences)(manager);
  const preferenceMigration=new (require('./preferenceMigration.cjs').PreferenceMigration)(manager);
  const packBuilder=new (require('./packBuilder.cjs').PackBuilder)({manager,dialog,getWindow,fontDirectory});
  app.on?.('before-quit',()=>{if(packBuilder.current)packBuilder.discard(packBuilder.current.id);});
  const sendDevelopment=(channel,state)=>{const win=getWindow();if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channel,state);};
  const development=new (require('./development.cjs').DevelopmentSessions)(manager,{onChanged:state=>sendDevelopment('plugins:developmentChanged',state),onCatalog:()=>{views.notify({type:'catalog'});extensions.ui.changed();sendDevelopment('plugins:developmentCatalogChanged');}});
  manager.development=development;
  const authoring=new (require('./authoring.cjs').AuthoringTests)({development,dialog,getWindow});manager.authoring=authoring;
  app.on?.('will-quit',()=>development.dispose());

  // Pickers do not mutate the inventory. Keep extensions and their jobs alive
  // until a package has actually been selected, and serialize catalog changes.
  let catalogQueue=Promise.resolve();
  const changeCatalog=fn=>{
    const run=catalogQueue.then(async()=>{
      await extensions.resuming;
      const releaseEvents=extensions.events.hold();
      const resume=[...extensions.active.values()].filter(job=>!extensions.suspended.has(job.key)).map(job=>job.key);
      let primary;
      try{await extensions.dispose({temporary:true});return await fn();}
      catch(error){primary=error;throw error;}
      finally{try{await manager.refreshAiCatalog?.();}catch(error){if(!primary)throw error;}finally{
        extensions.events.invalidate();releaseEvents();const wc=getWindow()?.webContents;try{if(wc&&!wc.isDestroyed?.())wc.send('plugins:changed');}catch{}
        extensions.resuming=(async()=>{for(const key of resume)await extensions.start(key,{automatic:true}).catch(()=>{});await extensions.activate('startup',{continueOnError:true}).catch(()=>{});})();
        await extensions.resuming;
      }}
    });
    catalogQueue=run.catch(()=>{});return run;
  };
  const handle=(name,fn)=>ipcMain.handle(`plugins:${name}`,async(event,...args)=>{
    const win=getWindow();
    if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame) throw Error('Plugin management is only available to the editor.');
    await ready;
    return ['installCreatedPack','enable','remove','recover'].includes(name)?changeCatalog(()=>fn(...args)):fn(...args);
  });
  handle('development',()=>development.snapshot());
  handle('beginAuthorExport',request=>authoring.export(request));
  handle('cancelAuthorTest',()=>{authoring.revoke();return true;});
  handle('finishAuthorTest',token=>authoring.finish(token));
  handle('startDevelopment',async()=>{const answer=await dialog.showOpenDialog(getWindow(),{properties:['openDirectory']});if(answer.canceled)return development.snapshot();return development.start(answer.filePaths[0]);});
  handle('debugDevelopment',enabled=>extensions.debug(development.session?.key,enabled));
  handle('reloadDevelopment',()=>development.reload());
  handle('watchDevelopment',value=>development.setWatch(value));
  handle('endDevelopment',()=>development.end());
  handle('clearDevelopmentLogs',()=>development.clearLogs());
  handle('previewSound',id=>{previewCache.bind(getWindow().webContents);return previewCache.acquire(id);});
  handle('releaseSoundPreview',token=>previewCache.release(token));
  handle('previewStorage',()=>previewCache.report());
  handle('cleanPreviewStorage',token=>previewCache.clean(token));
  handle('browserFavorites',()=>browserPreferences.read());
  handle('setBrowserFavorite',(id,value)=>browserPreferences.set(id,value));
  handle('previewContent',request=>require('./contentPreview.cjs').contentPreview(manager,request));
  handle('preparePreferenceMigration',request=>preferenceMigration.prepare(request));
  handle('migratePreferences',request=>preferenceMigration.commit(request));
  handle('clearPanelStorage',key=>manager.clearPanelStorage(key));
  handle('beginPackDraft',()=>packBuilder.begin());
  handle('discardPackDraft',id=>packBuilder.discard(id));
  handle('pickPackAssets',(id,kind)=>packBuilder.pick(id,kind));
  handle('exportPackDraft',(id,input)=>packBuilder.export(id,input));
  handle('installCreatedPack',(id,token)=>packBuilder.install(id,token));
  handle('dependencies',async references=>(await import('../../shared/pluginDependencies.mjs')).dependencyReport(references,await manager.list()));
  handle('installDependency',async key=>{if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid required pack fingerprint.');const answer=await dialog.showOpenDialog(getWindow(),{title:'Install exact required pack',properties:['openFile'],filters:[{name:'ClipCraft plugin',extensions:['tgz']}]});return answer.canceled?null:changeCatalog(()=>manager.install(answer.filePaths[0],false,{requiredKey:key}));});
  handle('list',()=>manager.list());
  handle('icon',key=>manager.icon(key));
  handle('extensionViews',()=>views.catalog());
  handle('extensionViewOpen',id=>views.reveal(id));
  handle('extensionViewMove',(id,value)=>views.move(id,value));
  handle('extensionViewClose',id=>views.close(id));
  handle('extensionViewLayout',(id,value)=>views.layout(id,value));
  handle('extensionUi',async(location,key)=>{
    if(key!==undefined){
      if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid extension identity');
      // Opening one extension's configuration activates only that already-trusted
      // package. Explicit Stop remains final until the user activates it again.
      if((await extensions.trustData())[key]&&!extensions.suspended.has(key))await extensions.start(key,{automatic:true});
    }else if(typeof location==='string')await extensions.activate('ui:'+location,{continueOnError:true});
    return extensions.ui.list();
  });
  handle('extensionSettingsRead',id=>extensions.ui.settings(id));
  handle('extensionSettingsUpdate',(id,key,value)=>extensions.ui.update(id,key,value));
  handle('extensionInspectorSet',(id,input)=>extensions.ui.inspectorSet(id,input));
  handle('extensionStatusExecute',(id,instance)=>extensions.ui.execute(id,{},instance,'status'));
  handle('extensionUiExecute',(id,input,instance)=>extensions.ui.execute(id,input,instance));
  handle('extensionShortcuts',()=>extensions.ui.shortcuts());
  handle('extensionShortcutExecute',id=>extensions.ui.executeShortcut(id));
  handle('extensionMessages',()=>messages.list());
  handle('extensionInputRespond',(id,value)=>messages.finishInput(id,value,getWindow()));
  handle('extensionMessageRespond',(id,action)=>messages.finish(id,action,getWindow()));
  handle('extensionCancelJob',(key,generation,operation)=>extensions.cancel(key,operation,generation));
  handle('extensionStatus',()=>extensions.status());
  handle('extensionDiagnostics',()=>({items:extensions.diagnostics(),events:extensions.events.failures.slice()}));
  handle('extensionInsertArtifact',(key,args)=>extensions.invoke({key,method:'media.insert',args}));
  handle('extensionPreviewClosed',(key,id)=>{const job=extensions.active.get(key);if(!job)return false;try{media.get(job,id).previewing=false;extensions.emit('media.previewClosed',{extensionId:job.manifest.id,id}).catch(console.error);return true;}catch{return false;}});
  handle('extensionCommitAcquire',(key,generation,execution,jobOperation,inspector)=>{const job=extensions.active.get(key);if(!job||job.generation!==generation)throw Error('Extension stopped');return commits.acquire(getWindow().webContents,[job],()=>extensions.executionActive(job,execution)&&(inspector===undefined||extensions.ui.verifyInspector(job,inspector))&&(jobOperation===undefined||extensions.jobsHost.available(job,jobOperation)));});
  handle('extensionCommitFinish',async(id,applied)=>{const owner=getWindow().webContents;try{await operations.finish(owner,id,applied===true);}finally{commits.finish(owner,id);}return true;});
  ipcMain.on('plugins:extensionCommitApply',(event,id)=>{let allowed=false;try{const owner=getWindow()?.webContents;if(owner&&event.sender===owner&&event.senderFrame===owner.mainFrame&&commits.apply(owner,id)){operations.claimed(owner,id);allowed=true;}}catch{}event.returnValue=allowed;});
  handle('extensionOperationBegin',input=>operations.begin(getWindow().webContents,input));
  handle('extensionOperationCommit',id=>operations.acquire(getWindow().webContents,id));
  handle('extensionOperationComplete',id=>operations.completeEmpty(getWindow().webContents,id));
  handle('extensionOperationCancel',id=>operations.cancel(getWindow().webContents,id));
  handle('extensionExportProgress',(id,input)=>exports.progress(getWindow().webContents,id,input));
  handle('extensionAuthorize',(key,generation,execution,jobOperation)=>{const job=extensions.active.get(key);return !!job&&job.generation===generation&&['running','activating'].includes(job.state)&&extensions.executionActive(job,execution)&&(jobOperation===undefined||extensions.jobsHost.available(job,jobOperation));});
  handle('extensionReply',reply=>{const call=extensionCalls.get(reply?.id);if(!call)return false;clearTimeout(call.timer);extensionCalls.delete(reply.id);reply.error?call.reject(Error(reply.error)):call.resolve(reply.value);return true;});
  handle('extensionPublish',(name,value,metadata)=>{if(!['project.opened','project.closed','project.changed','editor.changed','selection.changed','playback.changed','export.changed','configuration.changed'].includes(name))throw Error('Invalid editor event');return extensions.emit(name,value,metadata);});

  handle('extensionTrust',async key=>{
    const bundle=await manager.commandBundle(key),manifest=bundle.manifest;if(!manifest.main)throw Error('Not a Node extension');
    if((await extensions.trustData())[key]){await extensions.start(key);return true;}
    const i18n=require('../system/i18n.cjs');const answer=await dialog.showMessageBox(getWindow(),{type:'warning',title:i18n.t('plugins.extension_trust_title'),message:i18n.t('plugins.extension_trust_message',{name:manifest.name}),detail:i18n.t('plugins.extension_trust_detail')+(bundle.development?'\n\n'+i18n.t('plugins.dev_node_trust',{source:manager.development.session.source}):''),buttons:[i18n.t('app.cancel'),i18n.t('plugins.extension_trust_confirm')],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return false;await extensions.trust(key);await extensions.start(key);return true;
  });
  handle('extensionStop',key=>{const s=development.session;if(s&&(s.key===key||s.previousKey===key))s.restart=false;return extensions.stop(key);});
  handle('extensionExecute',(id,input,key)=>extensions.execute(id,input,{key}));
  handle('extensionAgentCommand',input=>agentCommands.run(getWindow().webContents,input));
  handle('extensionAgentCancel',id=>agentCommands.cancel(getWindow().webContents,id));

  handle('prepareRecovery',()=>manager.prepareRecovery());
  handle('recover',token=>manager.recover(token));
  handle('showRecoveryArchive',async id=>require('electron').shell.openPath(await manager.inventoryStore.archivePath(id)));
  handle('presets',()=>manager.presets());
  handle('timelineTypes',()=>manager.timelineTypes());
  handle('effects',()=>manager.effects());
  handle('creative',()=>manager.creative());
  handle('transitions',()=>manager.transitions());
  handle('soundAsset',async id=>{const asset=await manager.soundAsset(id);return {...asset,...await require('./contentAudio.cjs').inspectPackSound(asset.path)};});
  handle('install',async(folder=false)=>{
    if(typeof folder!=='boolean') throw Error('Invalid install mode.');
    const res=await dialog.showOpenDialog(getWindow(),{properties:[folder?'openDirectory':'openFile'],
      ...(!folder?{filters:[{name:'ClipCraft plugin',extensions:['tgz']}]}:{})});
    if(res.canceled) return null;
    return changeCatalog(()=>manager.install(res.filePaths[0],folder));
  });
  handle('enable',(key,enabled)=>manager.setEnabled(key,enabled));
  handle('remove',key=>manager.remove(key));
  return manager;
}
module.exports={registerPlugins};
