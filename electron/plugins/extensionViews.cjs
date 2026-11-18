const crypto=require('node:crypto'),path=require('node:path');
const {SCHEME,serveViewProtocol,viewPayload}=require('./extensionViewProtocol.cjs');
const {markExtensionViewSender}=require('./ipcGuard.cjs');
const {ExtensionViewSessions}=require('./extensionViewSessions.cjs');
const DEFAULT_THEME={background:'#171723',surface:'#222234',text:'#efedf5',muted:'#aaa6bc',accent:'#8764ff',border:'#39364a'};
// Native/session handlers can survive the renderer. Keep stateless callbacks
// outside openView so they cannot retain its shared job closure context.
const denyPermission=(_wc,_permission,callback)=>callback(false),denyPermissionCheck=()=>false,preventNativeEvent=event=>event.preventDefault(),denyPopup=()=>({action:'deny'});
async function closeContents(wc,force,owner){
 if(wc.isDestroyed())return;
 const gone=new Promise(resolve=>wc.once('destroyed',()=>resolve()));
 if(force&&wc.getOSProcessId()!==owner.getOSProcessId())wc.forcefullyCrashRenderer();
 if(!wc.isDestroyed())wc.close({waitForBeforeUnload:false});
 await gone;
}
class ExtensionViews{
 constructor({runtime,manager,ipcMain,WebContentsView,session,getWindow,sandboxEnabled=true,deadlineMs=10000}){
  Object.assign(this,{runtime,manager,WebContentsView,session,getWindow,sandboxEnabled,deadlineMs});this.sessions=new ExtensionViewSessions(session);this.lifecycle=Symbol();this.active=new Map();this.activating=new Set();this.pending=new Map();this.selected=null;this.onChanged=()=>{};
  const owned=(event,token,boot=false)=>{const job=this.senders?.get(event.sender.id);if(!job||job.closed||event.sender!==job.view.webContents||event.senderFrame!==event.sender.mainFrame||event.senderFrame?.origin!==job.origin||!this.live(job)||!boot&&job.token!==token)throw Error('Extension view is unavailable');return job;};this.senders=new Map();
  ipcMain.handle('extensionView:boot',(event,sandboxed)=>{const job=owned(event,null,true);if(job.booted||sandboxed!==true||event.sender.getOSProcessId()===job.owner.getOSProcessId()){this.close(job.id,'View requires a separate sandboxed renderer');throw Error('Extension view sandbox unavailable');}job.booted=true;job.lastBeat=Date.now();job.view.webContents.send('extensionView:shortcuts',[...(job.shortcuts||[])]);return {apiVersion:1,token:job.token,id:job.id,title:job.data.title,extensionId:job.extension.manifest.id,theme:job.theme};});
  ipcMain.handle('extensionView:call',async(event,token,method,input)=>{
   const job=owned(event,token);
   if(method==='beat'){if(Number.isSafeInteger(input)&&input>job.ack&&input<=job.sequence){job.ack=input;job.lastBeat=Date.now();}return true;}
   if(method==='delivered'){const pending=job.deliveries.get(input);if(pending){clearTimeout(pending.timer);job.deliveries.delete(input);pending.resolve(true);}return true;}
   if(method==='focus'&&['forward','backward'].includes(input)){if(!job.view.getVisible())return false;job.owner.focus();this.notify({type:'focus',id:job.id,direction:input});return true;}
   if(method==='shortcut'){if(!job.view.getVisible()||!job.shortcuts?.has(input))return false;this.notify({type:'shortcut',id:job.id,combo:input});return true;}
   if(method!=='message')throw Error('Unsupported extension view call');
   if(Date.now()-job.rateStart>60000){job.rateStart=Date.now();job.calls=0;job.incomingBytes=0;}if(++job.calls>6000||job.inflight>=8)throw Error('Extension view message limit reached');const value=viewPayload(input);job.incomingBytes+=Buffer.byteLength(JSON.stringify(value));if(job.incomingBytes>64*1024*1024)throw Error('Extension view byte limit reached');const controller=new AbortController();job.requests.add(controller);job.inflight++;
   try{await this.runtime.request(job.extension,{type:'invoke',kind:'view-message',name:job.local,input:value},300000,null,controller.signal);return true;}finally{job.requests.delete(controller);job.inflight--;}
  });
 }
 live(job){return !job.closed&&this.runtime.active.get(job.extension.key)===job.extension&&['running','activating'].includes(job.extension.state);}
 notify(value){const win=this.getWindow();if(win&&!win.isDestroyed())win.webContents.send('plugins:extensionViewEvent',value);}
 async catalog(){const rows=new Map();for(const row of await (this.manager.extensionRows?.()||this.manager.list()))if(row.enabled&&row.manifest?.main)for(const view of row.manifest.contributes.views||[])rows.set(row.manifest.id+'.'+view.id,{id:row.manifest.id+'.'+view.id,title:view.name,extensionName:row.manifest.name,extensionId:row.manifest.id,key:row.key,declared:true});for(const data of this.runtime.ui.list().filter(row=>row.kind==='view'))rows.set(data.id,{...rows.get(data.id),...data,extensionName:this.runtime.active.get(data.key)?.manifest.name||data.extensionId});return {selected:this.selected,items:[...rows.values()].map(row=>({...row,open:!!this.active.get(row.id)&&this.live(this.active.get(row.id)),instance:this.active.get(row.id)?.instance}))};}
 async open(id){
  if(typeof id!=='string'||id.length>320)throw Error('Invalid extension view');if(this.active.has(id))return {id};if(this.pending.has(id))return this.pending.get(id);
  const pending=this.openView(id).finally(()=>{if(this.pending.get(id)===pending)this.pending.delete(id);});this.pending.set(id,pending);return pending;
 }
 async openView(id){
  const lifecycle=this.lifecycle;
  if(!this.sandboxEnabled)throw Error('Extension views require Electron process sandboxing');
  if(!this.runtime.ui.list().some(entry=>entry.kind==='view'&&entry.id===id)){const declared=(await this.catalog()).items.find(entry=>entry.id===id);if(declared&&!(await this.runtime.trustData())[declared.key])throw Error('Trust this extension in Plugins before opening its views');this.activating.add(id);try{await this.runtime.activate('view:'+id);}finally{this.activating.delete(id);}}
  const entry=this.runtime.ui.entry('view',id),extension=entry.job,data=entry.data;
  const bundle=await this.manager.commandBundle(extension.key);if(this.runtime.ui.entry('view',id,extension)!==entry)throw Error('View registration changed while opening');
  if(this.active.size>=16)throw Error('Close an extension view before opening another');if(!bundle.files.has(data.entry))throw Error('Extension view entry is missing from its package');
  const ownerWindow=this.getWindow();if(!ownerWindow||ownerWindow.isDestroyed())throw Error('Editor unavailable');
  const owner=ownerWindow.webContents,ownerEvents=['destroyed','render-process-gone','did-start-navigation'];let ownerChanged=false;const invalidate=()=>{ownerChanged=true;};for(const event of ownerEvents)owner.on(event,invalidate);
  let lease,theme;try{theme=owner.executeJavaScript?await owner.executeJavaScript(`(()=>{const css=getComputedStyle(document.documentElement);return Object.fromEntries(Object.entries({background:'--surface-1',surface:'--surface-2',text:'--text',muted:'--text-2',accent:'--primary',border:'--border'}).map(([key,value])=>[key,css.getPropertyValue(value).trim()]));})()`):DEFAULT_THEME;lease=await this.sessions.acquire();}finally{for(const event of ownerEvents)owner.removeListener(event,invalidate);}let disposeProtocol,view,job;
  try{
   if(this.runtime.ui.entry('view',id,extension)!==entry||this.runtime.active.get(extension.key)!==extension||!['running','activating'].includes(extension.state))throw Error('View registration changed while opening');
   if(ownerChanged||this.lifecycle!==lifecycle||ownerWindow.isDestroyed()||this.getWindow()!==ownerWindow)throw Error('Editor unavailable');
   const ses=lease.session,origin=SCHEME+'://'+crypto.randomUUID();
   ses.setPermissionRequestHandler(denyPermission);ses.setPermissionCheckHandler(denyPermissionCheck);ses.removeListener('will-download',preventNativeEvent);ses.on('will-download',preventNativeEvent);disposeProtocol=serveViewProtocol(ses,origin,bundle.files);
   view=new this.WebContentsView({webPreferences:{session:ses,preload:path.join(__dirname,'extensionViewPreload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webSecurity:true,backgroundThrottling:false,devTools:false,webgl:true,disableDialogs:true,autoplayPolicy:'document-user-activation-required',spellcheck:false,navigateOnDragDrop:false}});const wc=view.webContents;
   job={id,origin,instance:crypto.randomUUID(),requests:new Set(),deliveries:new Map(),deliverySequence:0,incomingBytes:0,outgoingBytes:0,outgoing:0,outgoingStart:Date.now(),data,local:id.slice(extension.manifest.id.length+1),extension,view,ownerWindow,owner:ownerWindow.webContents,session:ses,disposeProtocol,releaseSession:lease.release,token:crypto.randomBytes(24).toString('hex'),closed:false,theme,lastBeat:Date.now(),lastCheck:Date.now(),ack:0,sequence:0,inflight:0,calls:0,rateStart:Date.now()};
   job.ownerGone=()=>this.close(id);job.resized=()=>{if(!job.closed){view.setVisible(false);this.notify({type:'layout',id});}};
   this.active.set(id,job);this.senders.set(wc.id,job);markExtensionViewSender(wc);wc.setWindowOpenHandler(denyPopup);for(const event of ['will-navigate','will-frame-navigate','will-attach-webview'])wc.on(event,preventNativeEvent);
   // A view has no console the author can see. Script errors (a blocked inline script, an exception
   // in the view code) go to the owning extension's log, a bounded number per view.
   let reported=0;wc.on('console-message',(event,legacyLevel,legacyMessage)=>{const level=event?.level??legacyLevel,message=event?.message??legacyMessage;if((level==='error'||level===3)&&reported++<20)try{this.runtime.log(job.extension,('View '+id+': '+String(message)).slice(0,2000),'error');}catch{}});
   wc.once('render-process-gone',()=>this.close(id,'The extension view renderer stopped'));wc.once('destroyed',()=>this.close(id,'The extension view closed'));
   for(const event of ['destroyed','render-process-gone','did-start-navigation'])job.owner.on(event,job.ownerGone);ownerWindow.on('resize',job.resized);ownerWindow.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1,height:1});view.setVisible(false);
   job.timer=setInterval(()=>{if(!this.live(job))return this.close(id);const now=Date.now();if(now-job.lastCheck>2500)job.lastBeat=now;job.lastCheck=now;if(now-job.lastBeat>this.deadlineMs)return this.close(id,'The extension view stopped responding',true);if(job.booted)wc.send('extensionView:pulse',++job.sequence);},1000);
   await wc.loadURL(origin+'/'+data.entry);if(!this.live(job)||!job.booted)throw Error('Extension view did not start');this.onChanged();return {id};
  }catch(error){
   if(job&&this.active.get(id)===job)this.close(id,error.message);
   else{try{disposeProtocol?.();}catch{}lease.release(view?closeContents(view.webContents,false,ownerWindow.webContents):undefined);}
   throw error;
  }
 }
 async reveal(id){if(this.activating.has(id)){this.selected=id;return true;}await this.open(id);const job=this.active.get(id);if(!job||!this.live(job))throw Error('Extension view stopped');this.selected=id;job.focusRequested=true;if(job.view.getVisible()){job.view.webContents.focus();job.focusRequested=false;}this.notify({type:'reveal',id});this.onChanged();return true;}
 post(extension,id,input){
  const job=this.active.get(id);if(!job||job.extension!==extension||!this.live(job))return Promise.resolve(false);
  if(Date.now()-job.outgoingStart>60000){job.outgoingStart=Date.now();job.outgoing=0;job.outgoingBytes=0;}
  const value=viewPayload(input);job.outgoingBytes+=Buffer.byteLength(JSON.stringify(value));
  if(++job.outgoing>6000||job.outgoingBytes>64*1024*1024||job.deliveries.size>=8)return Promise.reject(Error('Extension view message limit reached'));
  const message=++job.deliverySequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{job.deliveries.delete(message);reject(Error('Extension view message delivery timed out'));this.close(id,'The extension view stopped accepting messages',true);},5000);job.deliveries.set(message,{resolve,reject,timer});try{job.view.webContents.send('extensionView:message',{id:message,value});}catch(error){clearTimeout(timer);job.deliveries.delete(message);reject(error);}});
 }

 layout(id,input){
  const job=this.active.get(id);if(!job||!this.live(job))return false;
  if(!input||Object.keys(input).some(key=>!['x','y','width','height','visible','theme','shortcuts'].includes(key))||!['x','y','width','height'].every(key=>Number.isFinite(input[key])&&Math.abs(input[key])<=100000)||typeof input.visible!=='boolean')throw Error('Invalid extension view bounds');
  if(input.shortcuts!==undefined){const {validCombo}=require('../../shared/pluginShortcuts.cjs');if(!Array.isArray(input.shortcuts)||input.shortcuts.length>4096||Array.from(input.shortcuts).some(combo=>!validCombo(combo)))throw Error('Invalid view shortcuts');job.shortcuts=new Set(input.shortcuts);job.view.webContents.send('extensionView:shortcuts',[...job.shortcuts]);}
  if(input.theme&&Object.keys(DEFAULT_THEME).every(key=>typeof input.theme[key]==='string'&&input.theme[key].length<=80&&/^(#[a-fA-F0-9]{3,8}|rgba?\([0-9.,% /]+\))$/.test(input.theme[key]))){const theme=Object.fromEntries(Object.keys(DEFAULT_THEME).map(key=>[key,input.theme[key]]));if(Object.keys(DEFAULT_THEME).some(key=>theme[key]!==job.theme?.[key])){job.theme=theme;job.view.webContents.send('extensionView:theme',theme);}}
  const zoom=job.owner.getZoomFactor(),[width,height]=job.ownerWindow.getContentSize(),x=Math.max(0,Math.min(width,Math.round(input.x*zoom))),y=Math.max(44,Math.min(height,Math.round(input.y*zoom))),w=Math.max(0,Math.min(width-x,Math.round(input.width*zoom))),h=Math.max(0,Math.min(height-y,Math.round(input.height*zoom)));
  const visible=input.visible&&w>0&&h>0;job.view.setBounds({x,y,width:Math.max(1,w),height:Math.max(1,h)});job.view.setVisible(visible);if(visible&&job.focusRequested){job.focusRequested=false;job.view.webContents.focus();}return true;
 }
 close(id,error='',force=false){
  const job=this.active.get(id);if(!job||job.closed)return false;job.closed=true;for(const controller of job.requests)controller.abort();job.requests.clear();for(const pending of job.deliveries.values()){clearTimeout(pending.timer);pending.reject(Error('Extension view closed'));}job.deliveries.clear();this.active.delete(id);this.senders.delete(job.view.webContents.id);if(this.selected===id)this.selected=null;clearInterval(job.timer);
  for(const event of ['destroyed','render-process-gone','did-start-navigation'])job.owner.removeListener(event,job.ownerGone);job.ownerWindow.removeListener('resize',job.resized);
  try{job.view.setVisible(false);job.ownerWindow.contentView.removeChildView(job.view);}catch{}
  try{job.disposeProtocol();}catch{}
  job.releaseSession(closeContents(job.view.webContents,force,job.owner));
  if(this.runtime.active.get(job.extension.key)===job.extension&&job.extension.state==='running')this.runtime.request(job.extension,{type:'invoke',kind:'view-closed',name:job.local,input:{id,error}},5000).catch(()=>{});
  this.notify({type:'closed',id,error});this.onChanged();return true;
 }
 stopped(extension){for(const job of this.active.values())if(job.extension===extension)this.close(job.id);}
 dispose(){this.lifecycle=Symbol();for(const id of [...this.active.keys()])this.close(id);}
}
module.exports={ExtensionViews};
