const {serviceMethod,serviceValue,matchServiceContract}=require('../../shared/extensionServices.cjs');
const crypto=require('node:crypto');
const {copyPayload}=require('./extensionData.cjs');
// Pull-based service streams keep at most one chunk in flight per consumer.
class ExtensionStreams {
 constructor(runtime){this.runtime=runtime;this.records=new Map();}
 live(job){return this.runtime.active.get(job.key)===job&&['running','activating'].includes(job.state);}
 async open(owner,input,operation,parentRequest,signal){
  if(!this.live(owner))throw Error('Stream consumer stopped');
  if(this.records.size>=64)throw Error('Too many open service streams');
  if(!this.runtime.services.has(input?.id))await this.runtime.activate('service:'+input?.id,{operation,agentScope:this.runtime.executionScope(owner,parentRequest)});
  const service=this.runtime.services.get(input?.id);if(!service)throw Error('Service unavailable');
  matchServiceContract(service.contract,input.contract);const contract=serviceMethod(service.contract,input.method,service.contract?copyPayload(input.input,{label:'Service input'}).value:input.input,true);
  if(operation)this.runtime.operations.join(operation,service.job);
  const remote=await this.runtime.request(service.job,{type:'invoke',kind:'service-stream',name:service.local,method:input.method,input:input.input,...(operation?{operation}:{})},300000,owner,signal||(operation?this.runtime.operations.signal(operation):this.runtime.requestSignal(owner,parentRequest)),parentRequest);
  if(typeof remote?.id!=='string')throw Error('Service returned an invalid stream');
  if(!this.live(owner)||signal?.aborted){await this.runtime.request(service.job,{type:'stream-close',name:remote.id},5000);throw Error('Stream consumer stopped');}
  const id=crypto.randomUUID();this.records.set(id,{id,owner,provider:service.job,remote:remote.id,busy:false,operation,contract});if(operation){const signal=this.runtime.operations.signal(operation),abort=()=>this.close(owner,id).catch(()=>{});signal.addEventListener('abort',abort,{once:true});this.records.get(id).cleanup=()=>signal.removeEventListener('abort',abort);if(signal.aborted)abort();}return {id};
 }
 record(owner,id){const record=this.records.get(id);if(!record||record.owner!==owner||!this.live(owner)||!this.live(record.provider))throw Error('Service stream unavailable');if(record.operation)this.runtime.operations.authorize(owner,record.operation,'services.next');return record;}
 async next(owner,id,parentRequest,signal){
  const record=this.record(owner,id);if(record.busy)throw Error('Only one stream read may be pending');record.busy=true;
  try{const result=await this.runtime.request(record.provider,{type:'stream-next',name:record.remote,...(record.operation?{operation:record.operation}:{})},300000,owner,signal||(record.operation?this.runtime.operations.signal(record.operation):this.runtime.requestSignal(owner,parentRequest)),parentRequest);if(!result||typeof result.done!=='boolean')throw Error('Invalid stream result');if(result.done){this.records.delete(id);record.cleanup?.();}else if(record.contract)serviceValue(record.contract.output,result.value,'Service stream chunk');return result;}
  catch(e){await this.close(owner,id);throw e;}finally{record.busy=false;}
 }
 async close(owner,id){
  const record=this.records.get(id);if(!record||record.owner!==owner)return false;this.records.delete(id);record.cleanup?.();
  if(this.live(record.provider))await this.runtime.request(record.provider,{type:'stream-close',name:record.remote},5000);
  return true;
 }
 async stopped(job){await Promise.allSettled([...this.records.values()].filter(r=>r.owner===job||r.provider===job).map(r=>this.close(r.owner,r.id)));}
}
module.exports={ExtensionStreams};
