// Trusted worker host. Code is passed as data, not interpolated into this bootstrap.
function commandWorker(){
 let sequence=0;const pending=new Map();
 const call=(method,args=null)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});postMessage({kind:'call',id,method,args});});
 self.onmessage=async event=>{
  const message=event.data;
  if(message.kind==='reply'){
   const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);message.error?entry.reject(Error(message.error)):entry.resolve(message.result);return;
  }
  if(message.kind!=='start')return;
  try{
   if(message.development){let logs=0;for(const [method,level] of Object.entries({debug:'debug',log:'info',info:'info',warn:'warning',error:'error'})){const original=console[method].bind(console);console[method]=(...args)=>{original(...args);if(logs++>=32)return;let text;try{text=args.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ').slice(0,1000);}catch{text='[Unserializable console value]';}postMessage({kind:'log',level,message:text});};}}
   const url=URL.createObjectURL(new Blob([message.code],{type:'text/javascript'}));
   const module=await import(url);URL.revokeObjectURL(url);
   if(typeof module.run!=='function')throw Error('commands.js must export a run function.');
   const context=Object.freeze({editor:Object.freeze({read:()=>call('editor.read'),stage:transaction=>call('editor.stage',transaction)}),command:Object.freeze({id:message.commandId}),exports:Object.freeze({gif:args=>call('export.gif',args)}),project:Object.freeze({read:()=>call('project.read')}),transcript:Object.freeze({read:()=>call('transcript.read')}),ai:Object.freeze({chapters:args=>call('ai.chapters',args),translateCaptions:args=>call('ai.translateCaptions',args)}),captions:Object.freeze({addTranslation:args=>call('captions.addTranslation',args)}),markers:Object.freeze({add:markers=>call('markers.add',markers)}),progress:(fraction,text='')=>call('progress',{fraction,message:text})});
   const result=await module.run(context,Object.freeze(message.input));
   postMessage({kind:'finish',ok:true,message:result?.message??''});
  }catch(error){postMessage({kind:'finish',ok:false,error:String(error.message||error).slice(0,2000)});}
 };
}
(async()=>{
 const job=await window.commandHost.job();
 const url=URL.createObjectURL(new Blob([`(${commandWorker.toString()})()`],{type:'text/javascript'}));
 const worker=new Worker(url,{type:'module'});URL.revokeObjectURL(url);
 let stopped=false,calls=0,logs=0;
 const finish=async result=>{if(stopped)return;stopped=true;worker.terminate();await window.commandHost.finish(job.token,result);};
 worker.onerror=event=>{event.preventDefault();finish({ok:false,error:String(event.message||'Command worker failed.').slice(0,2000)}).catch(()=>{});};
 worker.onmessage=async event=>{
  if(stopped)return;
  const message=event.data;
  try{
   if(!message||JSON.stringify(message).length>256*1024)throw Error('Oversized command worker message.');
   if(message.kind==='log'){
    if(!job.development||logs++>=32)return;
    if(!['debug','info','warning','error'].includes(message.level)||typeof message.message!=='string'||message.message.length>1000)throw Error('Invalid development log.');
    await window.commandHost.log(job.token,{level:message.level,message:message.message});
   }else if(message.kind==='call'){
    if(++calls>64||!Number.isInteger(message.id)||message.id<1)throw Error('Invalid command broker request.');
    try{const result=await window.commandHost.call(job.token,message.method,message.args);if(!stopped)worker.postMessage({kind:'reply',id:message.id,result});}
    catch(error){if(!stopped)worker.postMessage({kind:'reply',id:message.id,error:String(error.message).slice(0,2000)});}
   }else if(message.kind==='finish')await finish({ok:message.ok,message:message.message,error:message.error});
   else throw Error('Unknown command worker message.');
  }catch(error){finish({ok:false,error:String(error.message).slice(0,2000)}).catch(()=>{});}
 };
 worker.postMessage({kind:'start',code:job.code,input:job.input,commandId:job.commandId,development:job.development});
})().catch(()=>{}); // Main-process watchdog owns startup failure reporting and cleanup.
