const {randomUUID}=require('node:crypto');
const {copyPayload}=require('./extensionData.cjs');
const eventName=/^[a-z][\w.-]{0,319}$/;
const states=new Set(['project.opened','project.closed','project.changed','editor.changed','selection.changed','playback.changed','export.changed']);
const coreNames=new Set([...states,'configuration.changed','application.configurationChanged','extension.changed','media.previewClosed']);
function coalesceKey(name,value){
 if(['project.changed','editor.changed','selection.changed','playback.changed'].includes(name))return name+':'+(value?.documentId||'');
 if(name==='export.changed'&&['preparing','rendering'].includes(value?.status))return name+':'+value.operationId+':'+value.status;
 return null;
}
function source(input){
 if(!input)return {kind:'system'};
 if(!input||typeof input!=='object'||!['user','extension','agent','system','unknown'].includes(input.kind))throw Error('Invalid event source');
 const result={kind:input.kind};
 for(const key of ['extensionId','operationId'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>320)throw Error('Invalid event source');result[key]=input[key];}
 if(input.extensionIds!==undefined){if(!Array.isArray(input.extensionIds)||input.extensionIds.length>128||input.extensionIds.some(id=>typeof id!=='string'||id.length>160))throw Error('Invalid event participants');result.extensionIds=[...new Set(input.extensionIds)];}
 return result;
}
class ExtensionEvents {
 constructor(runtime,{timeoutMs=30000,graceMs=5000}={}){Object.assign(this,{runtime,timeoutMs,graceMs});this.pending=[];this.bytes=0;this.sequence=0;this.jobs=new Map();this.latest=new Map();this.checked=new Set();this.holds=0;this.closed=false;this.failures=[];}
 invalidate(){this.checked.clear();}
 hold(){this.holds++;let released=false;return ()=>{if(released)return;released=true;this.holds--;this.kick();if(!this.holds)for(const job of this.jobs.keys())this.send(job);};}
 record(job){let record=this.jobs.get(job);if(!record){record={queue:[],bytes:0,active:null,sequence:0,missed:0,seen:new Set()};this.jobs.set(job,record);}return record;}
 stats(job){const record=this.jobs.get(job);return {queued:record?.queue.length||0,bytes:record?.bytes||0,inFlight:!!record?.active,missed:record?.missed||0};}
 execution(job,id){const active=this.jobs.get(job)?.active;return active?.id===id?{signal:active.controller.signal}:null;}
 publish(name,value,options={}){
  if(this.closed)throw Error('Extension events are closed');if(typeof name!=='string'||!eventName.test(name))throw Error('Invalid event name');
  const payload=copyPayload(value),event={name,value:payload.value,bytes:payload.bytes,publication:++this.sequence,timestamp:Date.now(),source:source(options.source),missed:0,core:coreNames.has(name)};
  if(options.documentId!==undefined){if(typeof options.documentId!=='string'||options.documentId.length>100)throw Error('Invalid event document');event.documentId=options.documentId;}
  if(options.reason!==undefined){if(typeof options.reason!=='string'||options.reason.length>80)throw Error('Invalid event reason');event.reason=options.reason;}
  if(options.projectRevision!==undefined){if(!Number.isSafeInteger(options.projectRevision)||options.projectRevision<0)throw Error('Invalid event revision');event.projectRevision=options.projectRevision;}
  if(options.changes!==undefined){if(!Array.isArray(options.changes)||options.changes.length>4||options.changes.some(value=>!['document','selection','playback','cache'].includes(value)))throw Error('Invalid event changes');event.changes=[...new Set(options.changes)];}
  if(options.missed!==undefined){if(!Number.isSafeInteger(options.missed)||options.missed<0)throw Error('Invalid event skipped count');event.missed=options.missed;}
  event.key=coalesceKey(name,value);try{this.append(this.pending,event,128,()=>this.bytes,bytes=>{this.bytes=bytes;});}catch(error){this.noteMissed(event);throw error;}
  if(states.has(name)){
   if(name==='project.closed')for(const key of ['project.opened','project.changed','editor.changed','selection.changed','playback.changed'])this.latest.delete(key);
   if(name==='project.opened')for(const key of ['project.closed','project.changed','editor.changed','selection.changed','playback.changed'])this.latest.delete(key);
   this.latest.delete(name);this.latest.set(name,event);
   while([...this.latest.values()].reduce((sum,item)=>sum+item.bytes,0)>4*1024*1024)this.latest.delete(this.latest.keys().next().value);
  }
  this.kick();return {name,publication:event.publication};
 }
 noteMissed(event){for(const job of this.runtime.active.values())if(job.subscriptions.has(event.name)){const record=this.record(job);if(!record.seen.has(event.publication))record.missed+=event.missed+1;}}
 append(queue,event,limit,getBytes,setBytes,onDrop){
  const pending=[...queue],evicted=[];let bytes=getBytes();
  if(event.key){const index=pending.findIndex(item=>item.key===event.key);if(index>=0){const [previous]=pending.splice(index,1);bytes-=previous.bytes;event={...event,missed:event.missed+previous.missed+1};}}
  while(pending.length>=limit||bytes+event.bytes>4*1024*1024){
   let index=pending.findIndex(item=>item.key);
   if(index<0&&event.core)index=pending.findIndex(item=>!item.core);
   if(index<0&&event.core&&pending.length)index=0;
   if(index<0){if(onDrop){onDrop(event.missed+1);return false;}throw Error('Extension event queue is full');}
   const [old]=pending.splice(index,1);bytes-=old.bytes;evicted.push(old);
  }
  pending.push(event);bytes+=event.bytes;queue.splice(0,queue.length,...pending);setBytes(bytes);
  for(const old of evicted)if(onDrop)onDrop(old.missed+1);else this.noteMissed(old);
  return true;
 }

 kick(){if(this.holds||this.closed)return;queueMicrotask(()=>this.pump().catch(error=>this.failure(error)));}
 failure(error){this.failures.push({timestamp:Date.now(),message:String(error.message||error).slice(0,1000)});if(this.failures.length>16)this.failures.shift();}
 async pump(){
  if(this.pumping||this.holds||this.closed)return;this.pumping=true;
  try{while(this.pending.length&&!this.holds&&!this.closed){
   const event=this.pending.shift();this.bytes-=event.bytes;
   if(!this.checked.has(event.name)){this.checked.add(event.name);if(this.checked.size>128)this.checked.delete(this.checked.values().next().value);try{for(const error of await this.runtime.activate('event:'+event.name,{continueOnError:true})||[])this.failure(error);}catch(error){this.failure(error);}}
   if(this.closed)break;
   for(const job of this.runtime.active.values())if(['activating','running'].includes(job.state)&&job.subscriptions.has(event.name))this.enqueue(job,event);
  }}finally{this.pumping=false;}
 }
 subscribe(job,name,{replay=false,listener}={}){
  if(typeof name!=='string'||!eventName.test(name)||typeof replay!=='boolean'||listener!==undefined&&(typeof listener!=='string'||!/^\d{1,16}$/.test(listener)))throw Error('Invalid event subscription');
  if(!job.subscriptions.has(name)&&job.subscriptions.size>=128)throw Error('Use at most 128 event subscriptions');job.subscriptions.add(name);
  if(replay&&this.latest.has(name))this.enqueue(job,{...this.latest.get(name),replay:true,listener,key:null});return true;
 }
 unsubscribe(job,name){job.subscriptions.delete(name);const record=this.jobs.get(job);if(record){record.queue=record.queue.filter(event=>event.name!==name);record.bytes=record.queue.reduce((sum,event)=>sum+event.bytes,0);}return true;}
 enqueue(job,event){
  const record=this.record(job);if(!event.replay){if(record.seen.has(event.publication))return;record.seen.add(event.publication);if(record.seen.size>128)record.seen.delete(record.seen.values().next().value);}
  this.append(record.queue,event,64,()=>record.bytes,bytes=>{record.bytes=bytes;},missed=>{record.missed+=missed;if(!record.warned){record.warned=true;this.runtime.log(job,'Event queue overflow; resynchronize from host reads.','warning');}});this.send(job);
 }
 ready(job){this.send(job);}
 send(job){
  const record=this.jobs.get(job);if(!record||record.active||job.state!=='running'||this.runtime.active.get(job.key)!==job||this.holds||this.closed)return;
  let event;while((event=record.queue.shift())){record.bytes-=event.bytes;if(job.subscriptions.has(event.name))break;event=null;}if(!event)return;
  const id=randomUUID(),meta={sequence:++record.sequence,publication:event.publication,timestamp:event.timestamp,source:event.source,missed:event.missed+record.missed,...(event.documentId?{documentId:event.documentId}:{}),...(event.projectRevision!==undefined?{projectRevision:event.projectRevision}:{}),...(event.changes?{changes:event.changes}:{}),...(event.reason?{reason:event.reason}:{}),...(event.replay?{replay:true}:{})};record.missed=0;
  const active={id,event,waits:0,controller:new AbortController()};record.active=active;active.arm=()=>{active.deadline=Date.now()+this.timeoutMs;active.timer=setTimeout(()=>this.expire(job,active),this.timeoutMs);active.timer.unref?.();};active.arm();
  try{job.child.postMessage({type:'event',id,name:event.name,value:event.value,meta,...(event.listener?{listener:event.listener}:{})});}catch(error){this.failure(error);this.stopped(job);}
 }
 ack(job,id){const record=this.jobs.get(job);if(record?.active?.id!==id)return false;clearTimeout(record.active.timer);record.active.controller.abort();record.active=null;this.send(job);return true;}
 pauseDelivery(job,id){const active=this.jobs.get(job)?.active;if(!active||active.id!==id||active.expired)return ()=>{};active.waits++;clearTimeout(active.timer);let resumed=false;return ()=>{if(resumed)return;resumed=true;if(this.jobs.get(job)?.active!==active)return;if(!--active.waits)active.arm();};}
 expire(job,active){
  if(this.jobs.get(job)?.active!==active)return;if(Date.now()-active.deadline>2500){active.arm();return;}active.expired=true;active.controller.abort();this.runtime.log(job,'Event listener timed out; canceling its signal.','warning');
  try{job.child.postMessage({type:'cancel-event',id:active.id});}catch{}
  const force=()=>{if(this.jobs.get(job)?.active!==active||this.runtime.active.get(job.key)!==job)return;if(Date.now()-active.deadline>2500){active.deadline=Date.now()+this.graceMs;active.timer=setTimeout(force,this.graceMs);active.timer.unref?.();return;}this.runtime.log(job,'Event listener ignored cancellation; stopping extension.','error');job.child.kill();this.runtime.cleanup(job,Error('Extension event listener timed out'));};active.deadline=Date.now()+this.graceMs;active.timer=setTimeout(force,this.graceMs);active.timer.unref?.();
 }
 stopped(job){const record=this.jobs.get(job);if(record?.active){clearTimeout(record.active.timer);record.active.controller.abort();try{job.child.postMessage({type:'cancel-event',id:record.active.id});}catch{}}this.jobs.delete(job);}
 close(){this.closed=true;for(const job of this.jobs.keys())this.stopped(job);this.pending=[];this.bytes=0;this.latest.clear();this.checked.clear();}
}
module.exports={ExtensionEvents,eventName,coalesceKey};
