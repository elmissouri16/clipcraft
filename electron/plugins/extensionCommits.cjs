const {randomUUID}=require('node:crypto');
// A reservation is not permission to edit. The real reducer synchronously claims
// it immediately before publishing a prepared project. Stop revokes reservations
// and waits for already claimed edits to acknowledge, giving both processes one
// ordering point without trusting a stale asynchronous authorization reply.
class ExtensionCommits {
 constructor({isActive,pendingMs=5000}){Object.assign(this,{isActive,pendingMs});this.records=new Map();this.owners=new Map();}
 acquire(owner,jobs,verify=()=>true){
  jobs=[...new Set(jobs)];if(owner.isDestroyed()||jobs.some(job=>!this.isActive(job))||!verify())throw Error('Extension edit is no longer authorized');
  if(this.records.size>=64)throw Error('Too many pending extension edits');
  const id=randomUUID();let resolve;const done=new Promise(yes=>{resolve=yes;});
  const timer=setTimeout(()=>{const record=this.records.get(id);if(record?.state==='pending')this.release(record);},this.pendingMs);timer.unref?.();
  this.records.set(id,{id,owner,jobs,verify,state:'pending',done,resolve,timer});
  if(!this.owners.has(owner)){const close=()=>{for(const record of this.records.values())if(record.owner===owner)this.release(record);};this.owners.set(owner,close);for(const event of ['destroyed','render-process-gone','did-navigate'])owner.on(event,close);}
  return {id};
 }
 apply(owner,id){
  const record=this.records.get(id);if(!record||record.owner!==owner)return false;
  // React may replay a reducer before committing its render. The same private
  // action may claim its lease again; no other action can borrow that lease.
  if(record.state==='applying')return true;
  let valid=false;try{valid=record.jobs.every(job=>this.isActive(job))&&record.verify();}catch{}
  if(!valid){this.release(record);return false;}
  record.state='applying';clearTimeout(record.timer);return true;
 }
 finish(owner,id){const record=this.records.get(id);if(!record||record.owner!==owner)return false;this.release(record);return true;}
 release(record){
  if(!this.records.delete(record.id))return;clearTimeout(record.timer);record.resolve();
  if(![...this.records.values()].some(item=>item.owner===record.owner)){const close=this.owners.get(record.owner);for(const event of ['destroyed','render-process-gone','did-navigate'])record.owner.removeListener(event,close);this.owners.delete(record.owner);}
 }
 has(job){return [...this.records.values()].some(record=>record.jobs.includes(job));}
 drain(job){
  const applying=[];for(const record of this.records.values())if(record.jobs.includes(job)){if(record.state==='pending')this.release(record);else applying.push(record.done);}
  return Promise.all(applying);
 }
 dispose(){for(const record of this.records.values())this.release(record);}
}
module.exports={ExtensionCommits};
