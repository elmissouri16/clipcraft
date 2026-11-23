const {serviceContract}=require('../../shared/extensionServices.cjs');
const {hookContract}=require('../../shared/extensionHookContracts.cjs');
// Trusted Node extension host. Never loaded by an application renderer.
const {EventEmitter}=require('node:events');
const {AsyncLocalStorage}=require('node:async_hooks'),contexts=new AsyncLocalStorage(),executions=new AsyncLocalStorage(),jobScopes=new AsyncLocalStorage(),exportProgress=new Map(),executionRecords=new Map();
const pending=new Map(),commands=new Map(),services=new Map(),hooks=new Map(),views=new Map(),events=new EventEmitter(),subscriptions=[],controllers=new Map(),streams=new Map();let sequence=0,deactivate,disposed=false;
const port=process.parentPort;
const {copyPayload}=require('./extensionData.cjs');
const streamChunk=value=>copyPayload(value,{label:'Service stream chunk'}).value;
events.setMaxListeners(32);
// A stray rejection in authored code (for example detached work that outlives its handler) is
// reported in the extension's log. It must not end the whole activation.
process.on('unhandledRejection',reason=>{try{call('log',{level:'error',message:('Unhandled rejection: '+String(reason?.stack||reason)).slice(0,8000)}).catch(()=>{});}catch{}});
const forget=disposable=>{const index=subscriptions.indexOf(disposable);if(index>=0)subscriptions.splice(index,1);};
const track=disposable=>{const dispose=disposable.dispose;disposable.dispose=function(...args){forget(disposable);return dispose.apply(this,args);};subscriptions.push(disposable);return disposable;};

const scopeSignal=()=>{const task=jobScopes.getStore();if(task&&!task.completed)return task.signal;const store=contexts.getStore();return store&&!store.closed&&!store.activation?store.controller.signal:undefined;};
async function fileDialog(method,input={}, {signal=scopeSignal()}={}){if(signal?.aborted)throw Object.assign(Error('File dialog canceled'),{name:'AbortError'});const token=String(++sequence),abort=()=>call('ui.cancelDialog',{token}).catch(()=>{});const result=call(method,{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}}
async function publishFile(input,{signal=scopeSignal()}={}){if(signal?.aborted)throw Object.assign(Error('File publication canceled'),{name:'AbortError'});const token=String(++sequence),abort=()=>call('files.cancel',{token}).catch(()=>{}),result=call('files.publish',{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}}
const processSignal=()=>{const task=jobScopes.getStore();if(task&&!task.completed)return task.signal;const store=contexts.getStore();return store?.operation&&!store.activation?store.controller.signal:undefined;};
async function inputPrompt(input, {signal=scopeSignal()}={}){if(signal?.aborted)throw Object.assign(Error('Input prompt canceled'),{name:'AbortError'});const token=String(++sequence),abort=()=>call('ui.dismissMessage',{token}).catch(()=>{}),result=call('ui.showInput',{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}}
function call(method,args){
 if(disposed)return Promise.reject(Error('Extension disposed'));
 const task=jobScopes.getStore(),execution=executions.getStore(),projectSetting=method.startsWith('configuration.')&&args?.scope==='project',cleanup=['log','jobs.finish','jobs.cancel','processes.kill','processes.cancelStart','processes.closeOutput','services.close','media.release','ui.dismissMessage','ui.cancelDialog','files.cancel','events.unsubscribe','exports.cancel','configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete','ui.remove','commands.register.remove','services.register.remove','hooks.register.remove','hooks.define.remove','hooks.cancel'].includes(method)&&!projectSetting;
 if(task&&(task.signal.aborted||task.closed&&!task.completed)&&!cleanup)return Promise.reject(Object.assign(Error('Extension job canceled or finished'),{name:'AbortError'}));
 if(execution&&(execution.canceled||execution.closed&&!execution.completed)&&!cleanup)return Promise.reject(Error('Extension callback canceled or finished'));
 let store=contexts.getStore(),parentRequest=execution?.closed?undefined:execution?.id;if(store&&!projectSetting&&(store.closed||store.controller.signal.aborted)&&['log','jobs.finish','jobs.cancel','processes.kill','processes.cancelStart','processes.closeOutput','services.close','media.release','ui.dismissMessage','ui.cancelDialog','files.cancel','events.unsubscribe','exports.cancel','configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete','ui.remove','commands.register.remove','services.register.remove','hooks.register.remove','hooks.define.remove','hooks.cancel'].includes(method)){store=null;parentRequest=undefined;}
 if(store?.closed){if(store.activation||store.task&&store.completed||store.event&&store.completed){store=null;parentRequest=undefined;}else return Promise.reject(Error('Extension callback already finished'));}
 if(store?.controller.signal.aborted)return Promise.reject(Error('Extension callback canceled'));
 const lifetimeWait=method==='processes.wait'&&(store?.activation||!store?.operation);
 const jobOperation=task&&!task.closed&&!task.signal.aborted?task.operation:undefined;
 const result=new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});port.postMessage({type:'call',id,method,args,parentRequest,...(jobOperation===undefined?{}:{jobOperation}),...(store?.operation&&!lifetimeWait?{operation:store.operation}:{})});});
 if(task&&!task.closed&&!lifetimeWait){task.calls.add(result);result.then(()=>task.calls.delete(result),()=>task.calls.delete(result));}
 if(store&&!lifetimeWait){store.calls.add(result);result.then(()=>store.calls.delete(result),error=>{store.calls.delete(result);if(store.operation&&['editor.apply','captions.write','media.insert','markers.apply','timeline.apply'].includes(method))store.failure??=error;});}
 return result;
}
async function settleScope(store){if(!store)return;store.closed=true;const results=await Promise.allSettled([...store.calls]);if(store.failure)throw store.failure;const error=results.find(result=>result.status==='rejected');if(error)throw error.reason;}
async function scoped(m,handler,activation=false){
 const controller=new AbortController(),store={...(m.operation?{operation:m.operation}:{}),controller,calls:new Set(),closed:false,activation,task:!m.operation&&!m.managedHook,completed:false};controllers.set('request:'+m.id,controller);
 try{const value=store?await contexts.run(store,()=>handler({signal:controller.signal})):await handler({signal:controller.signal});await settleScope(store);store.completed=!controller.signal.aborted;return value;}
 finally{if(store)store.closed=true;controllers.delete('request:'+m.id);if(!activation)controller.abort();}
}
async function runJob(title,work,options={}){
 if(typeof work!=='function'||!options||typeof options!=='object'||Object.keys(options).some(key=>!['timeoutMs','signal'].includes(key)))throw Error('Invalid job options or callback');
 const operation=String(++sequence),controller=new AbortController(),parent=scopeSignal(),signals=[controller.signal,parent,options.signal].filter(Boolean),signal=signals.length===1?controller.signal:AbortSignal.any(signals),task={operation,signal,calls:new Set(),closed:false,completed:false};let started=false;
 const abort=()=>{if(started)call('jobs.cancel',{operation}).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});controllers.set(operation,controller);
 try{
  if(signal.aborted)throw Object.assign(Error('Job canceled'),{name:'AbortError'});await call('jobs.start',{operation,title,...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})});started=true;
  if(signal.aborted){abort();throw Object.assign(Error('Job canceled'),{name:'AbortError'});}
  const result=await jobScopes.run(task,()=>work({signal,progress:(fraction,message)=>call('jobs.progress',{operation,fraction,message})}));task.closed=true;const settled=await Promise.allSettled([...task.calls]);const failed=settled.find(value=>value.status==='rejected');if(failed)throw failed.reason;task.completed=true;return result;
 }finally{task.closed=true;if(!task.completed)controller.abort();controllers.delete(operation);signal.removeEventListener('abort',abort);if(started)await call('jobs.finish',{operation}).catch(()=>{});}
}
async function managedProcess(input,server){
 const {signal=processSignal(),...args}=input;
 if(signal?.aborted)throw Error('Process canceled');
 const token=String(++sequence);let native;const kill=()=>native?call('processes.kill',{id:native.id}):call('processes.cancelStart',{token}),closeOutput=()=>call('processes.closeOutput',{id:native.id});
 const abort=()=>kill().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
 try{native=await call(server?'processes.serverStart':'processes.start',server?{...args,token}:args);}catch(error){signal?.removeEventListener('abort',abort);throw error;}if(signal?.aborted)abort();
 let iterated=false,ended=false;
 const disposable=track({dispose:async()=>{await closeOutput().catch(()=>{});await kill().catch(()=>{});}});
 const result=call('processes.wait',{id:native.id}).catch(error=>{forget(disposable);throw error;}).finally(()=>{signal?.removeEventListener('abort',abort);if(ended||(args.output??(server?'stream':'capture'))==='capture')forget(disposable);});result.catch(()=>{});
 const output={ [Symbol.asyncIterator](){
  if(iterated)throw Error('Process output has one consumer');iterated=true;
  return {async next(){if(ended)return {done:true};try{const value=await call('processes.read',{id:native.id});if(value.done){ended=true;forget(disposable);}return value;}catch(error){ended=true;await closeOutput().catch(()=>{});forget(disposable);throw error;}},async return(){ended=true;await closeOutput();forget(disposable);return {done:true};}};
 }};
 return {...native,result,output,kill};
}
async function uiRegistration(kind,input){
 const registered=await call('ui.register'+kind[0].toUpperCase()+kind.slice(1),input);let disposal;
 const disposable={...(registered.instance?{instance:registered.instance}:{}),dispose:()=>disposal??=(call('ui.remove',{kind,id:input.id}).then(()=>{}).catch(()=>{}))};
 if(['action','status'].includes(kind))disposable.update=patch=>call(kind==='action'?'ui.updateAction':'ui.updateStatus',{...patch,id:input.id,instance:registered.instance});
 return track(disposable);
}
async function viewRegistration(input){
 if(views.has(input.id))throw Error('View already registered');
 const record={messages:new Set(),closed:new Set(),disposed:false,disposal:null};views.set(input.id,record);
 try{
  const registration=await uiRegistration('view',input);
  const subscribe=(set,callback)=>{
   if(record.disposed)throw Error('View registration disposed');
   if(typeof callback!=='function'||set.size>=32)throw Error('View listener limit reached');
   set.add(callback);const d={dispose:()=>set.delete(callback)};return track(d);
  };
  return {
   dispose:()=>{if(record.disposal)return record.disposal;record.disposed=true;record.disposal=registration.dispose().finally(()=>{if(views.get(input.id)===record)views.delete(input.id);});return record.disposal;},
   setPlacement:destination=>record.disposed?Promise.reject(Error('View registration disposed')):call('ui.viewMove',{id:input.id,instance:registration.instance,destination}),
   postMessage:value=>record.disposed?Promise.reject(Error('View registration disposed')):call('ui.viewPost',{id:input.id,value}),
   reveal:()=>record.disposed?Promise.reject(Error('View registration disposed')):call('ui.viewReveal',{id:input.id}),
   onMessage:callback=>subscribe(record.messages,callback),onDidClose:callback=>subscribe(record.closed,callback)
  };
 }catch(error){if(views.get(input.id)===record)views.delete(input.id);throw error;}
}
async function hookRegistration(name,contractOrHandler,handlerOrOptions,options={}){
 const typed=typeof contractOrHandler!=='function',handler=typed?handlerOrOptions:contractOrHandler,metadata=typed?{...options,contract:hookContract(contractOrHandler)}:handlerOrOptions??{};
 if(typeof handler!=='function'||hooks.has(name))throw Error('Invalid or duplicate hook handler');
 const record={handler,instance:require('node:crypto').randomUUID()};hooks.set(name,record);
 const disposable=track({async dispose(){if(hooks.get(name)!==record)return;hooks.delete(name);await call('hooks.register.remove',{id:name,instance:record.instance});}});
 try{await call('hooks.register',{id:name,metadata,instance:record.instance});return disposable;}catch(error){if(hooks.get(name)===record)hooks.delete(name);forget(disposable);throw error;}
}
async function defineHook(id,contract){
 const point=await call('hooks.define',{id,contract:hookContract(contract)});let disposed=false;
 return track({id:point.id,async dispose(){if(disposed)return;disposed=true;await call('hooks.define.remove',point);},async run(input,{signal=scopeSignal(),timeoutMs}={}){
  if(disposed)throw Error('Custom hook definition is disposed');if(signal?.aborted)throw Object.assign(Error('Custom hook canceled'),{name:'AbortError'});
  const token=String(++sequence),abort=()=>call('hooks.cancel',{token}).catch(()=>{}),result=call('hooks.run',{...point,input:copyPayload(input,{label:'Hook input'}).value,token,...(timeoutMs===undefined?{}:{timeoutMs})});
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}
 }});
}
function registration(map,id,handler,method,metadata){if(map.has(id))throw Error('Duplicate registration: '+id);map.set(id,handler);const ready=call(method,{id,metadata});const disposable={dispose(){if(map.delete(id))call(method+'.remove',{id}).catch(()=>{});}};track(disposable);return ready.then(()=>disposable,err=>{forget(disposable);map.delete(id);throw err;});}
port.on('message',event=>{
 if(!['start','invoke','event','stream-next','stream-close','debugger','stop'].includes(event.data.type))return handleMessage(event);
 const record={id:event.data.id,closed:false,completed:false,canceled:false,failed:false};executionRecords.set(record.id,record);
 return executions.run(record,async()=>{try{await handleMessage(event);}finally{record.closed=true;record.completed=!record.failed&&!record.canceled;if(executionRecords.get(record.id)===record)executionRecords.delete(record.id);}});
});
async function handleMessage({data:m}){
 if(m.type==='export-progress'){const callback=exportProgress.get(m.token);if(callback)Promise.resolve().then(()=>callback(m.value)).catch(()=>{});return;}
 if(m.type==='reply'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Object.assign(Error(m.error),m.errorName==='AbortError'?{name:'AbortError'}:{})):p.resolve(m.value);}return;}
 if(m.type==='event'){
  const controller=new AbortController(),store={controller,calls:new Set(),closed:false,event:true,completed:false};controllers.set('event:'+m.id,controller);
  const source=Object.freeze({...m.meta.source,...(m.meta.source.extensionIds?{extensionIds:Object.freeze([...m.meta.source.extensionIds])}:{})}),context=Object.freeze({...m.meta,source,...(m.meta.changes?{changes:Object.freeze([...m.meta.changes])}:{}),signal:controller.signal});
  try{await contexts.run(store,async()=>{
   for(const listener of events.listeners(m.name)){if(controller.signal.aborted)break;if(!events.listeners(m.name).includes(listener)||m.listener&&listener.subscription!==m.listener||listener.publications.has(m.meta.publication))continue;listener.publications.add(m.meta.publication);if(listener.publications.size>128)listener.publications.delete(listener.publications.values().next().value);try{await listener(m.value,context);}catch(error){await call('log',{level:'error',message:String(error?.message??error??'Event listener failed without an error').slice(0,1000)}).catch(()=>{});}}
   await settleScope(store);store.completed=!controller.signal.aborted;
  });}catch(error){await call('log',{level:'error',message:String(error?.message??error??'Event listener failed without an error').slice(0,1000)}).catch(()=>{});}
  finally{store.closed=true;controllers.delete('event:'+m.id);controller.abort();port.postMessage({type:'event-ack',id:m.id});}return;
 }
 if(m.type==='cancel-event'){const record=executionRecords.get(m.id);if(record)record.canceled=true;controllers.get('event:'+m.id)?.abort();return;}
 if(m.type==='cancel-request'){const record=executionRecords.get(m.id);if(record)record.canceled=true;controllers.get('request:'+m.id)?.abort();return;}
 if(m.type==='cancel'){controllers.get(m.operation)?.abort();return;}
 try{
  let value;
  if(m.type==='debugger'){
   const inspector=require('node:inspector');if(m.enabled){if(!inspector.url())inspector.open(0,'127.0.0.1',false);value={url:inspector.url()};if(!value.url)throw Error('Node inspector is unavailable in this runtime');}else{inspector.close();value={url:null};}
  }else if(m.type==='start'){
   const bind=(namespace,names)=>Object.fromEntries(names.map(name=>[name,args=>call(namespace+'.'+name,args)]));
   const context={extension:{id:m.manifest.id,path:m.directory,storagePath:m.storage,generation:m.generation},subscriptions,
    commands:{register:(id,handler)=>registration(commands,id,handler,'commands.register'),execute:(id,input)=>call('commands.execute',{id,input})},
    services:{register:(id,implementation,metadata={})=>registration(services,id,implementation,'services.register',metadata),registerTyped:(id,contract,implementation,metadata={})=>{const checked=serviceContract(contract);if(Object.keys(implementation).length!==Object.keys(checked.methods).length||Object.keys(checked.methods).some(method=>typeof implementation[method]!=='function'))throw Error('Service implementation must match its contract');return registration(services,id,implementation,'services.register',{...metadata,contract:checked});},async connect(id,contract){const checked=serviceContract(contract),entry=await call('services.describe',{id});if(!entry||!entry.contract||JSON.stringify(serviceContract(entry.contract))!==JSON.stringify(checked))throw Error('Service contract is unavailable or incompatible');return {call:(method,input)=>{if(!Object.hasOwn(checked.methods,method)||checked.methods[method].stream)throw Error('Unknown service call method');return call('services.call',{id,method,input,contract:checked});},stream:(method,input,options)=>{if(!Object.hasOwn(checked.methods,method)||!checked.methods[method].stream)throw Error('Unknown service stream method');return context.services.stream(id,method,input,{...options,contract:checked});}};},list:()=>call('services.list'),call:(id,method,input)=>call('services.call',{id,method,input}),describe:id=>call('services.describe',{id}),async *stream(id,method,input,{signal=scopeSignal(),contract}={}){if(signal?.aborted)throw Error('Service stream canceled');const stream=await call('services.openStream',{id,method,input,...(contract?{contract}:{})});const close=()=>call('services.close',stream).catch(()=>{}),abort=()=>close();signal?.addEventListener('abort',abort,{once:true});try{while(true){if(signal?.aborted)throw Error('Service stream canceled');const step=await call('services.next',stream);if(step.done)return;yield step.value;}}finally{signal?.removeEventListener('abort',abort);await close();}}},
    events:{on(name,handler,options={}){
     if(!options||typeof options!=='object'||Object.keys(options).some(key=>key!=='replay')||options.replay!==undefined&&typeof options.replay!=='boolean')throw Error('Invalid event subscription options');
     if(typeof name!=='string'||typeof handler!=='function'||events.listenerCount(name)>=32||events.eventNames().length>=128&&!events.listenerCount(name))throw Error('Event listener limit or invalid subscription');
     const listener=(...args)=>handler(...args);listener.subscription=String(++sequence);listener.publications=new Set();events.on(name,listener);const ready=call('events.subscribe',{name,replay:options.replay===true,listener:listener.subscription}).then(()=>{});ready.catch(error=>{events.off(name,listener);call('log',{level:'error',message:error.message}).catch(()=>{});});let disposal;
     const d={ready,dispose:()=>{if(disposal)return disposal;events.off(name,listener);disposal=events.listenerCount(name)?Promise.resolve():call('events.unsubscribe',{name}).then(()=>{});disposal.catch(()=>{});return disposal;}};return track(d);
    },emit:async(name,value)=>call('events.emit',{name,value:copyPayload(value).value})},
    hooks:{register:hookRegistration,define:defineHook,list:input=>call('hooks.list',input)},
    configuration:{get:(key,options)=>call('configuration.get',options?{key,...options}:key),update:async input=>{if(input?.value!==undefined)input={...input,value:(await import('../../shared/extensionConfiguration.mjs')).configurationValue(input.value)};return call('configuration.update',input);}},secrets:bind('secrets',['get','store','delete']),
    files:{publish:publishFile},host:bind('host',['read','capabilities']),rendering:bind('rendering',['list','validate']),timeline:bind('timeline',['types','read','apply']),editor:{...bind('editor',['read','apply','undo']),tools:{list:()=>call('editor.tools.list'),run:(calls,options={})=>call('editor.tools.run',{calls:Array.isArray(calls)?calls:[calls],atomic:options?.atomic!==false})}},projects:bind('projects',['status','create','open','save','close']),workspace:bind('workspace',['read','inspect','readValue']),media:bind('media',['import','preview','insert','release']),exports:{async render(input={}, {signal=scopeSignal(),onProgress}={}){if(signal?.aborted)throw Object.assign(Error('Export canceled'),{name:'AbortError'});const token=String(++sequence);if(onProgress!==undefined&&typeof onProgress!=='function')throw Error('onProgress must be a function');if(onProgress)exportProgress.set(token,onProgress);const abort=()=>call('exports.cancel',{token}).catch(()=>{});const result=call('exports.render',{token,input});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);exportProgress.delete(token);}}},captions:bind('captions',['read','write']),markers:bind('markers',['apply']),ui:{showInput:inputPrompt,showOpenDialog:(input,options)=>fileDialog('ui.showOpenDialog',input,options),showSaveDialog:(input,options)=>fileDialog('ui.showSaveDialog',input,options),async showMessage(input,{signal=scopeSignal()}={}){if(signal?.aborted)return;const token=String(++sequence),abort=()=>call('ui.dismissMessage',{token}).catch(()=>{});const result=call('ui.showMessage',{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}},registerShortcut:input=>uiRegistration('shortcut',input),registerView:viewRegistration,registerSettings:input=>uiRegistration('settings',input),registerStatus:input=>uiRegistration('status',input),registerAction:input=>uiRegistration('action',input),registerInspector:input=>uiRegistration('inspector',input),registerIntegration:input=>uiRegistration('integration',input)},
    jobs:{run:runJob},
    processes:{spawn:input=>managedProcess(input,false),startServer:input=>managedProcess(input,true)},
    log:(message,level='info')=>call('log',{level,message:String(message)})};
   const module=require(m.entry);if(typeof module.activate!=='function')throw Error('Extension must export activate(context)');deactivate=module.deactivate;await scoped(m,()=>module.activate(context),true);value=true;
  }else if(m.type==='invoke'){
   if(m.kind==='command'){const handler=commands.get(m.name);if(!handler)throw Error('Command not registered');value=await scoped(m,control=>handler(m.input,control));}
   else if(m.kind==='view-message'||m.kind==='view-closed'){const record=views.get(m.name);if(!record)throw Error('View registration stopped');value=await scoped(m,async control=>{for(const listener of m.kind==='view-message'?record.messages:record.closed)await listener(m.input,control);return true;});}
   else if(m.kind==='hook'){const record=hooks.get(m.name);if(!record||m.hookInstance!==undefined&&record.instance!==m.hookInstance)throw Error('Hook registration changed');value=await scoped(m,control=>record.handler(m.input,{...control,...m.hookInfo}));}
   else if(m.kind==='service-stream'){const service=services.get(m.name);if(!service||!Object.hasOwn(service,m.method)||typeof service[m.method]!=='function')throw Error('Unknown service method');const controller=new AbortController();controllers.set('request:'+m.id,controller);const scope=m.operation?{operation:m.operation,controller,calls:new Set(),closed:false}:null;let iterable;try{iterable=scope?await contexts.run(scope,()=>service[m.method](m.input,{signal:controller.signal})):await service[m.method](m.input,{signal:controller.signal});if(controller.signal.aborted)throw Error('Service stream canceled');if(typeof iterable?.[Symbol.asyncIterator]!=='function')throw Error('Streaming service must return an AsyncIterable');}catch(e){controller.abort();throw e;}finally{controllers.delete('request:'+m.id);}const id=String(++sequence);streams.set(id,{iterator:iterable[Symbol.asyncIterator](),controller,scope});value={id};}
   else {const service=services.get(m.name);if(!service||!Object.hasOwn(service,m.method)||typeof service[m.method]!=='function')throw Error('Unknown service method');value=await scoped(m,control=>service[m.method](m.input,control));}
  }else if(m.type==='stream-next'){
   const stream=streams.get(m.name);if(!stream)throw Error('Stream closed');
   try{value=stream.scope?await contexts.run(stream.scope,()=>stream.iterator.next()):await stream.iterator.next();if(stream.controller.signal.aborted)throw Error('Service stream canceled');if(value.done){await settleScope(stream.scope);streams.delete(m.name);stream.controller.abort();}else value={done:false,value:streamChunk(value.value)};}
   catch(e){streams.delete(m.name);stream.controller.abort();if(stream.scope)stream.scope.closed=true;Promise.resolve(stream.scope?contexts.run(stream.scope,()=>stream.iterator.return?.()):stream.iterator.return?.()).catch(()=>{});throw e;}
  }else if(m.type==='stream-close'){
   const stream=streams.get(m.name);streams.delete(m.name);if(stream){stream.controller.abort();try{if(stream.scope)await contexts.run(stream.scope,()=>stream.iterator.return?.());else await stream.iterator.return?.();}finally{await settleScope(stream.scope);}}value=true;
  }else if(m.type==='stop'&&disposed){value=true;
  }else if(m.type==='stop'){for(const stream of streams.values())stream.controller.abort();await Promise.allSettled([...streams.values()].map(s=>s.scope?contexts.run(s.scope,()=>s.iterator.return?.()):s.iterator.return?.()));streams.clear();for(const c of controllers.values())c.abort();await deactivate?.();for(const d of subscriptions.splice(0).reverse())await d.dispose?.();disposed=true;for(const p of pending.values())p.reject(Error('Extension disposed'));pending.clear();}
  port.postMessage({type:'result',id:m.id,value});
 }catch(error){const execution=executions.getStore();if(execution)execution.failed=true;call('log',{level:'error',message:String(error?.stack||error).slice(0,8000)}).catch(()=>{});port.postMessage({type:'result',id:m.id,error:String(error?.message||error||'Extension handler failed without an error').slice(0,2000)});}
}
