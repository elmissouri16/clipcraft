const crypto=require('node:crypto');
const stopped=()=>Object.assign(Error('Author test canceled or development snapshot revoked.'),{name:'AbortError'});
class AuthoringTests{
 constructor({development,dialog,getWindow,timeoutMs=45000}){Object.assign(this,{development,dialog,getWindow,timeoutMs});this.jobs=new Map();}
 contribution(key,kind,id){const bundle=this.development.resolve(key);if(!bundle)throw Error('Start a development session first.');const value=bundle.manifest.contributes[kind]?.find(row=>row.id===id);if(!value)throw Error('Choose a declared author contribution.');return structuredClone(value);}
 begin(key,kind,id){
  const value=this.contribution(key,kind,id),owner=this.getWindow()?.webContents;
  if(!owner||owner.isDestroyed())throw stopped();
  if(this.jobs.size)throw Error('Finish or cancel the current author test first.');
  const job={token:crypto.randomUUID(),key,kind,id,value,owner,controller:new AbortController()};
  job.stop=()=>{job.controller.abort();this.finish(job.token);};
  for(const event of ['destroyed','render-process-gone','did-start-navigation'])owner.once(event,job.stop);
  job.timer=setTimeout(job.stop,kind==='exportPresets'?600000:this.timeoutMs);job.timer.unref?.();this.jobs.set(job.token,job);return job;
 }
 verify(token,owner){const job=this.jobs.get(token);if(!job||job.controller.signal.aborted||job.owner!==owner||owner.isDestroyed())throw stopped();this.contribution(job.key,job.kind,job.id);return job;}
 finish(token){const job=this.jobs.get(token);if(!job)return false;this.jobs.delete(token);clearTimeout(job.timer);for(const event of ['destroyed','render-process-gone','did-start-navigation'])job.owner.removeListener(event,job.stop);job.controller.abort();return true;}
 revoke(key){for(const job of this.jobs.values())if(!key||job.key===key)job.stop();}
 export(request){if(!request||typeof request.key!=='string'||typeof request.id!=='string')throw Error('Invalid author export.');const job=this.begin(request.key,'exportPresets',request.id);return {token:job.token,preset:job.value};}
}
module.exports={AuthoringTests};
