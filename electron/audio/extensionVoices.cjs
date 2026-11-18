// Voice is an application integration point consumed through the general
// extension service API. No vendor transport runs in this module.
const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
function normalize(entry,status){
 const voices=Array.isArray(status?.voices)?status.voices.slice(0,1000).filter(v=>v&&plain(v.id,160)&&v.id&&plain(v.name,160)).map(v=>({id:v.id,name:v.name,language:plain(v.language,80)?v.language:'',styleRequired:v.styleRequired===true,description:plain(v.description,1000)?v.description:''})):[];
 return {id:'extension:'+entry.service,name:entry.title,order:entry.order,aliases:entry.aliases||[],enabled:status?.enabled!==false,running:status?.running===true,voices,supportsStyle:status?.supportsStyle===true,supportsSpeed:status?.supportsSpeed!==false,error:plain(status?.error,1000)?status.error:'',available:status?.enabled!==false&&status?.running===true&&voices.length>0};
}
class ExtensionVoices{
 constructor(manager){this.manager=manager;}
 async entries(){await this.manager.ready;await this.manager.extensions.activate('ui:voice.engines',{continueOnError:true});return this.manager.extensions.ui.list().filter(entry=>entry.kind==='integration'&&entry.point==='voice.engines');}
 async catalog(signal){
  const entries=await this.entries();return Promise.all(entries.map(async entry=>{
   try{return normalize(entry,await this.manager.extensions.callService(entry.service,'status',{}, {signal,timeoutMs:25000}));}
   catch(e){if(signal?.aborted)throw e;return normalize(entry,{running:false,error:e.message});}
  }));
 }
 async generate(engine,input,signal){
  const entry=(await this.entries()).find(entry=>'extension:'+entry.service===engine);if(!entry)throw Error('This voice extension is unavailable. Install, enable or trust its package in Plugins.');
  const service=this.manager.extensions.services.get(entry.service);if(!service)throw Error('Voice service is unavailable');const job=service.job;
  const artifact=await this.manager.extensions.callService(entry.service,'generate',input,{signal});
  if(!artifact||typeof artifact.id!=='string')throw Error('Voice service returned no verified media artifact');
  try{
   if(signal?.aborted)throw Object.assign(Error('Voice generation canceled'),{name:'AbortError'});
   const item=await this.manager.extensionMedia.item(job,artifact.id,true);if(item.type!=='audio')throw Error('Voice service must return verified audio');
   return {...item,credit:{license:'extension',providerName:entry.title,creator:plain(input.voiceName,160)?input.voiceName:entry.title,line:'Speech generated with '+entry.title}};
  }finally{await this.manager.extensionMedia.release(job,artifact.id).catch(()=>{});}
 }
}
module.exports={ExtensionVoices,normalize};
