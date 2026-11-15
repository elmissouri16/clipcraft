const {PluginManager}=require('./manager.cjs');
function registerPlugins({ipcMain,app,dialog,getWindow,root,examplesDirectory}) {
  const manager=new PluginManager(root,app.getVersion());
  const ready=examplesDirectory ? require('./examples.cjs').loadExamplePlugins(manager,examplesDirectory) : Promise.resolve();
  manager.ready=ready;
  const {BrowserWindow,WebContentsView,session}=require('electron');
  const {CommandRuntime}=require('./commandRuntime.cjs');
  const translationReview=require('./translationReview.cjs').createTranslationReview(getWindow);
  const runtime=new CommandRuntime({ipcMain,BrowserWindow,session,manager,getWindow,sandboxEnabled:!app.commandLine?.hasSwitch?.('no-sandbox'),timeoutMs:process.env.FVE_SMOKE?3000:15000,aiTimeoutMs:process.env.FVE_SMOKE?5000:90000,
    review:async(manifest,command,markers,ai,extra)=>{
      if(extra?.translation){
        const {translationLanguage}=await import('../../shared/pluginAi.mjs');
        const proposal=extra.translation;
        return translationReview.request({name:manifest.name,version:manifest.version,provider:ai?.provider,model:ai?.model,language:translationLanguage(proposal.language).label,sourceTrack:proposal.sourceTrack,rows:proposal.captions.map((cue,index)=>({start:cue.start_sec,end:cue.end_sec,original:cue.text,translated:proposal.translations[index].text}))},extra.signal);
      }
      const i18n=require('../system/i18n.cjs');
      const timestamp=time=>{const ms=Math.round(time*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;};
      const answer=await dialog.showMessageBox(getWindow(),{type:'question',buttons:[i18n.t('plugins.ai_apply'),i18n.t('plugins.ai_discard')],defaultId:1,cancelId:1,noLink:true,
        title:i18n.t('plugins.ai_review_title'),message:i18n.t('plugins.ai_review_title'),detail:i18n.t('plugins.ai_review_detail',{name:manifest.name,version:manifest.version,provider:ai.provider,model:ai.model,markers:markers.map(m=>`${timestamp(m.time)} — ${m.label}`).join('\n')})});
      return answer.response===0;
    }});
  manager.commandRuntime=runtime;
  const panels=new (require('./panelRuntime.cjs').PanelRuntime)({ipcMain,WebContentsView,session,manager,getWindow,dialog,sandboxEnabled:!app.commandLine?.hasSwitch?.('no-sandbox'),heartbeatMs:process.env.FVE_SMOKE?250:1000,deadlineMs:process.env.FVE_SMOKE?2000:6000});
  manager.panelRuntime=panels;
  const sendDevelopment=(channel,state)=>{const win=getWindow();if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channel,state);};
  const development=new (require('./development.cjs').DevelopmentSessions)(manager,{onChanged:state=>sendDevelopment('plugins:developmentChanged',state),onCatalog:()=>sendDevelopment('plugins:developmentCatalogChanged')});
  manager.development=development;
  app.on?.('will-quit',()=>development.dispose());
  app.on?.('before-quit',()=>panels.close());
  app.on?.('before-quit',()=>runtime.cancel());

  const handle=(name,fn)=>ipcMain.handle(`plugins:${name}`,async(event,...args)=>{
    const win=getWindow();
    if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame) throw Error('Plugin management is only available to the editor.');
    await ready;
    if(['install','enable','remove'].includes(name)){runtime.cancel();panels.close(undefined,'failed','Panel closed for plugin management. Reopen it to continue.');manager.providerService?.revoke();}
    const result=await fn(...args);
    if(['install','enable','remove'].includes(name))await manager.providerService?.refresh();
    if(['install','enable','remove'].includes(name)) getWindow()?.webContents.send('plugins:changed');
    return result;
  });
  handle('authorizeClipEdits',request=>runtime.authorizeEdits(request));
  handle('authorizeDevelopmentCommit',(runId,key)=>development.authorizeCommit(runId,key));
  handle('development',()=>development.snapshot());
  handle('startDevelopment',async()=>{const answer=await dialog.showOpenDialog(getWindow(),{properties:['openDirectory']});if(answer.canceled)return development.snapshot();return development.start(answer.filePaths[0]);});
  handle('reloadDevelopment',()=>development.reload());
  handle('watchDevelopment',value=>development.setWatch(value));
  handle('endDevelopment',()=>development.end());
  handle('clearDevelopmentLogs',()=>development.clearLogs());
  handle('claimPanelAction',(id,action)=>panels.actions.claim(id,action));
  handle('authorizePanelAction',(id,action,run)=>panels.actions.authorize(id,action,run));
  handle('finishPanelAction',(id,action,value)=>panels.actions.finish(id,action,value));
  handle('progressPanelAction',(id,action,value)=>panels.actions.progress(id,action,value));
  handle('clearPanelStorage',async key=>{if(panels.active?.key===key)panels.close(undefined,'closed');return manager.clearPanelStorage(key);});
  handle('actions',()=>manager.actions());
  handle('panels',()=>manager.panels());
  handle('openPanel',request=>panels.open(request));
  handle('closePanel',id=>panels.close(id));
  handle('layoutPanel',(id,value)=>panels.layout(id,value));
  handle('updatePanel',(id,value)=>panels.update(id,value));
  handle('focusPanel',id=>panels.focus(id));
  handle('list',()=>manager.list());
  handle('presets',()=>manager.presets());
  handle('effects',()=>manager.effects());
  handle('transitions',()=>manager.transitions());
  handle('answerTranslationReview',request=>translationReview.answer(request));
  handle('runCommand',async request=>{const result=await runtime.run(request,async(manifest,command,info)=>{
    const i18n=require('../system/i18n.cjs');
    const {COMMAND_PERMISSION_LABELS}=await import('../../shared/pluginCommands.mjs');
    const permissions=manifest.permissions.map(p=>'• '+i18n.t(COMMAND_PERMISSION_LABELS[p])).join('\n')||i18n.t('plugins.no_permissions');
    const detail=info.gif?i18n.t('plugins.permission_detail_gif',{name:manifest.name,version:manifest.version,publisher:manifest.publisher,permissions,start:info.gif.start_sec,end:info.gif.end_sec,width:info.gif.width,height:info.gif.height,fps:info.gif.fps,frames:info.gif.frame_count}):info.ai?i18n.t('plugins.permission_detail_ai',{name:manifest.name,version:manifest.version,publisher:manifest.publisher,permissions,provider:info.ai.provider,model:info.ai.model,destination:info.ai.destination,cues:info.captions.cues,characters:info.captions.characters}):i18n.t('plugins.permission_detail',{name:manifest.name,version:manifest.version,publisher:manifest.publisher,permissions});
    const translationDetail=info.translation?i18n.t('plugins.translation_consent',{language:(await import('../../shared/pluginAi.mjs')).translationLanguage(info.translation.language).label,track:info.translation.sourceTrack}):'';
    const answer=await dialog.showMessageBox(getWindow(),{type:'question',buttons:[i18n.t('plugins.run_once'),i18n.t('plugins.cancel')],defaultId:1,cancelId:1,noLink:true,
      title:i18n.t('plugins.permission_title'),message:command.name,detail:detail+translationDetail+(development.resolve(request.key)?'\n\n'+i18n.t('plugins.dev_consent'):'')});
    return answer.response===0;
  });if(result.status==='completed'&&!result.artifact&&!request.panelAction)development.rememberCommit(request.runId,request.key);development.record(request.key,result.status==='failed'?'error':'info',`Command ${request.commandId}: ${result.status}${result.error?': '+result.error:''}`,'lifecycle');return result;});
  handle('cancelCommand',runId=>{if(typeof runId!=='string')throw Error('Invalid command run ID.');return runtime.cancel(runId);});
  handle('install',async(folder=false)=>{
    if(typeof folder!=='boolean') throw Error('Invalid install mode.');
    const res=await dialog.showOpenDialog(getWindow(),{properties:[folder?'openDirectory':'openFile'],
      ...(!folder?{filters:[{name:'ClipCraft plugin',extensions:['tgz']}]}:{})});
    if(res.canceled) return null;
    return manager.install(res.filePaths[0],folder);
  });
  handle('enable',(key,enabled)=>manager.setEnabled(key,enabled));
  handle('remove',key=>manager.remove(key));
  return manager;
}
module.exports={registerPlugins};
