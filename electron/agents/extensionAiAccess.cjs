// Text completion with the user's selected connection, exposed as an ordinary
// application service. Connection proofs bind review to routing/account state;
// credentials never cross into the extension process.
const crypto=require('node:crypto');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
class ExtensionAiAccess{
 constructor({getConfig,chat,presets,onChanged,prepare}){Object.assign(this,{getConfig,chat,presets,onChanged,prepare});this.secret=crypto.randomBytes(32);}
 snapshot(){
  const saved=this.getConfig(),preset=this.presets.byId(saved.provider);if(!preset||preset.unavailable)throw Error('Choose an available AI connection in Assistant settings.');
  if(preset.needsKey&&!saved.apiKey)throw Error('Add the selected AI connection’s key in Settings first.');
  if(preset.protocol!=='native'&&!saved.model)throw Error('Choose an AI model first.');
  const cfg={provider:saved.provider,model:saved.model||'',baseUrl:saved.baseUrl||'',apiKey:saved.apiKey||'',executablePath:saved.executablePath||'',reasoningEffort:'',webResearch:false,subagents:false,allowEndpointFallback:false};
  let location=preset.name||preset.short||saved.provider;
  if(!preset.extension&&preset.protocol!=='native'){
   const url=new URL(cfg.baseUrl||preset.baseUrl);if(!['http:','https:'].includes(url.protocol))throw Error('The selected AI address must use HTTP or HTTPS.');location=url.origin;
  }
  const connectionState=preset.extension?this.extensionState?.(saved.provider):undefined;if(connectionState?.pending)throw Error('Wait for this extension’s connection settings to finish saving.');
  return {cfg,connectionState,providerName:preset.name||preset.short||saved.provider,model:cfg.model||'Default',location};
 }
 proof(owner,snapshot,time){return crypto.createHmac('sha256',this.secret).update(JSON.stringify([owner.key,owner.generation,time,snapshot.cfg,snapshot.connectionState])).digest('hex');}
 checkOwner(context){context.verify();if(context.owner.state!=='running')throw Error('AI completion requires a running extension.');}
 async describe(_input,context){this.checkOwner(context);await this.prepare?.(context);this.checkOwner(context);const snapshot=this.snapshot(),time=Date.now();return {connection:time+'.'+this.proof(context.owner,snapshot,time),providerName:snapshot.providerName,model:snapshot.model,location:snapshot.location};}
 async complete(input,context){
  this.checkOwner(context);await this.prepare?.(context);this.checkOwner(context);
  if(!plain(input)||Object.keys(input).some(key=>!['connection','system','messages','maxTokens','timeoutMs'].includes(key))||typeof input.connection!=='string')throw Error('Provide a reviewed AI connection and text request.');
  const match=/^(\d{13})\.([a-f0-9]{64})$/.exec(input.connection),time=Number(match?.[1]),snapshot=this.snapshot();
  if(!match||Date.now()-time<0||Date.now()-time>300000||this.proof(context.owner,snapshot,time)!==match[2])throw Error('The reviewed AI connection changed or expired. Review it again.');
  if(snapshot.cfg.provider.startsWith('extension:'+context.owner.manifest.id+'.'))throw Error('An AI service cannot recursively request itself through the selected connection.');
  const system=input.system??'',maxTokens=input.maxTokens??4096,timeoutMs=input.timeoutMs??60000,messages=input.messages;
  if(typeof system!=='string'||system.length>64000||!Array.isArray(messages)||!messages.length||messages.length>200||!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>32768||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('AI text request exceeds its limits.');
  let characters=system.length;for(const message of messages)if(!plain(message)||Object.keys(message).some(key=>!['role','content'].includes(key))||!['user','assistant'].includes(message.role)||typeof message.content!=='string'||(characters+=message.content.length)>256000)throw Error('Provide bounded plain text messages.');
  const controller=new AbortController(),abort=()=>controller.abort(),signal=AbortSignal.any([context.signal,controller.signal]);
  const verify=()=>{context.verify();if(signal.aborted||this.proof(context.owner,this.snapshot(),time)!==match[2])throw Object.assign(Error('AI request canceled or selected connection changed'),{name:'AbortError'});};
  const connectionOff=this.onConnectionChanged?.(()=>{try{verify();}catch{abort();}});
  const off=this.onChanged?.(event=>{if(!event?.keys||event.keys.includes('ai')){try{verify();}catch{abort();}}}),timer=setTimeout(abort,timeoutMs);
  let stopListener;const stopped=new Promise((_,reject)=>{stopListener=()=>reject(Object.assign(Error('AI request canceled'),{name:'AbortError'}));signal.addEventListener('abort',stopListener,{once:true});if(signal.aborted)stopListener();});stopped.catch(()=>{});
  try{
   verify();const text=await Promise.race([this.chat(snapshot.cfg,{system,messages,maxTokens,timeoutMs,signal,serviceScope:{owner:context.owner,operation:context.operation,parentRequest:context.parentRequest}}),stopped]);verify();
   if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024)throw Error('AI text response exceeds 1 MiB.');return {text,providerName:snapshot.providerName,model:snapshot.model};
  }catch(error){if(signal.aborted)throw Object.assign(Error('AI text request canceled or timed out'),{name:'AbortError'});throw Error('AI text request failed. Check the selected connection in Assistant settings.');}
  finally{clearTimeout(timer);signal.removeEventListener('abort',stopListener);off?.();connectionOff?.();}
 }
 register(runtime){
  this.extensionState=provider=>{const job=runtime.services.get(provider.slice('extension:'.length))?.job;return job?{key:job.key,generation:job.generation,revision:job.nativeSettingsRevision||0,pending:job.nativeSettingsPending||0}:null;};
  this.onConnectionChanged=listener=>runtime.ui.observe(listener);
  return runtime.hostServices.register('clipcraft.ai',{describe:(input,context)=>this.describe(input,context),complete:(input,context)=>this.complete(input,context)},{name:'Selected AI connection',description:'Text completion using the selected connection; credentials stay in the host.'});}
}
module.exports={ExtensionAiAccess};
