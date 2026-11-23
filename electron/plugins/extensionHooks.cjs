const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {orderedHooks}=require('../../shared/extensionHookContracts.cjs');
const NAMES={save:['project.validateSave','project.willSave'],export:['export.validate','export.willRender'],close:['project.validateClose','project.willClose'],opened:['project.didOpen'],created:['project.didCreate'],closed:['project.didClose']};
const OBSERVERS=new Set(['opened','created','closed']);
const WRITES=new Set(['editor.apply','captions.write','media.insert','markers.apply','timeline.apply']);
class ExtensionHooks {
 constructor({runtime,commits,media,describe,timeoutMs=600000}){Object.assign(this,{runtime,commits,media,describe,timeoutMs});this.records=new Map();this.finishing=new Map();this.grants=new Map();this.onCancelled=()=>{};}
 live(job){return this.runtime.active.get(job.key)===job&&['activating','running'].includes(job.state);}
 checkRef(ref){const record=this.grants.get(ref?.grant);if(!record||record.op.id!==ref.id)throw Error('Save/export operation is no longer active');this.assert(record.op);return record;}
 signal(ref){return this.checkRef(ref).op.controller.signal;}
 track(ref,cleanup){const record=this.checkRef(ref);(record.op.cleanups??=[]).push(cleanup);}
 wrote(ref){this.checkRef(ref).op.writes++;}
 assert(op){if(this.records.get(op.id)!==op||op.controller.signal.aborted||op.owner.isDestroyed()||[...op.jobs].some(job=>!this.live(job))||(op.hooks??[]).some(({job,name,instance})=>this.runtime.hooks.get(name)?.get(job.key)!==job||job.hookInstances?.get(name)!==instance)||[...(op.customPoints??[])].some(point=>this.runtime.customHooks?.points.get(point.id)!==point))throw Error(op.error||'Save/export preparation stopped or hook registration changed');}
 grant(op,mode){const ref={id:op.id,grant:randomUUID()},record={op,mode,jobs:new Set()};this.grants.set(ref.grant,record);return ref;}
 join(ref,job){const record=this.grants.get(ref?.grant);if(!record||record.op.id!==ref.id)throw Error('Save/export operation is no longer active');this.assert(record.op);if(!this.live(job))throw Error('Extension stopped');record.jobs.add(job);record.op.jobs.add(job);return ref;}
 authorize(job,ref,method){
  const record=this.grants.get(ref?.grant);if(!record||record.op.id!==ref?.id||!record.jobs.has(job))throw Error('Save/export operation is no longer active');this.assert(record.op);
  if(record.mode!=='prepare'&&WRITES.has(method))throw Error(record.mode==='observe'?'Lifecycle observers cannot edit the document':'Validation hooks cannot edit the document');
  if(method.startsWith('projects.')&&method!=='projects.status'||method==='editor.undo')throw Error('Project lifecycle and Undo cannot run inside save/export hooks');
  if(['exports.render','media.preview'].includes(method))throw Error('This operation cannot open a preview or start another export');
  return {id:record.op.id,phase:record.mode};
 }
 async begin(owner,input){
  if(!input||!Object.hasOwn(NAMES,input.kind)||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||this.records.has(input.id))throw Error('Invalid save/export operation');
  const doc=input.document;if(!doc||typeof doc.documentId!=='string'||doc.documentId.length>100||doc.name!==undefined&&(typeof doc.name!=='string'||doc.name.length>1000)||!['width','height','fps','duration_sec'].every(key=>Number.isFinite(doc[key])&&doc[key]>=0&&doc[key]<=1e9))throw Error('Invalid preparation document');
  const destination=input.destination;if(destination!==undefined&&(!destination||typeof destination.path!=='string'||!path.isAbsolute(destination.path)||destination.path.length>32768||destination.path.includes('\0')||Object.keys(destination).some(key=>!['path','saveAs','review'].includes(key))||['saveAs','review'].some(key=>destination[key]!==undefined&&typeof destination[key]!=='boolean')))throw Error('Invalid preparation destination');
  const transition=input.transition;if(transition!==undefined&&(!transition||typeof transition!=='object'||Array.isArray(transition)||Object.keys(transition).some(key=>!['reason','path'].includes(key))||!['create','open','home','quit','restore','import'].includes(transition.reason)||transition.path!==undefined&&(typeof transition.path!=='string'||!path.isAbsolute(transition.path)||transition.path.length>32768||transition.path.includes('\0'))))throw Error('Invalid document transition');
  if([...this.records.values(),...this.finishing.values()].some(op=>op.owner===owner))throw Error('Another save/export preparation is in progress');
  const op={id:input.id,owner,kind:input.kind,document:doc,destination,transition,observer:OBSERVERS.has(input.kind),jobs:new Set(),controller:new AbortController(),state:'running',error:null,writes:0};
  op.closed=()=>{this.abort(op,Error('Editor closed during preparation'),true).catch(()=>{});};for(const event of ['destroyed','render-process-gone','did-navigate'])owner.on(event,op.closed);
  op.timer=setTimeout(()=>this.abort(op,Error('Save/export preparation timed out')).catch(()=>{}),this.timeoutMs);op.timer.unref?.();this.records.set(op.id,op);
  try{
   op.callbacks=0;
   for(const [index,name] of NAMES[op.kind].entries()){
    const phase=op.observer?'observe':index===0?'validate':'prepare',ref=this.grant(op,phase);
    try{
     await this.runtime.activate('hook:'+name,{operation:ref});this.assert(op);
     for(const job of orderedHooks(this.runtime,name)){
      if(++op.callbacks>128)throw Error('Too many save/export hooks');this.join(ref,job);
      const hookInstance=job.hookInstances?.get(name);(op.hooks??=[]).push({job,name,instance:hookInstance});
      const document=this.describe?await this.describe(op,job,ref):op.document;this.assert(op);op.document=document;
      op.currentObserver=op.observer?job:null;
      const result=await this.runtime.request(job,{type:'invoke',kind:'hook',name,hookInstance,operation:ref,input:{operationId:op.id,kind:op.kind,phase,document,...(destination?{destination}:{}),...(transition?{transition}:{})}},job.hookOptions?.get(name)??30000,null,op.controller.signal);this.assert(op);
      if(result!==undefined&&result!==null){if(typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(key=>key!=='cancel')||result.cancel!==undefined&&(typeof result.cancel!=='string'||!result.cancel.trim()||result.cancel.length>1000))throw Error('Hooks return nothing or a plain {cancel: reason} result');if(result.cancel)throw Error(result.cancel);}
     }
    }finally{this.grants.delete(ref.grant);}
   }
   this.assert(op);op.state='prepared';return {id:op.id,participants:op.jobs.size,readOnly:op.observer,extensionIds:[...new Set([...op.jobs].map(job=>job.manifest.id))]};
  }catch(error){if(op.observer&&op.currentObserver)this.runtime.log?.(op.currentObserver,'Document lifecycle observer failed: '+error.message,'error');await this.abort(op,error);throw error;}
 }
 record(owner,id){const op=this.records.get(id);if(!op||op.owner!==owner)throw Error('Preparation is no longer available');this.assert(op);return op;}
 acquire(owner,id){
  const op=this.record(owner,id);if(op.observer)throw Error('Lifecycle observers cannot commit');if(op.state!=='prepared')throw Error('Preparation is not ready to commit');
  const lease=this.commits.acquire(owner,[...op.jobs],()=>{this.assert(op);return ['prepared','committing'].includes(op.state);});op.lease=lease.id;op.state='committing';return lease;
 }
 async finish(owner,id,applied){
  const op=[...this.records.values()].find(op=>op.owner===owner&&op.lease===id);if(!op)return;
  const claimed=op.claimed||this.commits.records.get(id)?.state==='applying';
  try{if(applied&&claimed)await this.media.commitLease(op.id);else await this.media.releaseLease(op.id);}finally{this.remove(op);}
 }
 claimed(owner,id){const op=[...this.records.values()].find(op=>op.owner===owner&&op.lease===id);if(op)op.claimed=true;}
 async completeEmpty(owner,id){const op=this.record(owner,id);if(op.state!=='prepared'||!op.observer&&op.jobs.size||op.observer&&op.writes)throw Error('Preparation needs a commit acknowledgement');try{if(op.observer)await this.media.releaseLease(op.id);}finally{this.remove(op);}return true;}
 async cancel(owner,id){const op=this.records.get(id)||this.finishing.get(id);if(!op||op.owner!==owner)return false;return this.abort(op,Error('Save/export preparation canceled'));}
 async abort(op,error,ownerGone=false){
  if(op.aborting)return op.aborting;if(this.records.get(op.id)!==op)return false;
  const claimed=op.claimed||op.lease&&this.commits.records.get(op.lease)?.state==='applying';if(claimed&&!ownerGone)return false;
  op.error=String(error.message||error).slice(0,1000);op.controller.abort();this.remove(op);
  // A lost acknowledgement can follow a published edit. Never remove a durable
  // media file that the editor might already have adopted before it disappeared.
  this.onCancelled(op.owner,{id:op.id,error:op.error});
  this.finishing.set(op.id,op);op.aborting=(async()=>{try{if(claimed)await this.media.commitLease(op.id);else await this.media.releaseLease(op.id);return true;}finally{this.finishing.delete(op.id);}})();return op.aborting;
 }
 remove(op){
  this.records.delete(op.id);clearTimeout(op.timer);for(const [id,grant] of this.grants)if(grant.op===op)this.grants.delete(id);
  for(const cleanup of op.cleanups||[])try{cleanup();}catch{}
  for(const event of ['destroyed','render-process-gone','did-navigate'])op.owner.removeListener(event,op.closed);
 }
 prune(){for(const op of this.records.values())try{this.assert(op);}catch(error){this.abort(op,error).catch(()=>{});}}
}
module.exports={ExtensionHooks,NAMES,WRITES};
