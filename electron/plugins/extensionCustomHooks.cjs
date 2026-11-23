const {randomUUID}=require('node:crypto');
const {copyPayload}=require('./extensionData.cjs');
const {hookContract,orderedHooks}=require('../../shared/extensionHookContracts.cjs');
const {serviceValue}=require('../../shared/extensionServices.cjs');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const aborted=()=>Object.assign(Error('Custom hook canceled'),{name:'AbortError'});
function waitActivation(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(aborted());};signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});if(signal.aborted)abort();});}
class ExtensionCustomHooks {
 constructor(runtime){this.runtime=runtime;this.points=new Map();this.runs=new Map();}
 define(job,input){
  if(!plain(input)||Object.keys(input).some(key=>!['id','contract'].includes(key))||typeof input.id!=='string'||!/^[a-z][\w.-]{0,63}$/.test(input.id))throw Error('Invalid custom hook point');
  const id=job.manifest.id+'.'+input.id;if(this.points.has(id))throw Error('Duplicate custom hook point');
  if(this.points.size>=256||[...this.points.values()].filter(point=>point.job===job).length>=32)throw Error('Custom hook definition limit exceeded');
  const point={id,local:input.id,job,instance:randomUUID(),contract:hookContract(input.contract)};this.points.set(id,point);return {id,instance:point.instance};
 }
 point(job,input){const point=this.points.get(input?.id);if(!point||point.job!==job||point.instance!==input.instance)throw Error('Custom hook definition changed or is owned by another extension');return point;}
 remove(job,input){const point=this.point(job,input);this.points.delete(point.id);for(const run of this.runs.values())if(run.point===point)run.controller.abort();return true;}
 list(input={}){
  if(!plain(input)||Object.keys(input).some(key=>!['cursor','limit','extensionId'].includes(key))||input.extensionId!==undefined&&(typeof input.extensionId!=='string'||input.extensionId.length>100))throw Error('Invalid hook catalog request');
  const cursor=input.cursor??0,limit=input.limit??16;if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>64)throw Error('Invalid hook catalog page');
  const rows=[...this.points.values()].filter(point=>!input.extensionId||point.job.manifest.id===input.extensionId).sort((a,b)=>a.id.localeCompare(b.id));if(cursor>rows.length)throw Error('Hook catalog cursor is outside the catalog');
  const items=[];let bytes=0;for(const point of rows.slice(cursor,cursor+limit)){const item={id:point.id,extensionId:point.job.manifest.id,contract:point.contract},size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>256*1024)break;bytes+=size;items.push(item);}return copyPayload({items,total:rows.length,next:cursor+items.length<rows.length?cursor+items.length:null}).value;
 }
 assert(run){
  if(run.controller.signal.aborted)throw aborted();
  if(this.runs.get(run.id)!==run||this.points.get(run.point.id)!==run.point||this.runtime.active.get(run.point.job.key)!==run.point.job||run.point.job.state!=='running')throw Error('Custom hook owner stopped or definition changed');
  for(const {job,instance} of run.handlers??[])if(this.runtime.active.get(job.key)!==job||!['running','activating'].includes(job.state)||this.runtime.hooks.get(run.point.id)?.get(job.key)!==job||job.hookInstances?.get(run.point.id)!==instance)throw Error('Custom hook participant stopped or registration changed');
 }
 async run(job,input,{operation,parentRequest,signal}={}){
  if(!plain(input)||Object.keys(input).some(key=>!['id','instance','input','token','timeoutMs'].includes(key))||typeof input.token!=='string'||!/^\d{1,20}$/.test(input.token))throw Error('Invalid custom hook invocation');
  const point=this.point(job,input),timeoutMs=input.timeoutMs??30000;if(job.state!=='running')throw Error('Custom hooks require a running owner');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Hook timeout must be between one second and five minutes');
  if(this.runs.size>=64||[...this.runs.values()].filter(run=>run.point.job===job).length>=16)throw Error('Too many concurrent hook invocations');
  for(let pending=this.runtime.pending.get(parentRequest),depth=0;pending;pending=this.runtime.pending.get(pending.parentRequest)){if(++depth>32||pending.hookPoint===point.id)throw Error('Recursive custom hook invocation');}
  const payload=copyPayload(input.input,{label:'Hook input'}).value;serviceValue(point.contract.input,payload,'Hook input');
  const controller=new AbortController(),run={id:randomUUID(),point,controller,token:input.token,operation,handlers:[]},abort=()=>controller.abort(),timer=setTimeout(abort,timeoutMs);timer.unref?.();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.runs.set(run.id,run);
  try{
   if(operation){const op=this.runtime.operations.checkRef(operation).op;(op.customPoints??=new Set()).add(point);}
   this.assert(run);await waitActivation(this.runtime.activate('hook:'+point.id,{operation,agentScope:this.runtime.executionScope(job,parentRequest)}),controller.signal);this.assert(run);
   run.handlers=orderedHooks(this.runtime,point.id).map(job=>({job,instance:job.hookInstances?.get(point.id)}));if(run.handlers.length>128)throw Error('Too many custom hook participants');
   for(const {job} of run.handlers)if(JSON.stringify(job.hookContracts?.get(point.id))!==JSON.stringify(point.contract))throw Error('Custom hook participant contract does not match its owner');
   const results=[];for(const {job:participant,instance} of run.handlers){
    this.assert(run);if(operation){this.runtime.operations.join(operation,participant);const op=this.runtime.operations.checkRef(operation).op;op.callbacks=(op.callbacks??0)+1;if(op.callbacks>128)throw Error('Too many preparation hook callbacks');(op.hooks??=[]).push({job:participant,name:point.id,instance});}
    const value=await this.runtime.request(participant,{type:'invoke',kind:'hook',name:point.id,hookInstance:instance,hookPoint:point.id,managedHook:true,hookInfo:{runId:run.id,hookId:point.id,ownerId:job.manifest.id},input:payload,...(operation?{operation}:{})},participant.hookOptions?.get(point.id)??30000,job,controller.signal,parentRequest);
    this.assert(run);const result=copyPayload(value,{label:'Hook result'}).value;serviceValue(point.contract.output,result,'Hook result');results.push({extensionId:participant.manifest.id,value:result});copyPayload(results,{label:'Hook results'});
   }
   this.assert(run);return copyPayload({runId:run.id,results},{label:'Hook results'}).value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.runs.delete(run.id);controller.abort();}
 }
 cancel(job,token){let canceled=false;for(const run of this.runs.values())if(run.point.job===job&&run.token===token){run.controller.abort();canceled=true;}return canceled;}
 registrationRemoved(job,name,instance){for(const run of this.runs.values())if(run.point.id===name&&run.handlers.some(handler=>handler.job===job&&handler.instance===instance))run.controller.abort();}
 stopped(job){for(const [id,point] of this.points)if(point.job===job)this.points.delete(id);for(const run of this.runs.values())if(run.point.job===job||run.handlers.some(handler=>handler.job===job))run.controller.abort();}
}
module.exports={ExtensionCustomHooks};
