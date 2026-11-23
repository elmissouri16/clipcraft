const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {serviceContract,serviceMethod,serviceValue,matchServiceContract}=require('../../shared/extensionServices.cjs');
const {copyPayload}=require('./extensionData.cjs');
const {customHookName,hookOptions}=require('../../shared/extensionHookContracts.cjs');
const namespace=/^[a-z][\w.-]{0,159}$/;
class ExtensionRuntime{
 constructor({manager,utilityProcess,safeStorage,invoke,onChanged=()=>{},activationMs=15000,deactivationMs=5000,cancelGraceMs=5000}){Object.assign(this,{manager,utilityProcess,safeStorage,invoke,onChanged,activationMs,deactivationMs,cancelGraceMs});this.active=new Map();this.starting=new Map();this.suspended=new Set();this.commands=new Map();this.services=new Map();this.hostServices=new (require('./extensionHostServices.cjs').ExtensionHostServices)(this);this.hooks=new Map();this.customHooks=new (require('./extensionCustomHooks.cjs').ExtensionCustomHooks)(this);this.pending=new Map();this.canceled=new Map();this.sequence=0;this.queue=Promise.resolve();this.root=path.join(manager.root,'.extensions');this.lifecycle=new Map();this.events=new (require('./extensionEvents.cjs').ExtensionEvents)(this);this.streams=new (require('./extensionStreams.cjs').ExtensionStreams)(this);this.ui=new (require('./extensionUi.cjs').ExtensionUi)(this);this.jobsHost=new (require('./extensionJobs.cjs').ExtensionJobs)(this);}
 async trustData({installedOnly=false}={}){let data={};try{data=JSON.parse(await fs.readFile(path.join(this.root,'trust.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}const s=this.manager.development?.session;if(!installedOnly&&s?.status==='ready'&&s.manifest.main&&s.trusted)data[s.key]=true;return data;}
 async trust(key){const bundle=await this.manager.commandBundle(key);if(bundle.development)await this.manager.development.trust(key);else{const data=await this.trustData({installedOnly:true});data[key]=true;await this.write('trust.json',data);}this.events.invalidate();}
 async write(name,data){await fs.mkdir(this.root,{recursive:true});const target=path.join(this.root,name),temp=target+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});await fs.rename(temp,target);}
 start(key,{automatic=false,operation,agentScope}={}){
  if(this.shuttingDown)return Promise.reject(Error('Extension host is shutting down'));
  if(automatic&&this.suspended.has(key))return Promise.resolve(false);
  const retiring=this.retiring?.get(key);if(retiring)return retiring.then(()=>this.start(key,{automatic,operation,agentScope}));
  // A job that is shutting down is not "ready": wait for it to finish, then start a new activation.
  const live=this.active.get(key);if(live?.state==='stopping')return Promise.resolve(live.stopping||live.commitCleanup).catch(()=>{}).then(()=>this.active.get(key)===live?false:this.start(key,{automatic,operation,agentScope}));
  if(live)return live.ready;
  const previous=this.starting.get(key);if(previous)return previous.revoked?previous.promise.catch(()=>{}).then(()=>this.start(key,{automatic,operation,agentScope})):previous.promise;
  if(!automatic)this.suspended.delete(key);
  const attempt={revoked:false,operation,agentScope};this.starting.set(key,attempt);
  attempt.promise=this.startJob(key,attempt).catch(error=>{if(attempt.manifest&&!this.active.has(key)&&!this.diagnostics().some(row=>row.key===key&&row.generation===attempt.generation)){this.remember({key,manifest:attempt.manifest,generation:attempt.generation,logs:[]},attempt.revoked?'stopped':'failed',error);this.changed();}throw error;}).finally(()=>{if(this.starting.get(key)===attempt)this.starting.delete(key);});return attempt.promise;
 }
 async startJob(key,attempt){
  const check=()=>{if(attempt.agentScope)this.agentCommands.assert(attempt.agentScope);if(attempt.operation)this.operations.checkRef(attempt.operation);if(attempt.revoked)throw Error('Extension activation canceled');};
  const bundle=await this.manager.commandBundle(key);check();if(!bundle.manifest.main)throw Error('Not a Node extension');if(!(await this.trustData())[key])throw Error('Extension requires Node access trust');check();
  attempt.manifest=bundle.manifest;attempt.generation=crypto.randomUUID();if([...this.active.values()].some(job=>job.key!==key&&job.manifest.id===bundle.manifest.id))throw Error('Stop the other activation of this extension before starting this version.');
  const directory=bundle.development?.directory||path.join(this.manager.root,key),storage=bundle.development?.storage||path.join(this.root,bundle.manifest.id);await fs.mkdir(storage,{recursive:true});check();await this.prepareSettings?.({key,manifest:bundle.manifest,storage});check();
  const env={};for(const name of ['PATH','HOME','USER','TMPDIR','TEMP','TMP','SystemRoot','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'])if(process.env[name])env[name]=process.env[name];
  if (process.env.FVE_SMOKE && this.manager.bundledMediaKeys?.has(key)) {
    env.FVE_SMOKE = '1';
    for (const name of ['FVE_PIXABAY_API','FVE_OPENVERSE_API','FVE_MYINSTANTS_URL','CLIPCRAFT_SOUNDZA_URL']) {
      if (process.env[name]) env[name] = process.env[name];
    }
  }
  const child=this.utilityProcess.fork(path.join(__dirname,'extensionWorker.cjs'),[],{env,cwd:directory,stdio:'pipe',serviceName:'ClipCraft extension: '+bundle.manifest.id});
  const job={key,generation:attempt.generation,manifest:bundle.manifest,storage,child,state:'activating',since:Date.now(),subscriptions:new Set(),jobs:new Map(),logs:[]};this.active.set(key,job);if(attempt.operation)this.operations.join(attempt.operation,job);
  job.exited=new Promise(resolve=>child.once('exit',resolve));child.on('message',m=>this.message(job,m));child.on('exit',code=>this.cleanup(job,Error('Extension process exited: '+code)));for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>this.log(job,String(data)));
  job.ready=this.request(job,{type:'start',manifest:job.manifest,directory,storage,generation:job.generation,entry:path.join(directory,job.manifest.main),...(attempt.operation?{operation:attempt.operation}:{})},this.activationMs,null,attempt.operation?this.operations.signal(attempt.operation):attempt.agentScope?this.agentCommands.signal(attempt.agentScope):undefined,undefined,attempt.agentScope).then(()=>{check();if(this.active.get(key)!==job)throw Error('Extension activation is no longer active');job.state='running';this.events.ready(job);this.changed();return true;}).catch(e=>{child.kill();this.cleanup(job,e);throw e;});this.changed();return job.ready;
 }
 changed(){
  if(!this.events.closed){
   for(const job of this.active.values()){const previous=this.lifecycle.get(job.key);if(previous?.generation===job.generation&&previous.state===job.state)continue;const value={extensionId:job.manifest.id,key:job.key,generation:job.generation,state:job.state};this.lifecycle.set(job.key,value);this.emit('extension.changed',value,{source:{kind:'system'},reason:'lifecycle'}).catch(()=>{});}
   for(const [key,value] of this.lifecycle)if(!this.active.has(key)){this.lifecycle.delete(key);this.emit('extension.changed',{...value,state:'stopped'},{source:{kind:'system'},reason:'lifecycle'}).catch(()=>{});}
  }
  this.onChanged(this.status());
 }
 status(){return [...this.active.values()].map(j=>({key:j.key,generation:j.generation,id:j.manifest.id,name:j.manifest.name,state:j.state,jobs:[...j.jobs.values()],logs:j.logs.slice(-50),events:this.events.stats(j),debuggerUrl:j.debuggerUrl||null}));}
 async debug(key,enabled){
  const session=this.manager.development?.session,job=this.active.get(key);
  if(typeof enabled!=='boolean'||!session||session.status!=='ready'||session.key!==key||!session.trusted||!job||job.state!=='running')throw Error('Debugger requires a running trusted development session');
  const result=await this.request(job,{type:'debugger',enabled},10000);
  if(enabled){const url=new URL(result?.url);if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||!url.port)throw Error('Invalid local debugger address');}
  if(this.active.get(key)!==job||this.manager.development?.session!==session||session.key!==key)throw Error('Development session changed while enabling debugger');
  job.debuggerUrl=enabled?result.url:null;this.changed();this.manager.development.emit();return this.manager.development.snapshot();
 }
 diagnostics(){return [...this.status(),...[...(this.history?.values()||[])].filter(row=>!this.active.has(row.key))];}
 remember(job,state,error){this.history??=new Map();this.history.delete(job.key);this.history.set(job.key,{key:job.key,id:job.manifest.id,generation:job.generation,state,time:Date.now(),error:state==='failed'?String(error?.message||error||'Extension failed').slice(0,1000):'',logs:job.logs.slice(-50),events:this.events.stats(job)});while(this.history.size>64)this.history.delete(this.history.keys().next().value);}
 log(job,message,level='info'){const record={level,message:String(message).slice(0,4000),time:Date.now()};job.logs.push(record);if(job.logs.length>100)job.logs.shift();this.manager.development?.record(job.key,level,record.message,'extension');this.changed();}
 request(job,data,ms=300000,owner=null,signal,parentRequest,agentScope){
  agentScope??=this.executionScope(owner,parentRequest);
  return new Promise((resolve,reject)=>{
   if(this.active.get(job.key)!==job){reject(Error('Extension activation is no longer active'));return;}
   const aborted=()=>Object.assign(Error('Extension request canceled'),{name:'AbortError'});
   if(signal?.aborted){reject(aborted());return;}
   const id=++this.sequence;
   const cleanup=()=>signal?.removeEventListener('abort',abort);
   const abort=()=>{const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);clearTimeout(pending.timer);this.cancelRequest(job,id,!!data.operation||!!agentScope||!!data.managedHook);pending.reject(aborted());};
   const expire=()=>{const pending=this.pending.get(id);this.pending.delete(id);const error=Error('Extension operation timed out');if(data.kind==='view-closed'){clearTimeout(pending?.timer);this.cancelRequest(job,id,false);pending?.reject(error);return;}pending?.reject(error);job.child.kill();this.cleanup(job,error);};
   const timer=setTimeout(expire,ms);
   const pending={job,owner,parentRequest,signal,timer,agentScope,operation:data.operation,managedHook:data.managedHook,hookPoint:data.hookPoint,resume:()=>{pending.timer=setTimeout(expire,ms);},resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}};
   this.pending.set(id,pending);signal?.addEventListener('abort',abort,{once:true});
   try{job.child.postMessage({...data,id});if(signal?.aborted)abort();}catch(e){clearTimeout(timer);this.pending.delete(id);pending.reject(e);}
  });
 }
 cancelRequest(job,id,enforce=false){
  this.jobsHost.parentCanceled(job,id);
  if(enforce&&!this.canceled.has(id)){
   const record={job,deadline:Date.now()+this.cancelGraceMs};
   const expire=()=>{if(this.canceled.get(id)!==record)return;if(Date.now()-record.deadline>2500){record.deadline=Date.now()+this.cancelGraceMs;record.timer=setTimeout(expire,this.cancelGraceMs);record.timer.unref?.();return;}this.canceled.delete(id);if(this.active.get(job.key)===job&&job.state!=='stopping'){const error=Error('Extension did not finish canceled operation');this.log(job,error.message,'error');job.child.kill();this.cleanup(job,error);}};
   record.timer=setTimeout(expire,this.cancelGraceMs);record.timer.unref?.();this.canceled.set(id,record);
  }
  try{job.child.postMessage({type:'cancel-request',id});}catch{}
 }
 execution(job,id){const pending=this.pending.get(id);return pending?.job===job?{signal:pending.signal}:this.events.execution(job,id);}
 executionScope(job,id,seen=new Set()){const pending=this.pending.get(id);if(!pending||pending.job!==job||seen.has(id)||seen.size>=128)return undefined;seen.add(id);return pending.agentScope||this.executionScope(pending.owner,pending.parentRequest,seen);}
 executionActive(job,id){if(id===undefined)return true;const current=this.execution(job,id);return !!current&&!current.signal?.aborted;}
 requestSignal(job,id){return id===undefined?undefined:this.execution(job,id)?.signal;}
 callSignal(job,id,jobOperation){const parent=this.requestSignal(job,id),task=this.jobsHost.signal(job,jobOperation);return parent&&task?AbortSignal.any([parent,task]):parent||task;}
 pauseRequest(job,id,seen=new Set()){const pending=this.pending.get(id);if(!pending)return this.events.pauseDelivery(job,id);if(pending.job!==job||seen.has(id)||seen.size>=128)return ()=>{};seen.add(id);pending.waits=(pending.waits||0)+1;clearTimeout(pending.timer);const resumeParent=pending.owner&&pending.parentRequest?this.pauseRequest(pending.owner,pending.parentRequest,seen):()=>{};let resumed=false;return ()=>{if(resumed)return;resumed=true;resumeParent();if(this.pending.get(id)!==pending)return;pending.waits--;if(pending.waits===0)pending.resume();};}
 async callService(id,method,input,{signal,timeoutMs=300000,owner=null,operation,parentRequest,jobOperation,contract:expectedContract}={}){
  if(this.hostServices.entries.has(id)){matchServiceContract(this.hostServices.entries.get(id).contract,expectedContract);return this.hostServices.call(id,method,input,{signal,timeoutMs,owner,operation,parentRequest,jobOperation});}
  if(!this.services.has(id))await this.activate('service:'+id,{operation,agentScope:this.executionScope(owner,parentRequest)});const service=this.services.get(id);if(!service)throw Error('Service unavailable: '+id);
  matchServiceContract(service.contract,expectedContract);const contract=serviceMethod(service.contract,method,service.contract?copyPayload(input,{label:'Service input'}).value:input);
  if(operation)this.operations.join(operation,service.job);const result=await this.request(service.job,{type:'invoke',kind:'service',name:service.local,method,input,...(operation?{operation}:{})},timeoutMs,owner,signal||(operation?this.operations.signal(operation):this.requestSignal(owner,parentRequest)),parentRequest);
  if(contract)serviceValue(contract.output,copyPayload(result,{label:'Service result'}).value,'Service result');return result;
 }

 async message(job,m){if(this.active.get(job.key)!==job)return;if(m.type==='event-ack'){this.events.ack(job,m.id);return;}if(m.type==='result'){const canceled=this.canceled.get(m.id);if(canceled?.job===job){clearTimeout(canceled.timer);this.canceled.delete(m.id);}const p=this.pending.get(m.id);if(p?.job===job){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.value);}return;}if(m.type!=='call')return;
  const operation=m.operation?this.operations?.records.get(m.operation.id):null,beforeWrites=operation?.writes||0;
  const resume=['exports.render','ui.showOpenDialog','ui.showSaveDialog','ui.showMessage','ui.showInput','files.publish','processes.wait','processes.read','processes.serverStart','services.call','commands.execute','hooks.run','editor.tools.run','projects.create','projects.open','projects.save','projects.close'].includes(m.method)?this.pauseRequest(job,m.parentRequest):()=>{};
  try{const value=await this.call(job,m.method,m.args,m.operation,m.parentRequest,m.jobOperation);if(m.operation&&(['editor.apply','captions.write','media.insert','markers.apply','timeline.apply'].includes(m.method)||m.method==='configuration.update'&&m.args?.scope==='project'))this.operations.wrote(m.operation);if(this.active.get(job.key)===job)job.child.postMessage({type:'reply',id:m.id,value});}catch(e){if(m.operation&&(['editor.apply','captions.write','media.insert','markers.apply','timeline.apply'].includes(m.method)||m.method==='configuration.update'&&m.args?.scope==='project'||['services.call','services.next','commands.execute','hooks.run'].includes(m.method)&&operation?.writes>beforeWrites)){const record=this.operations?.grants.get(m.operation.grant);if(record)this.operations.abort(record.op,e).catch(()=>{});}if(this.active.get(job.key)===job)job.child.postMessage({type:'reply',id:m.id,error:e.message,...(e.name==='AbortError'?{errorName:'AbortError'}:{})});}finally{resume();}
 }
 async call(job,method,args,operation,parentRequest,jobOperation){
  this.jobsHost.authorize(job,jobOperation,method);const signal=this.callSignal(job,parentRequest,jobOperation);
  if(!this.executionActive(job,parentRequest)&&!['log','jobs.finish','jobs.cancel','processes.kill','processes.cancelStart','processes.closeOutput','services.close','media.release','ui.dismissMessage','ui.cancelDialog','files.cancel','events.unsubscribe','exports.cancel','configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete','ui.remove','commands.register.remove','services.register.remove','hooks.register.remove','hooks.define.remove','hooks.cancel'].includes(method))throw Error('Extension callback canceled or finished');
  if(operation){if(!this.operations)throw Error('Save/export operations are unavailable');this.operations.authorize(job,operation,method);}
  if(method==='ui.registerShortcut')return this.ui.register(job,'shortcut',args);
  if(method==='ui.registerView')return this.ui.register(job,'view',args);
  if(method==='ui.viewPost')return this.views.post(job,job.manifest.id+'.'+args.id,args.value);
  if(method==='ui.viewMove'){const {data}=this.ui.entry('view',job.manifest.id+'.'+args.id,job);if(data.instance!==args.instance)throw Error('View registration changed');return this.views.move(data.id,args.destination);}
  if(method==='ui.viewReveal'){this.ui.entry('view',job.manifest.id+'.'+args.id,job);return this.views.reveal(job.manifest.id+'.'+args.id);}
  if(method==='ui.registerSettings')return this.ui.register(job,'settings',args);
  if(method==='ui.registerStatus')return this.ui.register(job,'status',args);
  if(method==='ui.updateStatus')return this.ui.updateStatus(job,args);
  if(method==='ui.registerInspector')return this.ui.registerInspector(job,args);
  if(method==='ui.updateAction')return this.ui.updateAction(job,args);
  if(method==='ui.registerAction')return this.ui.register(job,'action',args);
  if(method==='ui.registerIntegration')return this.ui.register(job,'integration',args);
  if(method==='ui.remove')return this.ui.remove(job,args?.kind,args?.id);
  if(method==='log'){this.log(job,args.message,args.level);return;}
  for(const [prefix,map] of [['commands',this.commands],['services',this.services],['hooks',this.hooks]]){
   if(method===prefix+'.register'){
    if(prefix==='hooks'?!namespace.test(args?.id)&&!customHookName(args?.id):!namespace.test(args?.id))throw Error('Invalid registration ID');const id=prefix==='hooks'?args.id:job.manifest.id+'.'+args.id;
    if(prefix==='hooks'){
     const native=Object.values(require('./extensionHooks.cjs').NAMES).flat().includes(id);if(!native&&!customHookName(id))throw Error('Unsupported document hook: '+id);
     if(typeof args.instance!=='string'||!/^[a-f0-9-]{36}$/.test(args.instance))throw Error('Invalid hook registration instance');
     const options=hookOptions(args.metadata??{},!native);let owners=map.get(id);if(owners?.has(job.key))throw Error('Duplicate hook');
     if([...this.hooks.values()].filter(owners=>owners.has(job.key)).length>=64)throw Error('Use at most 64 hook registrations per extension');
     if(!owners)map.set(id,owners=new Map());owners.set(job.key,job);job.hookOptions??=new Map();job.hookOrders??=new Map();job.hookInstances??=new Map();job.hookContracts??=new Map();job.hookOptions.set(id,options.timeoutMs);job.hookOrders.set(id,options.order);job.hookInstances.set(id,args.instance);if(options.contract)job.hookContracts.set(id,options.contract);
    }
    else{if(map.has(id)||prefix==='services'&&this.hostServices.entries.has(id))throw Error('Duplicate registration');const metadata=copyPayload(args.metadata||{},{label:'Registration metadata',limit:65536}).value;if(prefix==='services'){delete metadata.host;delete metadata.id;delete metadata.extensionId;}const contract=prefix==='services'&&metadata.contract!==undefined?serviceContract(metadata.contract):undefined;if(contract)metadata.contract=contract;map.set(id,{job,local:args.id,metadata,contract});}return id;
   }
   if(method===prefix+'.register.remove'){const id=prefix==='hooks'?args.id:job.manifest.id+'.'+args.id;if(prefix==='hooks'){const owners=map.get(id);if(owners?.get(job.key)===job&&job.hookInstances?.get(id)===args.instance){owners.delete(job.key);this.customHooks.registrationRemoved(job,id,args.instance);job.hookOptions?.delete(id);job.hookOrders?.delete(id);job.hookInstances?.delete(id);job.hookContracts?.delete(id);this.operations?.prune();}if(owners&&!owners.size)map.delete(id);}else if(map.get(id)?.job===job)map.delete(id);return;}
  }
  if(method==='hooks.define')return this.customHooks.define(job,args);
  if(method==='hooks.define.remove')return this.customHooks.remove(job,args);
  if(method==='hooks.list')return this.customHooks.list(args);
  if(method==='hooks.run')return this.customHooks.run(job,args,{operation,parentRequest,signal});
  if(method==='hooks.cancel')return this.customHooks.cancel(job,args?.token);
  if(method==='commands.execute')return this.execute(args.id,args.input,{owner:job,operation,parentRequest,signal});
  if(method==='services.openStream')return this.streams.open(job,args,operation,parentRequest,signal);
  if(method==='services.next')return this.streams.next(job,args?.id,parentRequest,signal);
  if(method==='services.close')return this.streams.close(job,args?.id);
  if(method==='services.describe'){if(!this.services.has(args.id)&&!this.hostServices.entries.has(args.id))await this.activate('service:'+args.id,{operation,agentScope:this.executionScope(job,parentRequest)});const entry=this.hostServices.list().find(entry=>entry.id===args.id)||[...this.services].map(([id,s])=>({...s.metadata,id,extensionId:s.job.manifest.id})).find(entry=>entry.id===args.id);if(!entry)throw Error('Service unavailable');return entry;}
  if(method==='services.list')return [...this.hostServices.list(),...[...this.services].map(([id,s])=>({...s.metadata,id,extensionId:s.job.manifest.id}))];
  if(method==='services.call')return this.callService(args.id,args.method,args.input,{owner:job,operation,parentRequest,jobOperation,signal,contract:args.contract});
  if(method==='events.subscribe')return this.events.subscribe(job,args?.name,{replay:args?.replay??false,listener:args?.listener});
  if(method==='events.unsubscribe')return this.events.unsubscribe(job,args?.name);
  if(method==='events.emit'){
   if(!namespace.test(args?.name)||!['running','activating'].includes(job.state))throw Error('Invalid extension event');
   const now=Date.now();job.eventRate??={tokens:64,at:now};job.eventRate.tokens=Math.min(64,job.eventRate.tokens+(now-job.eventRate.at)*.032);job.eventRate.at=now;if(job.eventRate.tokens<1)throw Error('Extension event rate exceeded');job.eventRate.tokens--;
   // A topic is published under the package ID. A name that already carries it is not prefixed twice.
   return this.events.publish(args.name.startsWith(job.manifest.id+'.')?args.name:job.manifest.id+'.'+args.name,args.value,{source:{kind:'extension',extensionId:job.manifest.id,...(operation?{operationId:operation.id}:{})},reason:'custom'});
  }
  if(method.startsWith('configuration.')&&args&&typeof args==='object'&&args.scope==='project'){
   if(!['configuration.get','configuration.update'].includes(method)||!this.executionActive(job,parentRequest)||signal?.aborted)throw Error('Project configuration callback is unavailable');
   if(operation&&method==='configuration.update'&&this.operations.authorize(job,operation,method).phase!=='prepare')throw Error('Validation hooks cannot edit project configuration');
   if(!this.invoke)throw Error('Project configuration is unavailable');
   return this.invoke({extensionId:job.manifest.id,key:job.key,generation:job.generation,method,args,...(parentRequest!==undefined?{execution:parentRequest}:{}),...(jobOperation!==undefined?{jobOperation}:{}),...(operation?{operation}:{}),...(this.executionScope(job,parentRequest)?{agentScope:this.executionScope(job,parentRequest)}:{})});
  }
  if(method.startsWith('configuration.')&&args&&typeof args==='object'&&(args.scope!==undefined&&args.scope!=='global'||args.documentId!==undefined))throw Error('Invalid configuration scope');
  if(method.startsWith('configuration.')||method.startsWith('secrets.')){if(!['configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete'].includes(method))throw Error('Unsupported configuration or secret operation');return this.storage(job,method,args,operation);}
  if(method==='jobs.start')return this.jobsHost.start(job,args,parentRequest,signal);
  if(method==='jobs.progress')return this.jobsHost.progress(job,args);
  if(method==='jobs.finish')return this.jobsHost.finish(job,args?.operation);
  if(method==='jobs.cancel')return this.jobsHost.cancel(job,args?.operation);
  if(!this.invoke)throw Error('Host API is not connected: '+method);return this.invoke({extensionId:job.manifest.id,key:job.key,generation:job.generation,method,args,...(parentRequest!==undefined?{execution:parentRequest}:{}),...(jobOperation!==undefined?{jobOperation}:{}),...(operation?{operation}:{}),...(this.executionScope(job,parentRequest)?{agentScope:this.executionScope(job,parentRequest)}:{})});
 }
 storage(job,method,args,operation,origin='extension'){const run=this.queue.then(async()=>{
   if(this.active.get(job.key)!==job)throw Error('Extension activation is no longer active');
   const secret=method.startsWith('secrets.'),directory=job.storage||path.join(this.root,job.manifest.id),file=path.join(directory,secret?'secrets.json':'settings.json');
   // Stored settings and secrets belong to one publisher's package ID. A package with the same ID
   // from another publisher starts with empty storage; it never reads the previous owner's values.
   const ownerFile=path.join(directory,'owner.json');let owner;try{owner=JSON.parse(await fs.readFile(ownerFile,'utf8')).publisher;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
   if(owner!==job.manifest.publisher){if(owner!==undefined)for(const name of ['settings.json','secrets.json'])await fs.rm(path.join(directory,name),{force:true});await fs.mkdir(directory,{recursive:true});await fs.writeFile(ownerFile,JSON.stringify({publisher:job.manifest.publisher}),{mode:0o600});}
   let data={};try{data=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(method==='configuration.update'&&args?.value!==undefined)args={...args,value:(await import('../../shared/extensionConfiguration.mjs')).configurationValue(args.value)};
   const key=typeof args==='string'?args:args?.key;if(typeof key!=='string'||!namespace.test(key))throw Error('Invalid configuration key');
   if(method.endsWith('.get')){const value=Object.hasOwn(data,key)?data[key]:secret?undefined:this.ui.defaultValue(job,key);return secret&&value?this.safeStorage.decryptString(Buffer.from(value,'base64')):value;}
   const deleted=method.endsWith('.delete')||!secret&&args?.value===undefined;
   if(deleted&&!Object.hasOwn(data,key)||!secret&&method.endsWith('.update')&&JSON.stringify(data[key])===JSON.stringify(args.value))return true;
   if(secret&&!this.safeStorage.isEncryptionAvailable())throw Error('Encrypted secret storage unavailable');
   if(secret&&method.endsWith('.store')&&Object.hasOwn(data,key)&&this.safeStorage.decryptString(Buffer.from(data[key],'base64'))===String(args.value))return true;
   if(deleted)delete data[key];else data[key]=secret?this.safeStorage.encryptString(String(args.value)).toString('base64'):args.value;
   if(this.active.get(job.key)!==job)throw Error('Extension activation is no longer active');
   await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});await fs.rename(temp,file);await this.emit('configuration.changed',{extensionId:job.manifest.id,key,scope:secret?'secrets':'settings',deleted},{source:origin==='user'?{kind:'user'}:{kind:'extension',extensionId:job.manifest.id,...(operation?{operationId:operation.id}:{})},reason:'configuration'});return true;
  });this.queue=run.catch(()=>{});return run;
 }
 async execute(id,input,{owner=null,operation,parentRequest,key,signal,agentScope=this.executionScope(owner,parentRequest)}={}){if(key)await this.start(key,{automatic:true,operation,agentScope});else if(!this.commands.has(id))await this.activate('command:'+id,{operation,agentScope});const c=this.commands.get(id);if(!c||key&&c.job.key!==key)throw Error('Command unavailable: '+id);if(operation)this.operations.join(operation,c.job);return this.request(c.job,{type:'invoke',kind:'command',name:c.local,input,...(operation?{operation}:{})},300000,owner,signal||(operation?this.operations.signal(operation):this.requestSignal(owner,parentRequest)),parentRequest,agentScope);}
 async activate(event,{operation,agentScope,continueOnError=false}={}){
  if(this.shuttingDown)return [];const errors=[];
  for(const row of await (this.manager.extensionRows?.()||this.manager.list()))if(row.enabled&&row.manifest?.main&&((row.manifest.activationEvents||[]).includes(event)||event.startsWith('command:')&&row.manifest.contributes.commands.some(command=>event==='command:'+row.manifest.id+'.'+command.id)||event.startsWith('view:')&&(row.manifest.contributes.views||[]).some(view=>event==='view:'+row.manifest.id+'.'+view.id))&&(await this.trustData())[row.key]){
   // One failing extension must not keep the others that match this event from starting.
   try{await this.start(row.key,{automatic:true,operation,agentScope});}catch(error){errors.push(error);}
  }if(errors.length&&!continueOnError)throw errors[0];return errors;
 }
 async emit(name,value,options){try{return this.events.publish(name,value,options);}catch(error){this.events.failure(error);return {name,dropped:true};}}

 async before(name,input){const results=[];for(const job of [...(this.hooks.get(name)?.values()||[])].sort((a,b)=>a.manifest.id.localeCompare(b.manifest.id))){const result=await this.request(job,{type:'invoke',kind:'hook',name,input});if(result?.cancel)throw Error(String(result.cancel));results.push(result);}return results;}
 cancel(key,operation,generation){const job=this.active.get(key);if(!job||generation!==undefined&&job.generation!==generation)return false;return this.jobsHost.cancel(job,operation);}
 cleanup(job,error=Error('Extension stopped')){if(this.active.get(job.key)!==job)return job.resources;const canceled=/^Extension (request|activation) canceled$/.test(String(error?.message))&&job.state==='activating';if(canceled)job.requestedStop=true;if(!job.requestedStop){job.failure??=error;this.suspended.add(job.key);}if(this.commits?.has(job)){if(!job.commitCleanup){job.state='stopping';this.changed();job.commitCleanup=this.commits.drain(job).then(()=>{delete job.commitCleanup;return this.cleanup(job,error);});}return job.commitCleanup;}if(job.state!=='stopping'&&!canceled)this.suspended.add(job.key);this.remember(job,job.failure?'failed':job.requestedStop?'stopped':'failed',job.failure||error);this.manager.development?.record(job.key,job.requestedStop?'info':'error',job.requestedStop?'Extension stopped.':String(error.message),'lifecycle');this.active.delete(job.key);this.customHooks.stopped(job);this.hostServices.stopped(job);this.jobsHost.stopped(job);this.events.stopped(job);for(const [id,record] of this.canceled)if(record.job===job){clearTimeout(record.timer);this.canceled.delete(id);}this.ui.stopped(job);job.resources=Promise.allSettled([this.streams.stopped(job),this.onStopped?.(job),this.files?.stopped(job),this.queue]);this.retiring??=new Map();this.retiring.set(job.key,job.resources);job.resources.then(()=>{if(this.retiring.get(job.key)===job.resources)this.retiring.delete(job.key);});for(const [id,p] of this.pending)if(p.job===job||p.owner===job){clearTimeout(p.timer);if(p.job!==job)this.cancelRequest(p.job,id,!!p.operation||!!p.agentScope||!!p.managedHook);p.reject(error);this.pending.delete(id);}for(const map of [this.commands,this.services])for(const [id,r] of map)if(r.job===job)map.delete(id);for(const [id,owners] of this.hooks){owners.delete(job.key);if(!owners.size)this.hooks.delete(id);}this.changed();return job.resources;}
 async stop(key,{suspend=true}={}){
  if(suspend)this.suspended.add(key);const attempt=this.starting.get(key);if(attempt)attempt.revoked=true;
  const job=this.active.get(key);if(!job){await attempt?.promise.catch(()=>{});await this.retiring?.get(key);return;}
  if(job.stopping)return job.stopping;let stopped;job.stopping=new Promise(resolve=>{stopped=resolve;});
  try{await this.stopJob(job);}finally{stopped();}
 }
 async stopJob(job){
  job.requestedStop=true;job.state='stopping';this.customHooks.stopped(job);this.hostServices.stopped(job);this.jobsHost.stopped(job);this.events.stopped(job);this.changed();await this.commits?.drain(job);await this.exports?.stopped(job);await this.files?.stopped(job);try{await this.request(job,{type:'stop'},this.deactivationMs);}catch{}finally{job.child.kill();await this.cleanup(job);if(job.exited){let timer;try{await Promise.race([job.exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Extension process did not exit after stop')),2000);})]);}finally{clearTimeout(timer);}}}
 }
 async dispose({temporary=false}={}){if(!temporary)this.shuttingDown=true;const release=this.events.hold();try{await Promise.all([...new Set([...this.active.keys(),...this.starting.keys(),...(this.retiring?.keys()||[])])].map(key=>this.stop(key,{suspend:false})));}finally{if(!temporary)this.events.close();release();}}

}
module.exports={ExtensionRuntime};
