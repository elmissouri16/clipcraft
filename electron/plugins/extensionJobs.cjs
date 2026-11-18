// Bounded jobs have their own deadline and cancellation scope. Their managed
// wait pauses the invoking callback timer, not save/export's global deadline.
const cleanup=new Set(['log','jobs.finish','jobs.cancel','processes.kill','services.close','media.release','ui.dismissMessage','ui.cancelDialog','files.cancel','events.unsubscribe','exports.cancel','configuration.get','configuration.update','secrets.get','secrets.store','secrets.delete','ui.remove','commands.register.remove','services.register.remove','hooks.register.remove']);
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
class ExtensionJobs{
 constructor(runtime,{defaultMs=600000,graceMs=5000}={}){Object.assign(this,{runtime,defaultMs,graceMs});this.records=new Set();}
 get(job,operation){return job.jobRuns?.get(operation);}
 available(job,operation){const record=this.get(job,operation);return !!record&&!record.canceling;}
 authorize(job,operation,method){if(operation!==undefined&&!cleanup.has(method)&&!this.available(job,operation))throw Object.assign(Error('Extension job canceled or finished'),{name:'AbortError'});}
 signal(job,operation){return operation===undefined?undefined:this.get(job,operation)?.controller.signal;}
 start(job,args,parentRequest,parentSignal){
  if(!args||Object.keys(args).some(key=>!['operation','title','timeoutMs'].includes(key))||typeof args.operation!=='string'||!/^\d{1,16}$/.test(args.operation)||!text(args.title,160)||!args.title.trim())throw Error('Invalid job title or operation');
  const timeout=args.timeoutMs??this.defaultMs;if(!Number.isInteger(timeout)||timeout<1000||timeout>1800000)throw Error('Job timeout must be between one second and thirty minutes');
  job.jobRuns??=new Map();if(job.jobRuns.has(args.operation)||job.jobRuns.size>=16||this.records.size>=64)throw Error('Too many or duplicate extension jobs');
  const record={job,operation:args.operation,parentRequest,controller:new AbortController(),resume:this.runtime.pauseRequest(job,parentRequest),canceling:false,deadline:Date.now()+timeout};
  job.jobRuns.set(args.operation,record);this.records.add(record);job.jobs.set(args.operation,{operation:args.operation,title:args.title,fraction:0,message:'',canceling:false,startedAt:Date.now()});
  const expired=()=>{if(!this.records.has(record))return;if(Date.now()-record.deadline>2500){record.deadline=Date.now()+timeout;record.timer=setTimeout(expired,timeout);return;}this.cancel(job,args.operation,'Job timed out');};record.timer=setTimeout(expired,timeout);record.timer.unref?.();
  const signal=parentSignal||this.runtime.requestSignal(job,parentRequest),abort=()=>this.cancel(job,args.operation);signal?.addEventListener('abort',abort,{once:true});record.detach=()=>signal?.removeEventListener('abort',abort);if(signal?.aborted)abort();this.runtime.changed();return true;
 }
 progress(job,args){
  const record=this.get(job,args?.operation);if(!record||record.canceling)throw Object.assign(Error('Extension job canceled or finished'),{name:'AbortError'});
  if(Object.keys(args).some(key=>!['operation','fraction','message'].includes(key))||!Number.isFinite(args.fraction)||args.fraction<0||args.fraction>1||args.message!==undefined&&!text(args.message,1000))throw Error('Invalid job progress');
  Object.assign(job.jobs.get(args.operation),{fraction:args.fraction,...(args.message===undefined?{}:{message:args.message})});
  if(!record.notify){record.notify=setTimeout(()=>{record.notify=null;if(this.records.has(record))this.runtime.changed();},100);record.notify.unref?.();}return true;
 }
 cancel(job,operation,reason='Job canceled'){
  const record=this.get(job,operation);if(!record||record.canceling)return false;record.canceling=true;clearTimeout(record.timer);record.controller.abort();Object.assign(job.jobs.get(operation),{canceling:true,message:reason});
  try{job.child.postMessage({type:'cancel',operation});}catch{}
  record.deadline=Date.now()+this.graceMs;const expire=()=>{if(!this.records.has(record))return;if(Date.now()-record.deadline>2500){record.deadline=Date.now()+this.graceMs;record.grace=setTimeout(expire,this.graceMs);return;}const error=Error('Extension job did not finish cancellation');this.runtime.log(job,error.message,'error');job.child.kill();this.runtime.cleanup(job,error);};record.grace=setTimeout(expire,this.graceMs);record.grace.unref?.();this.runtime.changed();return true;
 }
 finish(job,operation){const record=this.get(job,operation);if(!record)return false;clearTimeout(record.timer);clearTimeout(record.grace);clearTimeout(record.notify);record.detach();record.resume();job.jobRuns.delete(operation);job.jobs.delete(operation);this.records.delete(record);this.runtime.changed();return true;}
 parentCanceled(job,id){for(const record of [...this.records])if(record.job===job&&record.parentRequest===id)this.cancel(job,record.operation);}
 stopped(job){for(const record of [...this.records])if(record.job===job){record.controller.abort();this.finish(job,record.operation);}}
}
module.exports={ExtensionJobs,jobCleanup:cleanup};
