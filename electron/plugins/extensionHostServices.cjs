const {serviceContract,serviceMethod,serviceValue}=require('../../shared/extensionServices.cjs');
// Application-owned implementations share the ordinary services API. Node
// extensions cannot replace these registrations or their owner metadata.
const {copyPayload}=require('./extensionData.cjs');
const valid=/^[a-z][\w.-]{0,159}$/;
const canceled=()=>Object.assign(Error('Host service call canceled or unavailable'),{name:'AbortError'});
class ExtensionHostServices{
 constructor(runtime){this.runtime=runtime;this.entries=new Map();this.calls=new Set();}
 register(id,implementation,metadata={}){
  if(!valid.test(id)||!id.startsWith('clipcraft.')||this.entries.has(id)||this.runtime.services.has(id)||!implementation||typeof implementation!=='object'||!Object.keys(implementation).length||Object.keys(implementation).length>64||Object.entries(implementation).some(([name,fn])=>!valid.test(name)||typeof fn!=='function'))throw Error('Invalid or duplicate host service');
  metadata=copyPayload(metadata).value;const contract=metadata.contract===undefined?undefined:serviceContract(metadata.contract);if(contract){metadata.contract=contract;if(Object.keys(contract.methods).some(method=>typeof implementation[method]!=='function'))throw Error('Missing contracted host service method');}const entry={id,implementation:Object.freeze({...implementation}),metadata,contract};this.entries.set(id,entry);let disposed=false;
  return {dispose:()=>{if(disposed)return;disposed=true;if(this.entries.get(id)===entry)this.entries.delete(id);for(const call of this.calls)if(call.entry===entry)call.controller.abort();}};
 }
 list(){return [...this.entries.values()].map(entry=>({...entry.metadata,id:entry.id,extensionId:'clipcraft',host:true}));}
 live(owner){return owner&&this.runtime.active.get(owner.key)===owner&&['activating','running'].includes(owner.state);}
 async call(id,method,input,{owner,operation,parentRequest,jobOperation,signal,timeoutMs=300000}={}){
  const entry=this.entries.get(id);
  if(!entry||!Object.hasOwn(entry.implementation,method)||!this.live(owner))throw Error('Host service is unavailable');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Host service timeout must be one second to five minutes');
  if(this.calls.size>=64||[...this.calls].filter(call=>call.owner===owner).length>=16)throw Error('Too many host service calls');
  const value=copyPayload(input,{label:'Host service input'}).value,contract=serviceMethod(entry.contract,method,input),controller=new AbortController(),record={entry,owner,controller};this.calls.add(record);
  const verify=()=>{if(controller.signal.aborted||!this.live(owner)||this.entries.get(id)!==entry||!this.runtime.executionActive(owner,parentRequest))throw canceled();this.runtime.jobsHost.authorize(owner,jobOperation,'services.call');if(operation)this.runtime.operations.authorize(owner,operation,'services.call');};
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,timeoutMs);let abortListener;
  const stopped=new Promise((_,reject)=>{abortListener=()=>reject(canceled());controller.signal.addEventListener('abort',abortListener,{once:true});if(controller.signal.aborted)abortListener();});
  stopped.catch(()=>{});
  try{
   verify();const work=Promise.resolve().then(()=>{verify();return entry.implementation[method](value,{signal:controller.signal,verify,owner,operation,parentRequest,jobOperation});});
   const result=await Promise.race([work,stopped]);verify();const copied=copyPayload(result,{label:'Host service result'}).value;if(contract)serviceValue(contract.output,copied,'Host service result');return copied;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',abortListener);this.calls.delete(record);}
 }
 stopped(owner){for(const call of this.calls)if(call.owner===owner)call.controller.abort();}
}
module.exports={ExtensionHostServices};
