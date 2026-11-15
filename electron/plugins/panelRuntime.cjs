const path=require('node:path'),crypto=require('node:crypto');
const {servePanelProtocol}=require('./panelProtocol.cjs');
const {markPanelSender}=require('./ipcGuard.cjs');
const schema=import('../../shared/pluginPanels.mjs');
const editorSchema=import('../../shared/pluginEditor.mjs');
const payload=value=>{const json=JSON.stringify(value);if(!json||Buffer.byteLength(json)>128*1024)throw Error('Panel payload exceeds 128 KiB.');};
class PanelRuntime{
 constructor({ipcMain,WebContentsView,session,manager,getWindow,dialog,sandboxEnabled=true,heartbeatMs=1000,deadlineMs=6000}){
  Object.assign(this,{WebContentsView,session,manager,getWindow,dialog,sandboxEnabled,heartbeatMs,deadlineMs});this.active=null;this.senders=new Map();this.actions=new (require('./panelActions.cjs').PanelActions)(this);
  const owned=(event,token,boot=false)=>{
   const job=this.senders.get(event.sender.id);
   if(!job||job.closed||event.sender!==job.view.webContents||event.senderFrame!==event.sender.mainFrame||(!boot&&token!==job.token))throw Error('Unknown panel runtime or token.');
   return job;
  };
  ipcMain.handle('pluginPanel:boot',(event,sandboxed)=>{
   const job=owned(event,undefined,true);
   if(job.booted||sandboxed!==true||event.sender.getOSProcessId()===job.owner.getOSProcessId()){this.close(job.id,'failed','Panel must use a separate sandboxed renderer.');throw Error('Panel must use a separate sandboxed renderer.');}
   job.booted=true;job.lastBeat=Date.now();return {token:job.token,info:{apiVersion:1,panelId:job.panel.id,name:job.panel.name,pluginName:job.manifest.name,version:job.manifest.version,permissions:job.panel.permissions,commands:(job.manifest.contributes?.commands||[]).filter(c=>job.panel.commands?.includes(c.id)).map(({id,name,parameters})=>({id,name,parameters})),theme:job.theme}};
  });
  ipcMain.handle('pluginPanel:beat',(event,token,sequence)=>{const job=owned(event,token);if(sequence===job.sequence)job.lastBeat=Date.now();return true;});
  ipcMain.handle('pluginPanel:call',async(event,token,method,args)=>{
   const job=owned(event,token);
   try{
    payload({method,args});if(Date.now()-job.rateStart>=60000){job.rateStart=Date.now();job.calls=0;}if(++job.calls>60)throw Error('Panel exceeded 60 requests per minute.');
    if(method==='editor.read'){
     if(args!==null||!job.panel.permissions.includes('editor.read'))throw Error('Permission denied: editor.read');
     await this.verify(job);if(job.closed)throw Error('Panel closed.');return job.editor;
    }
    if(method==='project.read'){
     if(args!==null||!job.panel.permissions.includes('project.read'))throw Error('Permission denied: project.read');
     await this.verify(job);if(job.closed)throw Error('Panel closed.');return job.summary;
    }
    if(['storage.get','storage.set','storage.remove','storage.keys','storage.clear'].includes(method)){
     if(!job.panel.permissions.includes('storage.local'))throw Error('Permission denied: storage.local');
     return (this.manager.development?.storageFor(job.key)||this.manager.panelStorage).execute(job.key,job.panel.id,method.slice(8),args,()=>this.verify(job));
    }
    if(method==='commands.run')return await this.actions.run(job,args);
    if(method==='commands.cancel'&&args===null)return this.actions.cancel(job);
    if(method==='failure'){if(typeof args!=='string'||args.length>1000)throw Error('Invalid panel failure.');this.close(job.id,'failed',args);return true;}
    if(method==='escape'&&args===null){this.close(job.id,'closed','',true);return true;}
    if(method==='focus.exit'&&['forward','backward'].includes(args)){job.owner.focus();this.notify(job,{type:'focus',direction:args});return true;}
    throw Error('Unsupported panel capability.');
   }catch(error){this.close(job.id,'failed',error.message);throw error;}
  });
 }
 notify(job,value){if(!job.owner.isDestroyed())job.owner.send('plugins:panelEvent',{id:job.id,...value});}
 async verify(job){if(job.closed)throw Error('Panel closed.');await this.manager.panelBundle(job.key,job.panel.id);if(job.closed)throw Error('Panel closed.');}
 async open(request){
  payload(request);if(!this.sandboxEnabled)throw Error('Plugin panels require Electron process sandboxing.');
  if(this.active)throw Error('Close the current plugin panel first.');
  if(!request||Object.keys(request).some(k=>!['id','key','panelId','summary','theme','editor'].includes(k))||typeof request.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(request.id))throw Error('Invalid panel request.');
  const ownerWindow=this.getWindow(),owner=ownerWindow.webContents;
  const job={id:request.id,key:request.key,owner,ownerWindow,closed:false,lastBeat:Date.now(),sequence:0,calls:0,rateStart:Date.now()};this.active=job;
  job.stopped=new Promise(resolve=>{job.stop=resolve;});
  job.ownerGone=()=>this.close(job.id);for(const event of ['destroyed','render-process-gone','did-start-navigation'])owner.on(event,job.ownerGone);
  try{
   const {panelSummary,panelTheme}=await schema,bundle=await this.manager.panelBundle(request.key,request.panelId);
   Object.assign(job,{panel:bundle.panel,manifest:bundle.manifest,theme:panelTheme(request.theme),summary:bundle.panel.permissions.includes('project.read')?panelSummary(request.summary):null});
   if(job.panel.permissions.includes('editor.read'))job.editor=(await editorSchema).editorSnapshot(request.editor);
   const i18n=require('../system/i18n.cjs');
   const consent=await Promise.race([this.dialog.showMessageBox(ownerWindow,{type:'question',title:i18n.t('plugins.panel_consent_title'),message:job.panel.name,buttons:[i18n.t('plugins.panel_open'),i18n.t('app.cancel')],defaultId:1,cancelId:1,noLink:true,detail:i18n.t('plugins.panel_consent_detail',{publisher:job.manifest.publisher,version:job.manifest.version,access:(bundle.development?i18n.t('plugins.dev_consent')+'\n':'')+(job.panel.permissions.includes('storage.local')?i18n.t('plugins.panel_storage_grant')+'\n':'')+i18n.t(job.summary?'plugins.panel_summary_grant':'plugins.panel_no_project_grant')+(job.panel.permissions.includes('editor.read')?'\n'+i18n.t('plugins.permission_editor_read'):'')+(job.panel.commands?.length?'\n'+i18n.t('plugins.panel_actions_grant',{commands:bundle.manifest.contributes.commands.filter(c=>job.panel.commands.includes(c.id)).map(c=>c.name).join(', ')}):'')})}),job.stopped.then(()=>({response:1}))]);
   if(job.closed)return {status:'canceled'};
   if(consent.response!==0){this.close(job.id,'denied');return {status:'denied'};}
   await this.verify(job);
   const ses=this.session.fromPartition(`plugin-panel-${crypto.randomUUID()}`);job.session=ses;
   ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);ses.on('will-download',event=>event.preventDefault());
   const origin=`clipcraft-panel://${crypto.randomUUID()}`;servePanelProtocol(ses,origin,bundle.files,job.panel);
   const view=new this.WebContentsView({webPreferences:{session:ses,preload:path.join(__dirname,'panelPreload.cjs'),sandbox:true,contextIsolation:true,webSecurity:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,backgroundThrottling:false,devTools:false,webgl:false,disableDialogs:true,disableHtmlFullscreenWindowResize:true,autoplayPolicy:'document-user-activation-required',spellcheck:false,navigateOnDragDrop:false}});
   job.view=view;job.token=crypto.randomBytes(24).toString('hex');job.senderId=view.webContents.id;this.senders.set(job.senderId,job);markPanelSender(view.webContents);
   const wc=view.webContents;
   if(bundle.development)wc.on('console-message',details=>{this.manager.development?.record(job.key,details.level,details.message,'panel');});
   this.manager.development?.record(job.key,'info','Panel opened.','lifecycle');
   wc.setWindowOpenHandler(()=>({action:'deny'}));
   for(const event of ['will-navigate','will-frame-navigate','will-attach-webview'])wc.on(event,e=>e.preventDefault());
   wc.on('enter-html-full-screen',()=>{this.close(job.id,'failed','Fullscreen is unavailable to plugin panels.');});
   wc.once('render-process-gone',()=>this.close(job.id,'failed','The plugin panel renderer stopped.'));
   wc.once('destroyed',()=>this.close(job.id,'failed','The plugin panel closed unexpectedly.'));
   job.resized=()=>{if(!job.closed){view.setVisible(false);this.notify(job,{type:'layout'});}};ownerWindow.on('resize',job.resized);
   ownerWindow.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1,height:1});view.setVisible(false);
   job.timer=setInterval(()=>{
    if(job.closed)return;
    if(Date.now()-job.lastBeat>this.deadlineMs){this.close(job.id,'failed','The plugin panel stopped responding.',false,true);return;}
    if(job.booted)wc.send('pluginPanel:pulse',++job.sequence);
    if(!job.checking){job.checking=true;this.verify(job).catch(error=>this.close(job.id,'failed',error.message)).finally(()=>{job.checking=false;});}
   },this.heartbeatMs);
   const loaded=await Promise.race([wc.loadURL(`${origin}/${job.panel.entry}`).then(()=>true),job.stopped.then(()=>false)]);
   if(!loaded||job.closed)return {status:'failed',error:job.error||'Panel closed.'};
   return {status:'open',id:job.id};
  }catch(error){this.close(job.id,'failed',error.message);return {status:'failed',error:error.message};}
 }
 layout(id,value){
  const job=this.active;if(!job||job.id!==id||job.closed||!job.view)return false;
  payload(value);if(!value||Object.keys(value).some(k=>!['x','y','width','height','visible'].includes(k))||!['x','y','width','height'].every(k=>Number.isFinite(value[k])&&Math.abs(value[k])<=100000)||typeof value.visible!=='boolean')throw Error('Invalid panel bounds.');
  const zoom=job.owner.getZoomFactor(),[width,height]=job.ownerWindow.getContentSize();
  const x=Math.max(0,Math.min(width,Math.round(value.x*zoom))),y=Math.max(44,Math.min(height,Math.round(value.y*zoom)));
  const w=Math.max(0,Math.min(width-x,Math.round(value.width*zoom))),h=Math.max(0,Math.min(height-y,Math.round(value.height*zoom)));
  job.view.setBounds({x,y,width:Math.max(1,w),height:Math.max(1,h)});job.view.setVisible(value.visible&&w>0&&h>0);return true;
 }
 async update(id,value){
  const job=this.active;if(!job||job.id!==id||job.closed)return false;payload(value);
  if(!value||Object.keys(value).some(k=>!['summary','theme','editor'].includes(k)))throw Error('Invalid panel update.');
  const {panelSummary,panelTheme}=await schema,next={};
  if(job.closed)return false;
  if(value.summary&&job.panel.permissions.includes('project.read')){const summary=panelSummary(value.summary);if(JSON.stringify(summary)!==JSON.stringify(job.summary)){job.summary=summary;next.summary=summary;}}
  if(value.editor&&job.panel.permissions.includes('editor.read')){
   const {editorSnapshot,editorChanges}=await editorSchema,editor=editorSnapshot(value.editor);
   if(job.closed)return false;
   if(editor.documentId!==job.editor.documentId){this.close(id,'closed');return false;}
   if(editor.revision>job.editor.revision){const changes=editorChanges(job.editor,editor);job.editor=editor;if(changes.length)next.editor={changes,snapshot:editor};}
  }
  if(value.theme){const theme=panelTheme(value.theme);if(JSON.stringify(theme)!==JSON.stringify(job.theme)){job.theme=theme;next.theme=theme;}}
  if(job.view&&Object.keys(next).length)job.view.webContents.send('pluginPanel:update',next);return true;
 }
 focus(id){const job=this.active;if(job?.id===id&&job.view&&!job.closed)job.view.webContents.focus();}
 close(id,status='closed',error='',restore=false,force=false){
  const job=this.active;if(!job||job.closed||(id&&job.id!==id))return false;
  this.manager.development?.record(job.key,status==='failed'?'error':'info',error||'Panel closed.','lifecycle');
  job.closed=true;this.actions.cancel(job);job.error=error;this.active=null;clearInterval(job.timer);job.stop?.();
  for(const event of ['destroyed','render-process-gone','did-start-navigation'])job.owner.removeListener(event,job.ownerGone);
  if(job.resized)job.ownerWindow.removeListener('resize',job.resized);
  this.senders.delete(job.senderId);
  if(job.view){try{job.view.setVisible(false);job.ownerWindow.contentView.removeChildView(job.view);}catch{}const wc=job.view.webContents;try{if(!wc.isDestroyed()){if(force&&wc.getOSProcessId()>0&&!job.owner.isDestroyed()&&wc.getOSProcessId()!==job.owner.getOSProcessId())wc.forcefullyCrashRenderer();if(!wc.isDestroyed())wc.close({waitForBeforeUnload:false});}}catch{}}
  job.session?.protocol.unhandle('clipcraft-panel');
  job.session?.closeAllConnections().catch(()=>{});job.session?.clearStorageData().catch(()=>{});
  if(restore&&!job.owner.isDestroyed())job.owner.focus();this.notify(job,{type:'closed',status,error,restore});return true;
 }
}
module.exports={PanelRuntime};
