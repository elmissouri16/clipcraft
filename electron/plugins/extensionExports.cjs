const {randomUUID}=require('node:crypto');
const path=require('node:path');
const enums={quality:['low','medium','high','ultra'],codec:['h264','h265'],resolution:[0,2160,1440,1080,720,480],fps:[0,24,25,30,50,60],audio_kbps:[96,128,192,256,320],encoder_preset:['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow']};
function exportInput(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provide export options');
 const allowed=new Set(['documentId','name','file_path','overwrite','showCompletion','range','crf','bitrate_mbps',...Object.keys(enums)]);
 if(Object.keys(input).some(key=>!allowed.has(key)))throw Error('Unknown export option');
 for(const [key,values] of Object.entries(enums))if(input[key]!==undefined&&!values.includes(input[key]))throw Error('Invalid export '+key);
 for(const [key,limit] of [['documentId',100],['name',200],['file_path',32768]])if(input[key]!==undefined&&(typeof input[key]!=='string'||!input[key].trim()||input[key].length>limit||/[\x00-\x1f]/.test(input[key])))throw Error('Invalid export '+key);
 if(input.file_path!==undefined&&(!path.isAbsolute(input.file_path)||path.extname(input.file_path).toLowerCase()!=='.mp4'))throw Error('Choose an absolute .mp4 output path');
 if(input.showCompletion!==undefined&&typeof input.showCompletion!=='boolean')throw Error('showCompletion must be true or false');
 if(input.overwrite!==undefined&&typeof input.overwrite!=='boolean')throw Error('overwrite must be true or false');
 if(input.crf!==undefined&&(!Number.isInteger(input.crf)||input.crf<0||input.crf>51))throw Error('crf must be an integer from 0 to 51');
 if(input.bitrate_mbps!==undefined&&(!Number.isFinite(input.bitrate_mbps)||input.bitrate_mbps<.5||input.bitrate_mbps>100||input.crf!==undefined))throw Error('Choose bitrate_mbps from 0.5 to 100, or crf, separately');
 if(input.range!==undefined){const range=input.range;if(!range||typeof range!=='object'||Array.isArray(range)||Object.keys(range).some(key=>!['start_sec','end_sec'].includes(key))||![range.start_sec,range.end_sec].every(Number.isFinite)||range.start_sec<0||range.end_sec<=range.start_sec)throw Error('Choose a valid export range');}
 return {...input,...(input.range?{range:{...input.range}}:{})};
}
class ExtensionExports {
 constructor({runtime,getOwner,requestEditor,cancelGraceMs=5000}){Object.assign(this,{runtime,getOwner,requestEditor,cancelGraceMs});this.records=new Map();}
 configure(backend){this.backend=backend;}
 assert(record){if(this.records.get(record.id)!==record||record.controller.signal.aborted||this.runtime.active.get(record.job.key)!==record.job||record.job.state!=='running'||record.owner.isDestroyed())throw Object.assign(Error('Extension export canceled or activation stopped'),record.controller.signal.aborted?{name:'AbortError'}:{});}
 async render(job,args,agentScope){
  if(job.state!=='running')throw Error('Exports require a running extension');
  const input=exportInput(args?.input),token=args?.token;if(typeof token!=='string'||!/^\d{1,20}$/.test(token))throw Error('Invalid export request');
  if(this.records.size)throw Error('Another extension export is in progress');if(!this.backend)throw Error('Export backend unavailable');
  const owner=this.getOwner();if(!owner||owner.isDestroyed())throw Error('Editor unavailable');
  let resolve;const done=new Promise(yes=>{resolve=yes;}),record={id:randomUUID(),job,token,input,owner,controller:new AbortController(),replyController:new AbortController(),done,progress:0,lastProgress:0};this.records.set(record.id,record);
  const closed=()=>this.cancelRecord(record);for(const name of ['destroyed','render-process-gone','did-navigate'])owner.on(name,closed);
  try{
   record.target=await this.backend.begin(record);this.assert(record);
   const value=await this.requestEditor({key:job.key,generation:job.generation,extensionId:job.manifest.id,method:'exports.render',...(agentScope?{agentScope}:{}),args:{id:record.id,input,target:record.target,title:job.manifest.name}},{timeoutMs:0,signal:record.replyController.signal});
   if(value?.canceled)throw Object.assign(Error('Export canceled'),{name:'AbortError'});
   if(!value?.ok)throw Error(value?.error||'Export did not finish');
   // A complete published file survives cancellation during best-effort cover
   // work. The native beforePublish check decides the ordering, not this reply.
   if(agentScope)this.runtime.agentCommands.receipt(agentScope,{kind:'video',extensionId:job.manifest.id,...value});
   return value;
  }finally{
   clearTimeout(record.cancelTimer);for(const name of ['destroyed','render-process-gone','did-navigate'])owner.removeListener(name,closed);
   try{if(record.target)await this.backend.release(record);}finally{this.records.delete(record.id);resolve();}
  }
 }
 cancelRecord(record){if(record.controller.signal.aborted)return;record.controller.abort();record.cancelTimer=setTimeout(()=>record.replyController.abort(),this.cancelGraceMs);record.cancelTimer.unref?.();try{this.backend?.cancel(record);}catch{}try{if(!record.owner.isDestroyed())record.owner.send('plugins:extensionExportCanceled',{id:record.id});}catch{}}
 cancel(job,token){const record=[...this.records.values()].find(record=>record.job===job&&record.token===token);if(!record)return false;this.cancelRecord(record);return true;}
 async stopped(job){const records=[...this.records.values()].filter(record=>record.job===job);for(const record of records)this.cancelRecord(record);await Promise.all(records.map(record=>record.done));}
 progress(owner,id,input){
  const record=this.records.get(id);if(!record||record.owner!==owner||record.controller.signal.aborted||record.job.state!=='running')return false;
  if(!input||typeof input!=='object'||!Number.isFinite(input.progress)||input.progress<0||input.progress>1)return false;
  const value={progress:Math.max(record.progress,input.progress)};
  for(const name of ['phase','stage'])if(typeof input[name]==='string')value[name]=input[name].slice(0,240);
  for(const name of ['phaseProgress','elapsedSeconds','remainingSeconds'])if(Number.isFinite(input[name])&&input[name]>=0&&input[name]<=1e9)value[name]=input[name];
  const now=Date.now();if(now-record.lastProgress<100&&value.progress<1)return false;record.lastProgress=now;record.progress=value.progress;
  record.job.child.postMessage({type:'export-progress',token:record.token,value});return true;
 }
}
module.exports={ExtensionExports,exportInput};
