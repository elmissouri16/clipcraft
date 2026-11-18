const {randomUUID}=require('node:crypto');
const path=require('node:path');
const NAMES={save:['project.validateSave','project.willSave'],export:['export.validate','export.willRender']};
const WRITES=new Set(['editor.apply','captions.write','media.insert','markers.apply']);
class ExtensionHooks {
 constructor({runtime,commits,media,describe,timeoutMs=600000}){Object.assign(this,{runtime,commits,media,describe,timeoutMs});this.records=new Map();this.finishing=new Map();this.grants=new Map();this.onCancelled=()=>{};}
 live(job){return this.runtime.active.get(job.key)===job&&['activating','running'].includes(job.state);}
 checkRef(ref){const record=this.grants.get(ref?.grant);if(!record||record.op.id!==ref.id)throw Error('Save/export operation is no longer active');this.assert(record.op);return record;}
 signal(ref){return this.checkRef(ref).op.controller.signal;}
 track(ref,cleanup){const record=this.checkRef(ref);(record.op.cleanups??=[]).push(cleanup);}
 wrote(ref){this.checkRef(ref).op.writes++;}
 assert(op){if(this.records.get(op.id)!==op||op.controller.signal.aborted||op.owner.isDestroyed()||[...op.jobs].some(job=>!this.live(job)))throw Error(op.error||'Save/export preparation stopped');}
 grant(op,mode){const ref={id:op.id,grant:randomUUID()},record={op,mode,jobs:new Set()};this.grants.set(ref.grant,record);return ref;}
 join(ref,job){const record=this.grants.get(ref?.grant);if(!record||record.op.id!==ref.id)throw Error('Save/export operation is no longer active');this.assert(record.op);if(!this.live(job))throw Error('Extension stopped');record.jobs.add(job);record.op.jobs.add(job);return ref;}
 authorize(job,ref,method){
  const record=this.grants.get(ref?.grant);if(!record||record.op.id!==ref?.id||!record.jobs.has(job))throw Error('Save/export operation is no longer active');this.assert(record.op);
  if(record.mode==='validate'&&WRITES.has(method))throw Error('Validation hooks cannot edit the document');
  if(['exports.render','media.preview'].includes(method))throw Error('This operation cannot open a preview or start another export');
  return {id:record.op.id,phase:record.mode};
 }
 async begin(owner,input){
  if(!input||!Object.hasOwn(NAMES,input.kind)||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||this.records.has(input.id))throw Error('Invalid save/export operation');
  const doc=input.document;if(!doc||typeof doc.documentId!=='string'||doc.documentId.length>100||doc.name!==undefined&&(typeof doc.name!=='string'||doc.name.length>1000)||!['width','height','fps','duration_sec'].every(key=>Number.isFinite(doc[key])&&doc[key]>=0&&doc[key]<=1e9))throw Error('Invalid preparation document');
  const destination=input.destination;if(destination!==undefined&&(!destination||typeof destination.path!=='string'||!path.isAbsolute(destination.path)||destination.path.length>32768||destination.path.includes('\0')||Object.keys(destination).some(key=>!['path','saveAs','review'].includes(key))||['saveAs','review'].some(key=>destination[key]!==undefined&&typeof destination[key]!=='boolean')))throw Error('Invalid preparation destination');
  if([...this.records.values(),...this.finishing.values()].some(op=>op.owner===owner))throw Error('Another save/export preparation is in progress');
  const op={id:input.id,owner,kind:input.kind,document:doc,destination,jobs:new Set(),controller:new AbortController(),state:'running',error:null,writes:0};
  op.closed=()=>{this.abort(op,Error('Editor closed during preparation'),true).catch(()=>{});};for(const event of ['destroyed','render-process-gone','did-navigate'])owner.on(event,op.closed);
  op.timer=setTimeout(()=>this.abort(op,Error('Save/export preparation timed out')).catch(()=>{}),this.timeoutMs);op.timer.unref?.();this.records.set(op.id,op);
  try{
   let count=0;
   for(const [index,name] of NAMES[op.kind].entries()){
    const ref=this.grant(op,index===0?'validate':'prepare');
    try{
     await this.runtime.activate('hook:'+name,{operation:ref});this.assert(op);
     for(const job of [...(this.runtime.hooks.get(name)?.values()||[])].sort((a,b)=>a.manifest.id.localeCompare(b.manifest.id))){
      if(++count>128)throw Error('Too many save/export hooks');this.join(ref,job);
      const document=this.describe?await this.describe(op,job,ref):op.document;this.assert(op);op.document=document;
      const result=await this.runtime.request(job,{type:'invoke',kind:'hook',name,operation:ref,input:{operationId:op.id,kind:op.kind,phase:index===0?'validate':'prepare',document,...(destination?{destination}:{})}},job.hookOptions?.get(name)??30000,null,op.controller.signal);this.assert(op);
      if(result!==undefined&&result!==null){if(typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(key=>key!=='cancel')||result.cancel!==undefined&&(typeof result.cancel!=='string'||!result.cancel.trim()||result.cancel.length>1000))throw Error('Hooks return nothing or a plain {cancel: reason} result');if(result.cancel)throw Error(result.cancel);}
     }
    }finally{this.grants.delete(ref.grant);}
   }
   this.assert(op);op.state='prepared';return {id:op.id,participants:op.jobs.size,extensionIds:[...new Set([...op.jobs].map(job=>job.manifest.id))]};
  }catch(error){await this.abort(op,error);throw error;}
 }
 record(owner,id){const op=this.records.get(id);if(!op||op.owner!==owner)throw Error('Preparation is no longer available');this.assert(op);return op;}
 acquire(owner,id){
  const op=this.record(owner,id);if(op.state!=='prepared')throw Error('Preparation is not ready to commit');
  const lease=this.commits.acquire(owner,[...op.jobs],()=>{this.assert(op);return ['prepared','committing'].includes(op.state);});op.lease=lease.id;op.state='committing';return lease;
 }
 async finish(owner,id,applied){
  const op=[...this.records.values()].find(op=>op.owner===owner&&op.lease===id);if(!op)return;
  const claimed=op.claimed||this.commits.records.get(id)?.state==='applying';
  try{if(applied&&claimed)await this.media.commitLease(op.id);else await this.media.releaseLease(op.id);}finally{this.remove(op);}
 }
 claimed(owner,id){const op=[...this.records.values()].find(op=>op.owner===owner&&op.lease===id);if(op)op.claimed=true;}
 completeEmpty(owner,id){const op=this.record(owner,id);if(op.jobs.size||op.state!=='prepared')throw Error('Preparation needs a commit acknowledgement');this.remove(op);return true;}
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
 prune(){for(const op of this.records.values())if([...op.jobs].some(job=>!this.live(job)))this.abort(op,Error('Extension stopped during preparation')).catch(()=>{});}
}
module.exports={ExtensionHooks,NAMES,WRITES};
