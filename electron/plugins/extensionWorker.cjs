const {serviceContract}=require('../../shared/extensionServices.cjs');
// Trusted Node extension host. Never loaded by an application renderer.
const {EventEmitter}=require('node:events');
const {AsyncLocalStorage}=require('node:async_hooks'),contexts=new AsyncLocalStorage(),executions=new AsyncLocalStorage(),jobScopes=new AsyncLocalStorage(),exportProgress=new Map(),executionRecords=new Map();
const pending=new Map(),commands=new Map(),services=new Map(),hooks=new Map(),views=new Map(),events=new EventEmitter(),subscriptions=[],controllers=new Map(),streams=new Map();let sequence=0,deactivate,disposed=false;
const port=process.parentPort;
const {copyPayload}=require('./extensionData.cjs');
const streamChunk=value=>copyPayload(value,{label:'Service stream chunk'}).value;
events.setMaxListeners(32);
const forget=disposable=>{const index=subscriptions.indexOf(disposable);if(index>=0)subscriptions.splice(index,1);};
const track=disposable=>{const dispose=disposable.dispose;disposable.dispose=function(...args){forget(disposable);return dispose.apply(this,args);};subscriptions.push(disposable);return disposable;};

const scopeSignal=()=>{const task=jobScopes.getStore();if(task&&!task.completed)return task.signal;const store=contexts.getStore();return store&&!store.closed&&!store.activation?store.controller.signal:undefined;};
async function fileDialog(method,input={}, {signal=scopeSignal()}={}){if(signal?.aborted)throw Object.assign(Error('File dialog canceled'),{name:'AbortError'});const token=String(++sequence),abort=()=>call('ui.cancelDialog',{token}).catch(()=>{});const result=call(method,{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}}
async function publishFile(input,{signal=scopeSignal()}={}){if(signal?.aborted)throw Object.assign(Error('File publication canceled'),{name:'AbortError'});const token=String(++sequence),abort=()=>call('files.cancel',{token}).catch(()=>{}),result=call('files.publish',{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}}
const processSignal=()=>{const task=jobScopes.getStore();if(task&&!task.completed)return task.signal;const store=contexts.getStore();return store?.operation&&!store.activation?store.controller.signal:undefined;};
function call(method,args){
 if(disposed)return Promise.reject(Error('Extension disposed'));
 const task=jobScopes.getStore(),execution=executions.getStore(),projectSetting=method.startsWith('configuration.')&&args?.scope==='project',cleanup=['log','jobs.finish','jobs.cancel','processes.kill','services.close','media.release','ui.dismissMessage','ui.cancelDialog','files.cancel','events.unsubscribe','exports.cancel','configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete','ui.remove','commands.register.remove','services.register.remove','hooks.register.remove'].includes(method)&&!projectSetting;
 if(task&&(task.signal.aborted||task.closed&&!task.completed)&&!cleanup)return Promise.reject(Object.assign(Error('Extension job canceled or finished'),{name:'AbortError'}));
 if(execution&&(execution.canceled||execution.closed&&!execution.completed)&&!cleanup)return Promise.reject(Error('Extension callback canceled or finished'));
 let store=contexts.getStore(),parentRequest=execution?.closed?undefined:execution?.id;if(store&&!projectSetting&&(store.closed||store.controller.signal.aborted)&&['log','jobs.finish','jobs.cancel','processes.kill','services.close','media.release','ui.dismissMessage','ui.cancelDialog','files.cancel','events.unsubscribe','exports.cancel','configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete','ui.remove','commands.register.remove','services.register.remove','hooks.register.remove'].includes(method)){store=null;parentRequest=undefined;}
 if(store?.closed){if(store.activation||store.task&&store.completed||store.event&&store.completed){store=null;parentRequest=undefined;}else return Promise.reject(Error('Extension callback already finished'));}
 if(store?.controller.signal.aborted)return Promise.reject(Error('Extension callback canceled'));
 const lifetimeWait=method==='processes.wait'&&(store?.activation||!store?.operation);
 const jobOperation=task&&!task.closed&&!task.signal.aborted?task.operation:undefined;
 const result=new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});port.postMessage({type:'call',id,method,args,parentRequest,...(jobOperation===undefined?{}:{jobOperation}),...(store?.operation&&!lifetimeWait?{operation:store.operation}:{})});});
 if(task&&!task.closed&&!lifetimeWait){task.calls.add(result);result.then(()=>task.calls.delete(result),()=>task.calls.delete(result));}
 if(store&&!lifetimeWait){store.calls.add(result);result.then(()=>store.calls.delete(result),error=>{store.calls.delete(result);if(store.operation&&['editor.apply','captions.write','media.insert','markers.apply'].includes(method))store.failure??=error;});}
 return result;
}
async function settleScope(store){if(!store)return;store.closed=true;const results=await Promise.allSettled([...store.calls]);if(store.failure)throw store.failure;const error=results.find(result=>result.status==='rejected');if(error)throw error.reason;}
async function scoped(m,handler,activation=false){
 const controller=new AbortController(),store={...(m.operation?{operation:m.operation}:{}),controller,calls:new Set(),closed:false,activation,task:!m.operation,completed:false};controllers.set('request:'+m.id,controller);
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
async function uiRegistration(kind,input){
 await call('ui.register'+kind[0].toUpperCase()+kind.slice(1),input);let disposal;
 const disposable={dispose:()=>disposal??=(call('ui.remove',{kind,id:input.id}).then(()=>{}).catch(()=>{}))};
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
   postMessage:value=>record.disposed?Promise.reject(Error('View registration disposed')):call('ui.viewPost',{id:input.id,value}),
   reveal:()=>record.disposed?Promise.reject(Error('View registration disposed')):call('ui.viewReveal',{id:input.id}),
   onMessage:callback=>subscribe(record.messages,callback),onDidClose:callback=>subscribe(record.closed,callback)
  };
 }catch(error){if(views.get(input.id)===record)views.delete(input.id);throw error;}
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
   for(const listener of events.listeners(m.name)){if(controller.signal.aborted)break;if(!events.listeners(m.name).includes(listener))continue;try{await listener(m.value,context);}catch(error){await call('log',{level:'error',message:String(error.message||error).slice(0,1000)}).catch(()=>{});}}
   await settleScope(store);store.completed=!controller.signal.aborted;
  });}catch(error){await call('log',{level:'error',message:String(error.message||error).slice(0,1000)}).catch(()=>{});}
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
     const listener=(...args)=>handler(...args);events.on(name,listener);const ready=call('events.subscribe',{name,replay:options.replay===true}).then(()=>{});ready.catch(error=>{events.off(name,listener);call('log',{level:'error',message:error.message}).catch(()=>{});});let disposal;
     const d={ready,dispose:()=>{if(disposal)return disposal;events.off(name,listener);disposal=events.listenerCount(name)?Promise.resolve():call('events.unsubscribe',{name}).then(()=>{});disposal.catch(()=>{});return disposal;}};return track(d);
    },emit:async(name,value)=>call('events.emit',{name,value:copyPayload(value).value})},
    hooks:{register:(name,handler,options={})=>registration(hooks,name,handler,'hooks.register',options)},
    configuration:{get:(key,options)=>call('configuration.get',options?{key,...options}:key),update:input=>call('configuration.update',input)},secrets:bind('secrets',['get','store','delete']),
    files:{publish:publishFile},host:bind('host',['read','capabilities']),editor:bind('editor',['read','apply']),workspace:bind('workspace',['read','inspect','readValue']),media:bind('media',['import','preview','insert','release']),exports:{async render(input={}, {signal=scopeSignal(),onProgress}={}){if(signal?.aborted)throw Object.assign(Error('Export canceled'),{name:'AbortError'});const token=String(++sequence);if(onProgress!==undefined&&typeof onProgress!=='function')throw Error('onProgress must be a function');if(onProgress)exportProgress.set(token,onProgress);const abort=()=>call('exports.cancel',{token}).catch(()=>{});const result=call('exports.render',{token,input});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);exportProgress.delete(token);}}},captions:bind('captions',['read','write']),markers:bind('markers',['apply']),ui:{showOpenDialog:(input,options)=>fileDialog('ui.showOpenDialog',input,options),showSaveDialog:(input,options)=>fileDialog('ui.showSaveDialog',input,options),async showMessage(input,{signal=scopeSignal()}={}){if(signal?.aborted)return;const token=String(++sequence),abort=()=>call('ui.dismissMessage',{token}).catch(()=>{});const result=call('ui.showMessage',{...input,token});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();try{return await result;}finally{signal?.removeEventListener('abort',abort);}},registerShortcut:input=>uiRegistration('shortcut',input),registerView:viewRegistration,registerSettings:input=>uiRegistration('settings',input),registerAction:input=>uiRegistration('action',input),registerIntegration:input=>uiRegistration('integration',input)},
    jobs:{run:runJob},
    processes:{async spawn(input){const {signal=processSignal(),...args}=input;if(signal?.aborted)throw Error('Process canceled');const process=await call('processes.start',args),kill=()=>call('processes.kill',{id:process.id});const abort=()=>kill().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const disposable=track({dispose:()=>kill().catch(()=>{})});const result=call('processes.wait',{id:process.id}).finally(()=>{signal?.removeEventListener('abort',abort);forget(disposable);});result.catch(()=>{});return {...process,result,kill};}},
    log:(message,level='info')=>call('log',{level,message:String(message)})};
   const module=require(m.entry);if(typeof module.activate!=='function')throw Error('Extension must export activate(context)');deactivate=module.deactivate;await scoped(m,()=>module.activate(context),true);value=true;
  }else if(m.type==='invoke'){
   if(m.kind==='command'){const handler=commands.get(m.name);if(!handler)throw Error('Command not registered');value=await scoped(m,control=>handler(m.input,control));}
   else if(m.kind==='view-message'||m.kind==='view-closed'){const record=views.get(m.name);if(!record)throw Error('View registration stopped');value=await scoped(m,async control=>{for(const listener of m.kind==='view-message'?record.messages:record.closed)await listener(m.input,control);return true;});}
   else if(m.kind==='hook'){const handler=hooks.get(m.name);if(!handler)throw Error('Hook not registered');value=await scoped(m,control=>handler(m.input,control));}
   else if(m.kind==='service-stream'){const service=services.get(m.name);if(!service||!Object.hasOwn(service,m.method)||typeof service[m.method]!=='function')throw Error('Unknown service method');const controller=new AbortController();controllers.set('request:'+m.id,controller);const scope=m.operation?{operation:m.operation,controller,calls:new Set(),closed:false}:null;let iterable;try{iterable=scope?await contexts.run(scope,()=>service[m.method](m.input,{signal:controller.signal})):await service[m.method](m.input,{signal:controller.signal});if(controller.signal.aborted)throw Error('Service stream canceled');if(typeof iterable?.[Symbol.asyncIterator]!=='function')throw Error('Streaming service must return an AsyncIterable');}catch(e){controller.abort();throw e;}finally{controllers.delete('request:'+m.id);}const id=String(++sequence);streams.set(id,{iterator:iterable[Symbol.asyncIterator](),controller,scope});value={id};}
   else {const service=services.get(m.name);if(!service||!Object.hasOwn(service,m.method)||typeof service[m.method]!=='function')throw Error('Unknown service method');value=await scoped(m,control=>service[m.method](m.input,control));}
  }else if(m.type==='stream-next'){
   const stream=streams.get(m.name);if(!stream)throw Error('Stream closed');
   try{value=stream.scope?await contexts.run(stream.scope,()=>stream.iterator.next()):await stream.iterator.next();if(stream.controller.signal.aborted)throw Error('Service stream canceled');if(value.done){await settleScope(stream.scope);streams.delete(m.name);stream.controller.abort();}else value={done:false,value:streamChunk(value.value)};}
   catch(e){streams.delete(m.name);stream.controller.abort();if(stream.scope)stream.scope.closed=true;Promise.resolve(stream.scope?contexts.run(stream.scope,()=>stream.iterator.return?.()):stream.iterator.return?.()).catch(()=>{});throw e;}
  }else if(m.type==='stream-close'){
   const stream=streams.get(m.name);streams.delete(m.name);if(stream){stream.controller.abort();try{if(stream.scope)await contexts.run(stream.scope,()=>stream.iterator.return?.());else await stream.iterator.return?.();}finally{await settleScope(stream.scope);}}value=true;
  }else if(m.type==='stop'){for(const stream of streams.values())stream.controller.abort();await Promise.allSettled([...streams.values()].map(s=>s.scope?contexts.run(s.scope,()=>s.iterator.return?.()):s.iterator.return?.()));streams.clear();for(const c of controllers.values())c.abort();await deactivate?.();for(const d of subscriptions.splice(0).reverse())await d.dispose?.();disposed=true;for(const p of pending.values())p.reject(Error('Extension disposed'));pending.clear();}
  port.postMessage({type:'result',id:m.id,value});
 }catch(error){const execution=executions.getStore();if(execution)execution.failed=true;call('log',{level:'error',message:String(error.stack||error).slice(0,8000)}).catch(()=>{});port.postMessage({type:'result',id:m.id,error:String(error.message||error).slice(0,2000)});}
}
