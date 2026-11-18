// Native-only ownership for a command invoked from CraftAI. Scope IDs never
// enter the worker protocol; nested requests inherit them through native parents.
const {copyPayload}=require('./extensionData.cjs');
const canceled=()=>Object.assign(Error('Extension command canceled'),{name:'AbortError'});
class ExtensionAgentCommands{
 constructor({runtime,manager,approve,timeoutMs=1800000}){Object.assign(this,{runtime,manager,approve,timeoutMs});this.records=new Map();}
 assert(id,owner){const record=this.records.get(id);if(!record||record.controller.signal.aborted||record.owner.isDestroyed()||owner&&record.owner!==owner)throw canceled();return record;}
 signal(id){return this.assert(id).controller.signal;}
 track(id,cleanup){this.assert(id).cleanups.push(cleanup);}
 receipt(id,value){const record=this.records.get(id);if(!record)return false;const copied=copyPayload(value,{limit:65536});if(record.receipts.length>=128||record.receiptBytes+copied.bytes>262144){record.receiptsTruncated=true;return false;}record.receiptBytes+=copied.bytes;record.receipts.push(copied.value);return true;}
 cancel(owner,id){const record=this.records.get(id);if(!record||record.owner!==owner)return false;record.controller.abort();return true;}
 progress(){for(const task of this.runtime.jobsHost?.records||[]){const id=this.runtime.executionScope(task.job,task.parentRequest),record=this.records.get(id),value=task.job.jobs.get(task.operation);if(!record||record.controller.signal.aborted||record.owner.isDestroyed()||!value)continue;const signature=JSON.stringify([task.operation,value.fraction,value.message,value.canceling]);record.taskProgress??=new WeakMap();if(signature===record.taskProgress.get(task))continue;record.taskProgress.set(task,signature);try{record.owner.send?.('plugins:extensionAgentProgress',{id,title:value.title,fraction:value.fraction,message:value.message,extensionId:task.job.manifest.id});}catch{}}}
 async run(owner,input){
  if(!input||Object.keys(input).some(key=>!['id','key','commandId','input'].includes(key))||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||typeof input.key!=='string'||!/^[a-f0-9]{64}$/.test(input.key)||typeof input.commandId!=='string'||!/^[a-z][\w.-]{0,127}$/.test(input.commandId))throw Error('Invalid extension command identity');
  const value=copyPayload(input.input===undefined?{}:input.input,{label:'Command arguments',limit:16384}).value;
  if(!value||typeof value!=='object'||Array.isArray(value)||value instanceof Uint8Array)throw Error('Command arguments must be a plain object');
  if(this.records.has(input.id)||[...this.records.values()].some(record=>record.owner===owner))throw Error('Another agent extension command is in progress');
  const record={id:input.id,owner,key:input.key,controller:new AbortController(),receipts:[],receiptBytes:0,cleanups:[]};this.records.set(input.id,record);
  const closed=()=>record.controller.abort();for(const name of ['destroyed','render-process-gone','did-navigate'])owner.on(name,closed);
  const timer=setTimeout(closed,this.timeoutMs);timer.unref?.();let stop;
  const aborted=new Promise((_,reject)=>{stop=()=>reject(canceled());record.controller.signal.addEventListener('abort',stop,{once:true});});aborted.catch(()=>{});
  try{
   this.assert(record.id);let bundle=await this.manager.commandBundle(input.key);this.assert(record.id);
   const command=bundle.manifest.main&&bundle.manifest.contributes.commands.find(command=>command.id===input.commandId);
   if(!command)throw Error('Discover an available declared Node command first');
   if(!(await this.runtime.trustData())[input.key])throw Error('Trust and activate this extension in Plugins settings first');
   if(this.runtime.suspended.has(input.key))throw Error('Activate this stopped or failed extension in Plugins settings first');
   record.owner.send?.('plugins:extensionAgentProgress',{id:record.id,title:command.name,message:'Waiting for approval in ClipCraft',extensionId:bundle.manifest.id});
   const approved=await Promise.race([this.approve({manifest:bundle.manifest,command,key:input.key,signal:record.controller.signal}),aborted]);this.assert(record.id);
   if(!approved)return {status:'denied',receipts:[]};
   // Re-read the immutable bundle after native review. A disabled/replaced
   // package must not inherit an earlier approval.
   bundle=await this.manager.commandBundle(input.key);this.assert(record.id);
   if(!bundle.manifest.main||!bundle.manifest.contributes.commands.some(command=>command.id===input.commandId)||!(await this.runtime.trustData())[input.key]||this.runtime.suspended.has(input.key))throw Error('Extension command is no longer available');
   const result=await Promise.race([this.runtime.execute(bundle.manifest.id+'.'+input.commandId,value,{key:input.key,signal:record.controller.signal,agentScope:record.id}),aborted]);this.assert(record.id);
   return {status:'completed',receipts:record.receipts,...(record.receiptsTruncated?{receipts_truncated:true}:{}),untrusted_extension_response:copyPayload(result,{label:'Command response',limit:65536}).value};
  }catch(error){return {status:record.controller.signal.aborted?'canceled':'failed',error:String(error.message||error).slice(0,2000),receipts:record.receipts,...(record.receiptsTruncated?{receipts_truncated:true}:{})};}
  finally{clearTimeout(timer);record.controller.signal.removeEventListener('abort',stop);this.records.delete(record.id);for(const cleanup of record.cleanups)try{cleanup();}catch{}for(const name of ['destroyed','render-process-gone','did-navigate'])owner.removeListener(name,closed);}
 }
}
module.exports={ExtensionAgentCommands};
