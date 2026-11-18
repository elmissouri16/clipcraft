import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import {referenceAudio,type ReferenceInput} from './reference';
const studio=require('./studio.cjs');
export type CloneInput=ReferenceInput&{name:string;transcript:string;language?:string};
const stop=(signal:AbortSignal)=>{if(signal.aborted)throw Error('Voice cloning canceled.');};
function text(value:unknown,label:string,max:number,optional=false){
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||!optional&&(!value.trim()||/[\r\n\t]/.test(value)))throw Error('Enter a valid '+label+'.');
 return value.trim();
}
async function responseJson(response:Response){
 if(!response.body)throw Error('VoiceStudio returned an empty response.');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536)throw Error('VoiceStudio profile response exceeds 64 KiB.');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function cloneVoice(c:ExtensionContext,input:CloneInput,signal:AbortSignal){
 return c.jobs.run('Clone VoiceStudio voice',async job=>{
  stop(job.signal);
  const name=text(input?.name,'voice name',80),transcript=text(input?.transcript??'','reference transcript',4096,true),language=text(input?.language??'Auto','reference language',80),base=studio.studioUrl(await c.configuration.get('address')||studio.STUDIO_URL);
  if(!transcript)throw Error('Provide transcript containing the exact words in the reference audio. Transcribe the selected clip first; never substitute the new narration text. No profile was created.');
  stop(job.signal);await job.progress(.1,'Reading the reference audio');const captured=await referenceAudio(c,input,job.signal);let artifact:Awaited<ReturnType<ExtensionContext['media']['import']>>|undefined;
  try{
   artifact=await c.media.import({bytes:captured.bytes,name:captured.name});stop(job.signal);if(artifact.type!=='audio'||!Number.isFinite(artifact.duration)||!(artifact.duration>0))throw Error('Choose a readable recording containing reference speech.');
   await captured.check();
   await job.progress(.4,'Creating the voice profile');const form=new FormData();form.set('name',name);form.set('kind','clone');form.set('language',language);form.set('ref_text',transcript);form.set('ref_audio',new Blob([captured.bytes]),captured.name);
   let profile:{id:string;name:string;kind:string};
   try{
    const response=await fetch(base+'/profiles',{method:'POST',body:form,redirect:'manual',signal:AbortSignal.any([job.signal,AbortSignal.timeout(120000)])});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('VoiceStudio rejected voice creation (HTTP '+response.status+').');}const value=await responseJson(response);
    if(!value||typeof value.id!=='string'||!/^[-\w.:@ ]{1,120}$/.test(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>200||value.kind!=='clone')throw Error('VoiceStudio returned an invalid profile receipt.');
    profile={id:value.id,name:value.name,kind:value.kind};
   }catch(error){throw Error((job.signal.aborted?'Voice cloning canceled.':error instanceof Error?error.message:'Voice creation failed.')+' The profile may already exist in VoiceStudio. Check its voices before retrying.');}
   await job.progress(1,'Voice profile saved').catch(()=>{});return {message:'Cloned voice “'+profile.name+'” saved in VoiceStudio. Use voiceId with engine extension:clipcraft.voicestudio.speech to generate speech.',voiceId:profile.id,reference:captured.source};
  }finally{if(artifact)await c.media.release({id:artifact.id}).catch(()=>{});}
 },{signal,timeoutMs:180000});
}

export type TranscriptInput={voice_id:string;transcript:string};
export async function setVoiceTranscript(c:ExtensionContext,input:TranscriptInput,signal:AbortSignal){
 const voiceId=text(input?.voice_id,'voice ID',120),transcript=text(input?.transcript,'reference transcript',4096,true);
 if(!transcript)throw Error('Provide the exact words in this voice profile’s reference audio.');
 return c.jobs.run('Update VoiceStudio reference transcript',async job=>{
  stop(job.signal);const base=studio.studioUrl(await c.configuration.get('address')||studio.STUDIO_URL);
  const response=await fetch(base+'/profiles/'+encodeURIComponent(voiceId),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref_text:transcript}),redirect:'manual',signal:job.signal});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('VoiceStudio rejected the reference transcript (HTTP '+response.status+').');}
  const profile=await responseJson(response);if(profile?.id!==voiceId||profile.ref_text!==transcript)throw Error('VoiceStudio did not confirm the reference transcript update. Check the profile before retrying.');
  return {message:'Reference transcript saved. Reuse this voice ID with add_voiceover; do not clone again.',voiceId};
 },{signal,timeoutMs:30000});
}

export type CloneVoiceoverInput=CloneInput&{text:string;start_sec?:number;speed?:number;style?:string};
export async function cloneAndVoiceover(c:ExtensionContext,input:CloneVoiceoverInput,signal:AbortSignal){
 const narration=text(input?.text,'voiceover text',4096,true),style=text(input?.style??'','speech style',1000,true),start=input?.start_sec??0,speed=input?.speed??1;
 if(typeof start!=='number'||!Number.isFinite(start)||start<0||start>86400||typeof speed!=='number'||!Number.isFinite(speed)||speed<.5||speed>2)throw Error('Use a valid start_sec (0–86400) and speed (0.5–2).');
 if(!narration)throw Error('Enter voiceover text.');
 const document=await c.workspace.read();
 return c.jobs.run('Clone voice and create voiceover',async job=>{
  const base=studio.studioUrl(await c.configuration.get('address')||studio.STUDIO_URL),state=await studio.studioStatus(fetch,base,{signal:job.signal});
  if(!state.running)throw Error(state.error||'VoiceStudio is not running.');
  const preparedStyle=await studio.studioStyle(fetch,base,style,{engine:state.activeEngine,signal:job.signal});
  const cloned=await cloneVoice(c,input,job.signal);let artifact:Awaited<ReturnType<ExtensionContext['media']['import']>>|undefined;
  try{
   stop(job.signal);await job.progress(.6,'Generating the cloned voiceover');const file=await studio.studioSpeak(fetch,base,c.extension.storagePath,{voiceId:cloned.voiceId,text:narration,style:preparedStyle,speed,signal:job.signal});stop(job.signal);
   artifact=await c.media.import({path:file,name:'VoiceStudio cloned voiceover.wav'});stop(job.signal);if(artifact.type!=='audio')throw Error('VoiceStudio did not return verified audio.');
   const placed=await c.media.insert({id:artifact.id,documentId:document.documentId,lane:'audio',start_sec:start});
   await job.progress(1,'Cloned voiceover added').catch(()=>{});return {message:'Cloned voiceover added to the timeline.',voiceId:cloned.voiceId,...placed};
  }catch(error){throw Error('Voice '+cloned.voiceId+' was saved, but the voiceover did not complete: '+(error instanceof Error?error.message:String(error))+'. Reuse this voice ID; do not clone it again.');}
  finally{if(artifact)await c.media.release({id:artifact.id}).catch(()=>{});}
 },{signal,timeoutMs:300000});
}
